// GET/POST /api/grants — staff endpoints for managing grant applications (slice 06).
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = `
      SELECT g.id, g.caregiver_id, g.requested_for, g.status, g.review_notes, g.source, g.external_ref, g.created_at, g.updated_at,
             c.first_name AS caregiver_first_name, c.last_name AS caregiver_last_name,
             a.id AS award_id, a.amount AS award_amount, a.care_package AS award_care_package, a.outcome AS award_outcome
      FROM grant_application g
      LEFT JOIN caregiver c ON g.caregiver_id = c.id
      LEFT JOIN award a ON g.id = a.grant_application_id
    `;

    let stmt;
    if (status) {
      query += ` WHERE g.status = ? ORDER BY g.created_at DESC`;
      stmt = env.LEGACY_DB.prepare(query).bind(status);
    } else {
      query += ` ORDER BY g.created_at DESC`;
      stmt = env.LEGACY_DB.prepare(query);
    }

    const { results } = await stmt.all();

    return json({ ok: true, grants: results });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'grants', ':id', ':action']

    if (pathSegments.length !== 4) {
      return json({ ok: false, error: 'invalid route parameters' }, 400);
    }

    const id = parseInt(pathSegments[2], 10);
    const action = pathSegments[3];

    if (isNaN(id)) {
      return json({ ok: false, error: 'invalid grant application id' }, 400);
    }

    if (!['review', 'decision', 'close'].includes(action)) {
      return json({ ok: false, error: 'invalid action' }, 404);
    }

    const app = await env.LEGACY_DB
      .prepare(`SELECT status, review_notes, caregiver_id FROM grant_application WHERE id = ?`)
      .bind(id)
      .first();

    if (!app) {
      return json({ ok: false, error: 'grant application not found' }, 404);
    }

    const body = await request.json().catch(() => ({}));

    if (action === 'review') {
      if (app.status !== 'submitted' && app.status !== 'in_review') {
        return json({ ok: false, error: `cannot review from status ${app.status}` }, 409);
      }

      const review_notes = body.review_notes || app.review_notes || null;
      await env.LEGACY_DB
        .prepare(`UPDATE grant_application SET status = 'in_review', review_notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(review_notes, id)
        .run();

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
          VALUES ('staff_console', 'grant_application.review', 'grant_application', ?, ?, ?)
        `)
        .bind(
          id.toString(),
          JSON.stringify({ status: app.status, review_notes: app.review_notes }),
          JSON.stringify({ status: 'in_review', review_notes })
        )
        .run();

      return json({ ok: true });
    }

    if (action === 'decision') {
      if (app.status !== 'in_review') {
        return json({ ok: false, error: `cannot make decision from status ${app.status}` }, 409);
      }

      if (!['awarded', 'declined'].includes(body.decision)) {
        return json({ ok: false, error: "decision must be 'awarded' or 'declined'" }, 400);
      }

      const review_notes = body.review_notes || app.review_notes || null;
      
      // Perform DB updates
      await env.LEGACY_DB
        .prepare(`UPDATE grant_application SET status = ?, review_notes = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(body.decision, review_notes, id)
        .run();

      if (body.decision === 'awarded') {
        await env.LEGACY_DB
          .prepare(`INSERT INTO award (grant_application_id, amount, care_package) VALUES (?, ?, ?)`)
          .bind(id, body.amount || null, body.care_package || null)
          .run();

        await env.LEGACY_DB
          .prepare(`
            INSERT INTO followup (caregiver_id, kind, detail, source, external_ref)
            VALUES (?, 'grant_award_delivery', ?, 'staff_console', ?)
          `)
          .bind(app.caregiver_id, 'Deliver care package', `grant_award_${id}`)
          .run();
      }

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
          VALUES ('staff_console', 'grant_application.decision', 'grant_application', ?, ?, ?)
        `)
        .bind(
          id.toString(),
          JSON.stringify({ status: app.status, review_notes: app.review_notes }),
          JSON.stringify({
            status: body.decision,
            review_notes,
            award: body.decision === 'awarded' ? { amount: body.amount || null, care_package: body.care_package || null } : null
          })
        )
        .run();

      return json({ ok: true });
    }

    if (action === 'close') {
      if (app.status !== 'awarded' && app.status !== 'declined') {
        return json({ ok: false, error: `cannot close from status ${app.status}` }, 409);
      }

      await env.LEGACY_DB
        .prepare(`UPDATE grant_application SET status = 'closed', updated_at = datetime('now') WHERE id = ?`)
        .bind(id)
        .run();

      const award = await env.LEGACY_DB
        .prepare(`SELECT id, outcome FROM award WHERE grant_application_id = ?`)
        .bind(id)
        .first();

      const outcome = body.outcome || null;
      if (award) {
        await env.LEGACY_DB
          .prepare(`UPDATE award SET outcome = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(outcome, award.id)
          .run();
      }

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
          VALUES ('staff_console', 'grant_application.close', 'grant_application', ?, ?, ?)
        `)
        .bind(
          id.toString(),
          JSON.stringify({ status: app.status }),
          JSON.stringify({ status: 'closed', outcome })
        )
        .run();

      return json({ ok: true });
    }

    return json({ ok: false, error: 'unsupported action' }, 400);
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
