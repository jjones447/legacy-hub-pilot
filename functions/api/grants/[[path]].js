// GET/POST /api/grants — staff endpoints for managing grant applications (slice 06).
import { getActor } from '../../_lib/actor.js';
import { internalError } from '../../_lib/errors.js';
import * as grantsDomain from '../../_lib/domain/grants.js';

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
    return internalError('/api/grants GET', e);
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

    if (!['review', 'decision', 'course_complete', 'course-complete', 'close'].includes(action)) {
      return json({ ok: false, error: 'invalid action' }, 404);
    }

    const actor = getActor(request, env);
    const body = await request.json().catch(() => ({}));

    const result = await grantsDomain.apply(env.LEGACY_DB, { id, operation: action, payload: body }, actor);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, result.status);
    }

    return json({ ok: true });
  } catch (e) {
    return internalError('/api/grants POST', e);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
