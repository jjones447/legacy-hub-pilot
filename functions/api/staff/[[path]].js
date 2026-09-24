// GET/POST /api/staff/[[path]] — staff endpoints for queue and caregiver management (slice 08).
import { getActor } from '../../_lib/actor.js';
import * as caregiversDomain from '../../_lib/domain/caregivers.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'staff', 'queue'] or ['api', 'staff', 'caregiver', ':id']

    if (pathSegments.length < 3) {
      return json({ ok: false, error: 'invalid route parameters' }, 400);
    }

    const subRoute = pathSegments[2];

    if (subRoute === 'queue') {
      // GET /api/staff/queue — open follow-up items
      const { results } = await env.LEGACY_DB.prepare(`
        SELECT f.id, f.caregiver_id, f.kind, f.detail, f.due, f.status, f.source, f.external_ref, f.created_at,
               c.first_name AS caregiver_first_name, c.last_name AS caregiver_last_name
        FROM followup f
        JOIN caregiver c ON f.caregiver_id = c.id
        WHERE f.status = 'open'
        ORDER BY COALESCE(f.due, f.created_at) ASC, f.created_at ASC
      `).all();

      return json({ ok: true, queue: results });
    }

    if (subRoute === 'caregiver') {
      // GET /api/staff/caregiver/:id — profile + registrations + grants/awards + followups + notes
      if (pathSegments.length !== 4) {
        return json({ ok: false, error: 'missing caregiver id' }, 400);
      }
      const caregiverId = pathSegments[3];

      // 1. Profile
      const profile = await env.LEGACY_DB.prepare(`
        SELECT * FROM caregiver WHERE id = ?
      `).bind(caregiverId).first();

      if (!profile) {
        return json({ ok: false, error: 'caregiver not found' }, 404);
      }

      // 2. Registrations
      const { results: registrations } = await env.LEGACY_DB.prepare(`
        SELECT r.id, r.event_id, r.status, r.source, r.external_ref, r.created_at, r.updated_at,
               e.title AS event_title, e.starts_at AS event_starts_at, e.location AS event_location
        FROM registration r
        JOIN event e ON r.event_id = e.id
        WHERE r.caregiver_id = ?
        ORDER BY e.starts_at DESC
      `).bind(caregiverId).all();

      // 3. Grant applications & awards
      const { results: grants } = await env.LEGACY_DB.prepare(`
        SELECT g.id, g.requested_for, g.status, g.review_notes, g.source, g.external_ref, g.created_at, g.updated_at,
               a.id AS award_id, a.amount AS award_amount, a.care_package AS award_care_package, a.outcome AS award_outcome
        FROM grant_application g
        LEFT JOIN award a ON g.id = a.grant_application_id
        WHERE g.caregiver_id = ?
        ORDER BY g.created_at DESC
      `).bind(caregiverId).all();

      // 4. Followups
      const { results: followups } = await env.LEGACY_DB.prepare(`
        SELECT id, kind, detail, due, status, source, external_ref, created_at
        FROM followup
        WHERE caregiver_id = ?
        ORDER BY created_at DESC
      `).bind(caregiverId).all();

      // 5. Notes
      const { results: notes } = await env.LEGACY_DB.prepare(`
        SELECT id, author, body, visibility, status, created_at
        FROM note
        WHERE caregiver_id = ? AND status = 'active'
        ORDER BY created_at DESC
      `).bind(caregiverId).all();

      // 6. Contact history
      const { results: contact_history } = await env.LEGACY_DB.prepare(`
        SELECT id, caregiver_id, occurred_at, channel, direction, summary, recorded_by, created_at
        FROM contact_history
        WHERE caregiver_id = ?
        ORDER BY occurred_at DESC, created_at DESC
      `).bind(caregiverId).all();

      return json({
        ok: true,
        profile,
        registrations,
        grants,
        followups,
        notes,
        contact_history
      });
    }

    if (subRoute === 'caregivers') {
      // GET /api/staff/caregivers — caregiver search/filter
      const q = (url.searchParams.get('q') || '').trim();
      const segment = (url.searchParams.get('segment') || '').trim();
      const status = (url.searchParams.get('status') || '').trim();
      const limitRaw = parseInt(url.searchParams.get('limit') || '25', 10);
      const offsetRaw = parseInt(url.searchParams.get('offset') || '0', 10);

      const limit = Math.min(Math.max(isNaN(limitRaw) ? 25 : limitRaw, 1), 100);
      const offset = Math.max(isNaN(offsetRaw) ? 0 : offsetRaw, 0);

      const conditions = [];
      const params = [];

      if (q) {
        const pattern = `%${q}%`;
        conditions.push(`(
          c.first_name LIKE ? OR
          c.last_name LIKE ? OR
          (c.first_name || ' ' || c.last_name) LIKE ? OR
          c.email LIKE ? OR
          c.phone LIKE ?
        )`);
        params.push(pattern, pattern, pattern, pattern, pattern);
      }

      if (segment) {
        conditions.push(`EXISTS (
          SELECT 1 FROM json_each(COALESCE(NULLIF(c.segment_tags, ''), '[]'))
          WHERE value = ?
        )`);
        params.push(segment);
      }

      if (status) {
        conditions.push(`c.status = ?`);
        params.push(status);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countSql = `SELECT COUNT(*) AS total FROM caregiver c ${whereClause}`;
      const countRow = await env.LEGACY_DB.prepare(countSql).bind(...params).first();
      const total = countRow ? countRow.total : 0;

      // Select caregivers
      const selectSql = `
        SELECT c.*
        FROM caregiver c
        ${whereClause}
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT ? OFFSET ?
      `;
      const selectParams = [...params, limit, offset];
      const { results: caregivers } = await env.LEGACY_DB.prepare(selectSql).bind(...selectParams).all();

      return json({
        ok: true,
        caregivers,
        total,
        limit,
        offset
      });
    }

    return json({ ok: false, error: 'unsupported route' }, 404);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    // 1. POST /api/staff/followup/:id/resolve
    if (pathSegments.length === 5 && pathSegments[2] === 'followup' && pathSegments[4] === 'resolve') {
      const id = parseInt(pathSegments[3], 10);
      if (isNaN(id)) {
        return json({ ok: false, error: 'invalid followup id' }, 400);
      }

      const actor = getActor(request, env);

      // Fetch followup status
      const followup = await env.LEGACY_DB.prepare(`
        SELECT status, caregiver_id FROM followup WHERE id = ?
      `).bind(id).first();

      if (!followup) {
        return json({ ok: false, error: 'followup not found' }, 404);
      }

      if (followup.status !== 'open') {
        return json({ ok: false, error: `cannot resolve from status ${followup.status}` }, 409);
      }

      const body = await request.json().catch(() => ({}));
      const targetStatus = body.status || 'done';
      if (!['done', 'dismissed'].includes(targetStatus)) {
        return json({ ok: false, error: "status must be 'done' or 'dismissed'" }, 400);
      }

      // Update status
      await env.LEGACY_DB.prepare(`
        UPDATE followup SET status = ? WHERE id = ?
      `).bind(targetStatus, id).run();

      // Audit log followup.resolve
      await env.LEGACY_DB.prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'followup.resolve', 'followup', ?, ?, ?)
      `).bind(
        actor,
        id.toString(),
        JSON.stringify({ status: followup.status }),
        JSON.stringify({ status: targetStatus })
      ).run();

      return json({ ok: true });
    }

    // 2. POST /api/staff/caregiver/:id/contact
    if (pathSegments.length === 5 && pathSegments[2] === 'caregiver' && pathSegments[4] === 'contact') {
      const caregiverId = pathSegments[3];
      if (!caregiverId) {
        return json({ ok: false, error: 'missing caregiver id' }, 400);
      }

      const caregiver = await env.LEGACY_DB.prepare(`
        SELECT id FROM caregiver WHERE id = ?
      `).bind(caregiverId).first();

      if (!caregiver) {
        return json({ ok: false, error: 'caregiver not found' }, 404);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: 'invalid JSON body' }, 400);
      }

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ ok: false, error: 'body must be a JSON object' }, 400);
      }

      const allowedKeys = ['occurred_at', 'channel', 'direction', 'summary'];
      for (const key of Object.keys(body)) {
        if (!allowedKeys.includes(key)) {
          return json({ ok: false, error: `unknown or forbidden field: ${key}` }, 400);
        }
      }

      const { occurred_at, channel, direction, summary } = body;

      if (!occurred_at || typeof occurred_at !== 'string' || isNaN(Date.parse(occurred_at))) {
        return json({ ok: false, error: 'occurred_at must be a valid ISO timestamp string' }, 400);
      }

      const validChannels = ['phone', 'email', 'in_person', 'event', 'other'];
      if (!channel || !validChannels.includes(channel)) {
        return json({ ok: false, error: `channel must be one of: ${validChannels.join(', ')}` }, 400);
      }

      const validDirections = ['inbound', 'outbound'];
      if (!direction || !validDirections.includes(direction)) {
        return json({ ok: false, error: `direction must be one of: ${validDirections.join(', ')}` }, 400);
      }

      if (!summary || typeof summary !== 'string' || !summary.trim()) {
        return json({ ok: false, error: 'summary is required and must not be empty' }, 400);
      }

      const actor = getActor(request, env);

      // Insert contact history
      const insertResult = await env.LEGACY_DB.prepare(`
        INSERT INTO contact_history (caregiver_id, occurred_at, channel, direction, summary, recorded_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(caregiverId, occurred_at, channel, direction, summary.trim(), actor).run();

      const newId = insertResult?.meta?.last_row_id || insertResult?.lastRowId || null;

      // Audit log caregiver.contact_added
      await env.LEGACY_DB.prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'caregiver.contact_added', 'caregiver', ?, NULL, ?)
      `).bind(
        actor,
        caregiverId,
        JSON.stringify({
          contact_id: newId,
          occurred_at,
          channel,
          direction,
          summary: summary.trim(),
          recorded_by: actor
        })
      ).run();

      return json({
        ok: true,
        contact: {
          id: newId,
          caregiver_id: caregiverId,
          occurred_at,
          channel,
          direction,
          summary: summary.trim(),
          recorded_by: actor
        }
      }, 201);
    }

    // 3. POST /api/staff/caregiver/:id/note
    if (pathSegments.length === 5 && pathSegments[2] === 'caregiver' && pathSegments[4] === 'note') {
      const caregiverId = pathSegments[3];
      if (!caregiverId) {
        return json({ ok: false, error: 'missing caregiver id' }, 400);
      }

      const caregiver = await env.LEGACY_DB.prepare(`
        SELECT id FROM caregiver WHERE id = ?
      `).bind(caregiverId).first();

      if (!caregiver) {
        return json({ ok: false, error: 'caregiver not found' }, 404);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: 'invalid JSON body' }, 400);
      }

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return json({ ok: false, error: 'body must be a JSON object' }, 400);
      }

      const allowedKeys = ['body'];
      for (const key of Object.keys(body)) {
        if (!allowedKeys.includes(key)) {
          return json({ ok: false, error: `unknown or forbidden field: ${key}` }, 400);
        }
      }

      if (!('body' in body)) {
        return json({ ok: false, error: 'body is required' }, 400);
      }

      if (typeof body.body !== 'string') {
        return json({ ok: false, error: 'body must be a string' }, 400);
      }

      const trimmedBody = body.body.trim();
      if (!trimmedBody) {
        return json({ ok: false, error: 'body is required and must not be empty' }, 400);
      }

      if (trimmedBody.length > 2000) {
        return json({ ok: false, error: 'body exceeds maximum length of 2000 characters' }, 400);
      }

      const actor = getActor(request, env);

      const insertResult = await env.LEGACY_DB.prepare(`
        INSERT INTO note (caregiver_id, author, body, visibility, status)
        VALUES (?, ?, ?, 'staff', 'active')
      `).bind(caregiverId, actor, trimmedBody).run();

      const newId = insertResult?.meta?.last_row_id || insertResult?.lastRowId || null;

      // Audit log caregiver.note_added
      await env.LEGACY_DB.prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'caregiver.note_added', 'caregiver', ?, NULL, ?)
      `).bind(
        actor,
        caregiverId,
        JSON.stringify({
          note_id: newId,
          author: actor,
          body: trimmedBody
        })
      ).run();

      const createdNote = await env.LEGACY_DB.prepare(`
        SELECT id, caregiver_id, author, body, visibility, status, created_at
        FROM note WHERE id = ?
      `).bind(newId).first();

      return json({
        ok: true,
        note: createdNote
      }, 201);
    }

    // 4. POST /api/staff/note/:id/archive
    if (pathSegments.length === 5 && pathSegments[2] === 'note' && pathSegments[4] === 'archive') {
      const id = parseInt(pathSegments[3], 10);
      if (isNaN(id)) {
        return json({ ok: false, error: 'invalid note id' }, 400);
      }

      const note = await env.LEGACY_DB.prepare(`
        SELECT id, caregiver_id, author, body, status, created_at FROM note WHERE id = ?
      `).bind(id).first();

      if (!note) {
        return json({ ok: false, error: 'note not found' }, 404);
      }

      if (note.status === 'archived') {
        return json({ ok: false, error: 'note is already archived' }, 409);
      }

      const actor = getActor(request, env);

      await env.LEGACY_DB.prepare(`
        UPDATE note SET status = 'archived' WHERE id = ?
      `).bind(id).run();

      // Audit log caregiver.note_archived
      await env.LEGACY_DB.prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'caregiver.note_archived', 'caregiver', ?, ?, ?)
      `).bind(
        actor,
        note.caregiver_id,
        JSON.stringify({ note_id: id, status: note.status }),
        JSON.stringify({ note_id: id, status: 'archived' })
      ).run();

      return json({ ok: true });
    }

    return json({ ok: false, error: 'invalid route parameters' }, 400);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    // PATCH /api/staff/caregiver/:id
    if (pathSegments.length !== 4 || pathSegments[2] !== 'caregiver') {
      return json({ ok: false, error: 'invalid route parameters' }, 400);
    }

    const caregiverId = pathSegments[3];
    if (!caregiverId) {
      return json({ ok: false, error: 'missing caregiver id' }, 400);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'invalid JSON body' }, 400);
    }

    const actor = getActor(request, env);
    const result = await caregiversDomain.apply(env.LEGACY_DB, { id: caregiverId, operation: 'update', payload: body }, actor);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, result.status);
    }

    return json({
      ok: true,
      profile: result.profile
    });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

