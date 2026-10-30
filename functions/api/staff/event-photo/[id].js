import { confirmationActor } from '../../../_lib/agent-confirmation.mjs';
import { getActor } from '../../../_lib/actor.js';
import { getStaffMember } from '../../../_lib/staff.js';
import { PhotoError, photoForm, inspectPhoto, isEventPhotoKey, readEventPhoto } from '../../../_lib/event-photos.js';

const ACTION = 'event.photo.updated';
// Readback that decides whether an object is unreferenced must reach the primary,
// including after a lost write reply. A pre-write replica bookmark is insufficient.
const primary = db => typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
async function actorFor(context) {
  // Real requests require the middleware's unforgeable, verified Access staff seam.
  const actor = confirmationActor(context.data)
    || (context.env.ALLOW_DEV_CONSOLE === '1' ? getActor(context.request, context.env) : null);
  const staff = actor && await getStaffMember(primary(context.env.LEGACY_DB), actor);
  return staff?.status === 'active' ? actor : null;
}
async function eventFor(context) {
  const id = context.params.id;
  if (typeof id !== 'string' || !id.length || id.length > 200 || /[\x00-\x1f]/.test(id)) throw new PhotoError(400, 'Invalid event.');
  return primary(context.env.LEGACY_DB).prepare('SELECT id, title, publish_state, photo_key, photo_alt FROM event WHERE id = ?').bind(id).first();
}
async function original(db, id, requestId) {
  return primary(db).prepare(`SELECT id, actor, before_json, after_json FROM audit_log
    WHERE action = ? AND entity = 'event' AND entity_id = ? AND json_valid(after_json)
      AND json_extract(after_json, '$.request_id') = ?`).bind(ACTION, id, requestId).first();
}
function originalResult(audit, actor, intended, current) {
  const after = JSON.parse(audit.after_json), before = JSON.parse(audit.before_json);
  if (audit.actor !== actor || after.content_sha256 !== intended.content_sha256 || after.photo_alt !== intended.photo_alt
    || before.photo_key !== intended.expected_photo_key || after.removed !== intended.removed) {
    return json({ ok: false, error: 'photo_request_conflict', message: 'This photo request was already used for a different change. Refresh the event.' }, 409);
  }
  if (!current || current.photo_key !== after.photo_key || current.photo_alt !== after.photo_alt) {
    return json({ ok: false, error: 'photo_changed_after_save', saved: true, audit_id: audit.id,
      message: 'The original photo change was saved, then changed again. Refresh the event.' }, 409);
  }
  return json({ ok: true, duplicate: true, audit_id: audit.id, photo_key: after.photo_key, photo_alt: after.photo_alt });
}

export async function onRequestGet(context) {
  try {
    if (!await actorFor(context)) return json({ ok: false, error: 'active_staff_required' }, 403);
    const event = await eventFor(context);
    return event ? await readEventPhoto(context.env, event) : json({ ok: false, error: 'event_not_found' }, 404);
  } catch {
    return json({ ok: false, error: 'photo_unavailable' }, 503);
  }
}

