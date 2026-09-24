// GET/POST /api/staff/[[path]] — staff endpoints for queue and caregiver management (slice 08).
import { getActor } from '../../_lib/actor.js';
import { internalError } from '../../_lib/errors.js';
import * as caregiversDomain from '../../_lib/domain/caregivers.js';
import * as eventsDomain from '../../_lib/domain/events.js';
import { _resetContentCache } from '../../_content.mjs';

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

    if (subRoute === 'content') {
      // GET /api/staff/content -- published content items & content type schemas
      const { results: items } = await env.LEGACY_DB.prepare(`
        SELECT id, type_id, data, status, updated_by, updated_at
        FROM content_item
        WHERE status = 'published'
        ORDER BY type_id ASC, id ASC
      `).all();

      const { results: types } = await env.LEGACY_DB.prepare(`
        SELECT id, json_schema
        FROM content_type
        ORDER BY id ASC
      `).all();

      return json({
        ok: true,
        items: items || [],
        content_items: items || [],
        types: types || [],
        content_types: types || []
      });
    }

    if (subRoute === 'recent-changes') {
      // GET /api/staff/recent-changes -- last 50 audit_log rows for content_item.* and caregiver.* actions
      const { results: changes } = await env.LEGACY_DB.prepare(`
        SELECT id, actor, action, entity, entity_id, before_json, after_json, at
        FROM audit_log
        WHERE action LIKE 'content_item.%'
           OR action LIKE 'caregiver.%'
           OR (entity IN ('content_item', 'caregiver') AND action = 'undo')
           OR action LIKE '%.undo'
        ORDER BY id DESC
        LIMIT 50
      `).all();

      // Find all already undone audit IDs
      const undoneIds = new Set();
      const { results: undoLogs } = await env.LEGACY_DB.prepare(
        "SELECT before_json, after_json FROM audit_log WHERE action = 'undo' OR action LIKE '%.undo'"
      ).all();

      for (const u of (undoLogs || [])) {
        for (const str of [u.before_json, u.after_json]) {
          if (!str) continue;
          try {
            const parsed = JSON.parse(str);
            const uId = parsed.original_audit_id ?? parsed.undone_audit_id ?? parsed.audit_id;
            if (uId) undoneIds.add(Number(uId));
          } catch {}
        }
      }

      const nonRestorableActions = [
        'caregiver.contact_added',
        'caregiver.note_added',
        'undo'
      ];

      const enriched = (changes || []).map(row => {
        const isNonRestorable = nonRestorableActions.includes(row.action) ||
                                row.action.startsWith('grant.') ||
                                row.action.startsWith('agent_change.') ||
                                row.action.endsWith('.undo') ||
                                !row.before_json;
        const isUndone = undoneIds.has(Number(row.id));
        const restorable = !isNonRestorable && !isUndone;
        return {
          ...row,
          restorable,
          can_undo: restorable,
          is_undone: isUndone
        };
      });

      return json({
        ok: true,
        changes: enriched,
        recent_changes: enriched
      });
    }

    if (subRoute === 'events') {
      // GET /api/staff/events -- all events with registration counts and status
      const { results } = await env.LEGACY_DB.prepare(`
        SELECT e.id, e.title, e.type, e.starts_at, e.ends_at, e.location, e.capacity,
               e.recurring, e.publish_state, e.created_at, e.updated_at,
               COUNT(r.id) AS registered_count
        FROM event e
        LEFT JOIN registration r ON e.id = r.event_id AND r.status IN ('registered', 'attended')
        GROUP BY e.id
        ORDER BY e.starts_at ASC
      `).all();

      return json({ ok: true, events: results });
    }

    return json({ ok: false, error: 'unsupported route' }, 404);
  } catch (e) {
    return internalError('/api/staff GET', e);
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

    // 5. POST /api/staff/undo/:audit_id
    if (pathSegments.length === 4 && pathSegments[2] === 'undo') {
      const auditId = parseInt(pathSegments[3], 10);
      if (isNaN(auditId)) {
        return json({ ok: false, error: 'invalid audit id' }, 400);
      }

      const original = await env.LEGACY_DB.prepare(`
        SELECT * FROM audit_log WHERE id = ?
      `).bind(auditId).first();

      if (!original) {
        return json({ ok: false, error: 'audit log entry not found' }, 404);
      }

      // Refusal 1: missing before_json
      if (!original.before_json) {
        return json({ ok: false, error: 'cannot undo change: no before_json recorded' }, 409);
      }

      // Refusal 2: non-restorable actions (grant transitions, contact appends, note additions, undo)
      const nonRestorableActions = [
        'caregiver.contact_added',
        'caregiver.note_added',
        'undo'
      ];
      if (
        nonRestorableActions.includes(original.action) ||
        original.action.startsWith('grant.') ||
        original.action.startsWith('agent_change.') ||
        original.action.endsWith('.undo')
      ) {
        return json({ ok: false, error: `action ${original.action} is not restorable` }, 409);
      }

      // Refusal 3: already undone
      const { results: existingUndos } = await env.LEGACY_DB.prepare(
        "SELECT before_json, after_json FROM audit_log WHERE action = 'undo' OR action LIKE '%.undo'"
      ).all();

      let alreadyUndone = false;
      for (const u of (existingUndos || [])) {
        for (const str of [u.before_json, u.after_json]) {
          if (!str) continue;
          try {
            const parsed = JSON.parse(str);
            const uId = parsed.original_audit_id ?? parsed.undone_audit_id ?? parsed.audit_id;
            if (Number(uId) === auditId) {
              alreadyUndone = true;
              break;
            }
          } catch {}
        }
        if (alreadyUndone) break;
      }

      if (alreadyUndone) {
        return json({ ok: false, error: `audit entry ${auditId} has already been undone` }, 409);
      }

      const actor = getActor(request, env);
      let beforeObj;
      try {
        beforeObj = JSON.parse(original.before_json);
      } catch (e) {
        return json({ ok: false, error: 'malformed before_json in audit log' }, 409);
      }

      if (original.action === 'caregiver.note_archived') {
        const noteId = beforeObj.note_id;
        const noteStatus = beforeObj.status || 'active';
        if (!noteId) {
          return json({ ok: false, error: 'missing note_id in before_json' }, 409);
        }
        await env.LEGACY_DB.prepare(
          "UPDATE note SET status = ? WHERE id = ?"
        ).bind(noteStatus, noteId).run();
      } else if (original.entity === 'caregiver' || original.action.startsWith('caregiver.')) {
        const ALLOWED_CAREGIVER_FIELDS = [
          'first_name',
          'last_name',
          'email',
          'phone',
          'preferred_contact',
          'relationship_to_patient',
          'patient_diagnosis_stage',
          'care_setting',
          'notes',
          'caring_for',
          'relationship',
          'status',
          'segment_tags',
          'sanctuary_member',
          'outcome_status',
          'outcome_notes'
        ];

        const setClauses = [];
        const params = [];
        for (const [key, val] of Object.entries(beforeObj)) {
          if (ALLOWED_CAREGIVER_FIELDS.includes(key)) {
            setClauses.push(`${key} = ?`);
            params.push(val);
          }
        }

        if (setClauses.length > 0) {
          setClauses.push("updated_at = datetime('now')");
          if ('outcome_status' in beforeObj || 'outcome_notes' in beforeObj) {
            setClauses.push("outcome_updated_at = datetime('now')");
          }
          params.push(original.entity_id);
          await env.LEGACY_DB.prepare(
            `UPDATE caregiver SET ${setClauses.join(', ')} WHERE id = ?`
          ).bind(...params).run();
        }
      } else if (original.entity === 'content_item' || original.action.startsWith('content_item.')) {
        let targetData = null;
        let targetStatus = null;

        if (beforeObj && typeof beforeObj === 'object' && 'data' in beforeObj && 'status' in beforeObj) {
          targetData = typeof beforeObj.data === 'string' ? beforeObj.data : JSON.stringify(beforeObj.data);
          targetStatus = beforeObj.status;
        } else if (beforeObj && typeof beforeObj === 'object' && 'data' in beforeObj) {
          targetData = typeof beforeObj.data === 'string' ? beforeObj.data : JSON.stringify(beforeObj.data);
          if ('status' in beforeObj) targetStatus = beforeObj.status;
        } else {
          targetData = JSON.stringify(beforeObj);
        }

        if (targetStatus && targetData) {
          await env.LEGACY_DB.prepare(`
            UPDATE content_item
            SET data = ?, status = ?, updated_by = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(targetData, targetStatus, 'staff_' + actor, original.entity_id).run();
        } else if (targetData) {
          await env.LEGACY_DB.prepare(`
            UPDATE content_item
            SET data = ?, updated_by = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(targetData, 'staff_' + actor, original.entity_id).run();
        } else if (targetStatus) {
          await env.LEGACY_DB.prepare(`
            UPDATE content_item
            SET status = ?, updated_by = ?, updated_at = datetime('now')
            WHERE id = ?
          `).bind(targetStatus, 'staff_' + actor, original.entity_id).run();
        }

        try {
          _resetContentCache();
        } catch {}
      } else {
        return json({ ok: false, error: `entity ${original.entity} does not support undo` }, 409);
      }

      // Write undo audit row referencing original audit ID
      const undoMeta = {
        original_audit_id: original.id,
        undone_audit_id: original.id,
        audit_id: original.id,
        original_action: original.action,
        entity: original.entity,
        entity_id: original.entity_id
      };

      await env.LEGACY_DB.prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'undo', ?, ?, ?, ?)
      `).bind(
        actor,
        original.entity,
        original.entity_id,
        original.after_json,
        JSON.stringify(undoMeta)
      ).run();

      return json({ ok: true, undone_audit_id: original.id });
    }

    // 6. POST /api/staff/event (create)
    if (pathSegments.length === 3 && pathSegments[2] === 'event') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: 'invalid JSON body' }, 400);
      }
      const actor = getActor(request, env);
      const result = await eventsDomain.apply(env.LEGACY_DB, { operation: 'create', payload: body }, actor);
      if (!result.ok) {
        return json({ ok: false, error: result.error }, result.status || 400);
      }
      return json({ ok: true, event: result.event }, 201);
    }

    // 7. POST /api/staff/event/:id/publish
    if (pathSegments.length === 5 && pathSegments[2] === 'event' && pathSegments[4] === 'publish') {
      const eventId = pathSegments[3];
      const body = await request.json().catch(() => ({}));
      const actor = getActor(request, env);
      const result = await eventsDomain.apply(env.LEGACY_DB, { id: eventId, operation: 'publish', payload: body }, actor);
      if (!result.ok) {
        return json({ ok: false, error: result.error }, result.status || 400);
      }
      return json({ ok: true, event: result.event });
    }

    // 8. POST /api/staff/event/:id/archive
    if (pathSegments.length === 5 && pathSegments[2] === 'event' && pathSegments[4] === 'archive') {
      const eventId = pathSegments[3];
      const body = await request.json().catch(() => ({}));
      const actor = getActor(request, env);
      const result = await eventsDomain.apply(env.LEGACY_DB, { id: eventId, operation: 'archive', payload: body }, actor);
      if (!result.ok) {
        return json({
          ok: false,
          error: result.error,
          ...(result.registration_count != null ? { registration_count: result.registration_count } : {})
        }, result.status || 400);
      }
      return json({ ok: true, event: result.event });
    }

    return json({ ok: false, error: 'invalid route parameters' }, 400);
  } catch (e) {
    return internalError('/api/staff POST', e);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    // PATCH /api/staff/caregiver/:id
    if (pathSegments.length === 4 && pathSegments[2] === 'caregiver') {
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
    }

    // PATCH /api/staff/event/:id
    if (pathSegments.length === 4 && pathSegments[2] === 'event') {
      const eventId = pathSegments[3];
      if (!eventId) {
        return json({ ok: false, error: 'missing event id' }, 400);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ ok: false, error: 'invalid JSON body' }, 400);
      }

      const actor = getActor(request, env);
      const result = await eventsDomain.apply(env.LEGACY_DB, { id: eventId, operation: 'update', payload: body }, actor);
      if (!result.ok) {
        return json({ ok: false, error: result.error }, result.status || 400);
      }

      return json({
        ok: true,
        event: result.event
      });
    }

    return json({ ok: false, error: 'invalid route parameters' }, 400);
  } catch (e) {
    return internalError('/api/staff PATCH', e);
  }
}

