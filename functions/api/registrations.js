// GET/POST /api/registrations — manages event registrations and attendance (slice 05).
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const eventId = url.searchParams.get('event_id');
    if (!eventId) {
      return new Response(JSON.stringify({ ok: false, error: 'event_id query param is required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { results } = await env.LEGACY_DB
      .prepare(`
        SELECT r.id, r.caregiver_id, r.event_id, r.status, r.created_at,
               c.first_name, c.last_name, c.email
        FROM registration r
        JOIN caregiver c ON r.caregiver_id = c.id
        WHERE r.event_id = ?
        ORDER BY r.created_at ASC
      `)
      .bind(eventId)
      .all();

    return new Response(JSON.stringify({ ok: true, registrations: results }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.id || !body.status) {
      return new Response(JSON.stringify({ ok: false, error: 'id and status are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!['registered', 'attended', 'no_show', 'cancelled'].includes(body.status)) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid status' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const oldReg = await env.LEGACY_DB
      .prepare(`SELECT status FROM registration WHERE id = ?`)
      .bind(body.id)
      .first();

    if (!oldReg) {
      return new Response(JSON.stringify({ ok: false, error: 'registration not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    await env.LEGACY_DB
      .prepare(`UPDATE registration SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(body.status, body.id)
      .run();

    await env.LEGACY_DB
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES ('staff_console', 'registration.update_status', 'registration', ?, ?, ?)
      `)
      .bind(
        body.id.toString(),
        JSON.stringify({ status: oldReg.status }),
        JSON.stringify({ status: body.status })
      )
      .run();

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
