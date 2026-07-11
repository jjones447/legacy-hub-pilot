// GET/POST /api/followups — manages the follow-up queue (slice 05).
export async function onRequestGet({ env }) {
  try {
    const { results } = await env.LEGACY_DB
      .prepare(`
        SELECT f.id, f.kind, f.detail, f.due, f.status, f.created_at,
               c.first_name, c.last_name, c.email
        FROM followup f
        JOIN caregiver c ON f.caregiver_id = c.id
        ORDER BY f.created_at DESC
      `)
      .all();

    return new Response(JSON.stringify({ ok: true, followups: results }), {
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

    if (!['open', 'done', 'dismissed'].includes(body.status)) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid status' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const oldFollowup = await env.LEGACY_DB
      .prepare(`SELECT status FROM followup WHERE id = ?`)
      .bind(body.id)
      .first();

    if (!oldFollowup) {
      return new Response(JSON.stringify({ ok: false, error: 'followup not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    await env.LEGACY_DB
      .prepare(`UPDATE followup SET status = ? WHERE id = ?`)
      .bind(body.status, body.id)
      .run();

    await env.LEGACY_DB
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES ('staff_console', 'followup.update_status', 'followup', ?, ?, ?)
      `)
      .bind(
        body.id.toString(),
        JSON.stringify({ status: oldFollowup.status }),
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
