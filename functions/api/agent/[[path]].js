// GET/POST /api/agent/[[path]] — site-builder agent editing loop endpoints (slice 07).
import { mapRequestToChange, validateJsonSchema } from './_mapper.mjs';

// Actor identity from the CF Access JWT (already signature-verified by _middleware.js
// before this handler runs). x-dev-actor is honored ONLY in the non-prod dev-console
// mode. Never trust a client-supplied staff_id in the body (SEC-2).
function getActor(request, env) {
  if (env && env.ALLOW_DEV_CONSOLE === '1') {
    const dev = request.headers.get('x-dev-actor');
    if (dev) return dev;
  }
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (jwt) {
    try {
      const p = jwt.split('.');
      if (p.length === 3) {
        const payload = JSON.parse(atob(p[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.email || payload.sub || 'staff';
      }
    } catch { /* fall through */ }
  }
  return 'staff';
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'agent', 'drafts']

    const action = pathSegments[2];
    if (action !== 'drafts') {
      return json({ ok: false, error: 'invalid route' }, 404);
    }

    const { results } = await env.LEGACY_DB
      .prepare(`SELECT id, type_id, data, status, updated_by, updated_at FROM content_item WHERE status = 'draft' ORDER BY updated_at DESC`)
      .all();

    return json({ ok: true, drafts: results });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'agent', ':action']

    const action = pathSegments[2];
    if (!['draft', 'confirm', 'discard'].includes(action)) {
      return json({ ok: false, error: 'invalid action' }, 404);
    }

    const body = await request.json().catch(() => ({}));

    if (action === 'draft') {
      if (!body.request || !body.type_id) {
        return json({ ok: false, error: 'request and type_id are required' }, 400);
      }

      const contentType = await env.LEGACY_DB
        .prepare(`SELECT id, json_schema FROM content_type WHERE id = ?`)
        .bind(body.type_id)
        .first();

      if (!contentType) {
        return json({ ok: false, error: `content type ${body.type_id} not found` }, 404);
      }

      let currentData = null;
      if (body.target_id) {
        const item = await env.LEGACY_DB
          .prepare(`SELECT data FROM content_item WHERE id = ? AND type_id = ?`)
          .bind(body.target_id, body.type_id)
          .first();

        if (!item) {
          return json({ ok: false, error: `content item ${body.target_id} not found` }, 404);
        }
        currentData = JSON.parse(item.data);
      }

      const backend = env.AGENT_MAPPER_BACKEND || null;
      const gatewayUrl = env.EMP_LLM_GATEWAY_URL || null;
      const gatewayKey = env.EMP_LLM_GATEWAY_KEY || null;

      const res = await mapRequestToChange({
        request: body.request,
        contentType,
        current: currentData,
        backend,
        gatewayUrl,
        gatewayKey,
        role: body.role || 'bulk',
        sensitivity: body.sensitivity || 'low'
      });

      if (!res.ok) {
        return json({ ok: false, refusal: res.refusal });
      }

      const jsonSchema = typeof contentType.json_schema === 'string'
        ? JSON.parse(contentType.json_schema)
        : contentType.json_schema;
      const validationErr = validateJsonSchema(res.change, jsonSchema);
      if (validationErr) {
        return json({ ok: false, refusal: `Proposed change fails schema validation: ${validationErr}` });
      }

      const draft_id = body.target_id || ('ci_' + crypto.randomUUID());
      const dataStr = JSON.stringify(res.change);

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO content_item (id, type_id, data, status, updated_by, updated_at)
          VALUES (?, ?, ?, 'draft', 'agent', datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            data = excluded.data,
            status = 'draft',
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        `)
        .bind(draft_id, body.type_id, dataStr)
        .run();

      return json({
        ok: true,
        draft_id,
        draft: {
          id: draft_id,
          type_id: body.type_id,
          data: res.change,
          status: 'draft'
        },
        preview: res.change
      });
    }

    if (action === 'confirm') {
      if (!body.draft_id) {
        return json({ ok: false, error: 'draft_id is required' }, 400);
      }
      // SEC-2: actor comes from the verified identity, never the request body.
      const actor = getActor(request, env);

      const item = await env.LEGACY_DB
        .prepare(`SELECT status, data FROM content_item WHERE id = ?`)
        .bind(body.draft_id)
        .first();

      if (!item) {
        return json({ ok: false, error: 'draft not found' }, 404);
      }

      if (item.status !== 'draft') {
        return json({ ok: false, error: `cannot confirm from status ${item.status}` }, 409);
      }

      await env.LEGACY_DB
        .prepare(`UPDATE content_item SET status = 'published', updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind('staff_' + actor, body.draft_id)
        .run();

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
          VALUES (?, 'content_item.publish', 'content_item', ?, ?, ?)
        `)
        .bind(
          actor,
          body.draft_id,
          JSON.stringify({ status: 'draft', data: JSON.parse(item.data) }),
          JSON.stringify({ status: 'published', data: JSON.parse(item.data) })
        )
        .run();

      return json({ ok: true });
    }

    if (action === 'discard') {
      if (!body.draft_id) {
        return json({ ok: false, error: 'draft_id is required' }, 400);
      }

      const item = await env.LEGACY_DB
        .prepare(`SELECT status, data FROM content_item WHERE id = ?`)
        .bind(body.draft_id)
        .first();

      if (!item) {
        return json({ ok: false, error: 'draft not found' }, 404);
      }

      if (item.status !== 'draft') {
        return json({ ok: false, error: `cannot discard from status ${item.status}` }, 409);
      }

      await env.LEGACY_DB
        .prepare(`UPDATE content_item SET status = 'archived', updated_by = 'staff', updated_at = datetime('now') WHERE id = ?`)
        .bind(body.draft_id)
        .run();

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
          VALUES ('staff', 'content_item.discard', 'content_item', ?, ?, ?)
        `)
        .bind(
          body.draft_id,
          JSON.stringify({ status: 'draft', data: JSON.parse(item.data) }),
          JSON.stringify({ status: 'archived', data: JSON.parse(item.data) })
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