export async function onRequestPost(context) {
  let newKey, event, requestId, intended, actor;
  const { env, request } = context;
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new PhotoError(403, 'Open the Staff Console to change an event photo.');
    actor = await actorFor(context);
    if (!actor) throw new PhotoError(403, 'An active staff sign-in is required.');
    if (!env.MEDIA) throw new PhotoError(503, 'Event photo storage is unavailable.');
    event = await eventFor(context);
    if (!event) throw new PhotoError(404, 'This event was not found.');
    const form = await photoForm(request);
    const field = name => {
      const value = form.get(name);
      if (value !== null && typeof value !== 'string') throw new PhotoError(400, 'Invalid photo upload fields.');
      return value || '';
    };
    requestId = field('request_id');
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(requestId)) throw new PhotoError(400, 'A unique photo request is required.');
    const expected = field('expected_photo_key') || null;
    if (expected && !isEventPhotoKey(expected)) throw new PhotoError(400, 'Invalid existing photo. Refresh the event.');
    const removeField = field('remove');
    if (removeField && removeField !== '1') throw new PhotoError(400, 'Invalid photo action.');
    const removed = removeField === '1', file = form.get('photo');
    let bytes, metadata, digest = null;
    if (removed) {
      if (file) throw new PhotoError(400, 'Choose either uploading or removing a photo.');
    } else {
      if (!file || typeof file.arrayBuffer !== 'function') throw new PhotoError(400, 'Choose a photo to upload.');
      bytes = new Uint8Array(await file.arrayBuffer());
      metadata = inspectPhoto(bytes, file.type);
      digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    }
    const alt = removed ? null : field('alt').trim() || `Photo for ${event.title}`;
    if (alt && alt.length > 300) throw new PhotoError(400, 'Keep the photo description within 300 characters.');
    intended = { expected_photo_key: expected, photo_alt: alt, content_sha256: digest, removed };
    const prior = await original(env.LEGACY_DB, event.id, requestId);
    if (prior) return originalResult(prior, actor, intended, await eventFor(context));
    if (event.publish_state === 'archived') throw new PhotoError(409, 'Archived events cannot change photos.');
    if (event.photo_key !== expected) throw new PhotoError(409, 'The event photo changed. Refresh the event before saving.');
    if (removed && !event.photo_key) throw new PhotoError(409, 'This event has no photo to remove.');
    if (!removed) {
      newKey = `event-photos/${crypto.randomUUID()}.${metadata.extension}`;
      const stored = await env.MEDIA.put(newKey, bytes, {
        httpMetadata: { contentType: metadata.type, cacheControl: 'no-store' },
        customMetadata: { kind: 'event-photo', event_id: event.id, sha256: digest,
          width: String(metadata.width), height: String(metadata.height) },
      });
      if (!stored) throw new Error('photo object not stored');
    }
    const after = { photo_key: newKey || null, photo_alt: alt, request_id: requestId,
      content_sha256: digest, removed, ...(metadata ? { width: metadata.width, height: metadata.height } : {}) };
    const before = { photo_key: event.photo_key, photo_alt: event.photo_alt };
    const result = await env.LEGACY_DB.batch([
      env.LEGACY_DB.prepare(`UPDATE event SET photo_key = ?, photo_alt = ?, updated_at = datetime('now')
        WHERE id = ? AND photo_key IS ? AND publish_state IN ('draft','published')
          AND EXISTS (SELECT 1 FROM staff_member WHERE email = ? AND status = 'active')`)
        .bind(after.photo_key, alt, event.id, expected, actor.toLowerCase()),
      env.LEGACY_DB.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        SELECT ?, ?, 'event', ?, ?, ? WHERE changes() = 1`)
        .bind(actor, ACTION, event.id, JSON.stringify(before), JSON.stringify(after)),
    ]);
    if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1) throw new PhotoError(409, 'The event or staff access changed. Refresh before saving.');
    const audit = await original(env.LEGACY_DB, event.id, requestId);
    if (!audit) throw new Error('photo audit readback unavailable');
    return json({ ok: true, audit_id: audit.id, photo_key: after.photo_key, photo_alt: alt });
  } catch (error) {
    // A network error may follow a committed transaction. Read its ORIGINAL audit first.
    if (event && intended && actor && requestId) {
      try {
        const [audit, current] = await Promise.all([original(env.LEGACY_DB, event.id, requestId), eventFor(context)]);
        if (audit) {
          // Concurrent identical requests can have uploaded two distinct candidate objects.
          // Retain the committed original; remove only the losing, unreferenced candidate.
          if (newKey && JSON.parse(audit.after_json).photo_key !== newKey
            && !await primary(env.LEGACY_DB).prepare('SELECT id FROM event WHERE photo_key = ? LIMIT 1').bind(newKey).first()) {
            await env.MEDIA.delete(newKey);
          }
          return originalResult(audit, actor, intended, current);
        }
        // Delete ONLY this request's new object when authoritative readback proves no reference.
        if (newKey && !await primary(env.LEGACY_DB).prepare('SELECT id FROM event WHERE photo_key = ? LIMIT 1').bind(newKey).first()) {
          await env.MEDIA.delete(newKey);
        }
      } catch {
        return json({ ok: false, error: 'photo_outcome_unknown', uncertain: true,
          message: 'The photo save could not be confirmed. Refresh the event before trying again.' }, 503);
      }
    }
    if (error instanceof PhotoError) return json({ ok: false, error: 'photo_rejected', message: error.message }, error.status);
    return json({ ok: false, error: 'photo_save_unavailable', uncertain: true,
      message: 'The photo save could not be confirmed. Refresh the event before trying again.' }, 503);
  }
}
