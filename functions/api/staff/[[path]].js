// GET/POST /api/staff/[[path]] — staff endpoints for queue and caregiver management (slice 08).

function getActor(request) {
  // Check for dev/testing header first
  const devActor = request.headers.get('x-dev-actor');
  if (devActor) return devActor;

  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return 'anonymous_staff';

  try {
    const parts = jwt.split('.');
    if (parts.length === 3) {
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payloadJson = atob(payloadBase64);
      const payload = JSON.parse(payloadJson);
      return payload.email || payload.sub || 'unknown_staff';
    }
  } catch (e) {
    // Fallback if parsing fails
  }
  return 'invalid_jwt_staff';
}

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

      return json({
        ok: true,
        profile,
        registrations,
        grants,
        followups,
        notes
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
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'staff', 'followup', ':id', 'resolve']

    if (pathSegments.length !== 5 || pathSegments[2] !== 'followup' || pathSegments[4] !== 'resolve') {
      return json({ ok: false, error: 'invalid route parameters' }, 400);
    }

    const id = parseInt(pathSegments[3], 10);
    if (isNaN(id)) {
      return json({ ok: false, error: 'invalid followup id' }, 400);
    }

    const actor = getActor(request);

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
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
