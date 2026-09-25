// GET/POST /api/agent/[[path]] — site-builder agent editing loop endpoints (slice 07)
// and governed workflow data changes (slice D7-S1).
import { mapRequestToChange, mapRequestToWorkflowChange, validateJsonSchema } from './_mapper.mjs';
import * as grantsDomain from '../../_lib/domain/grants.js';
import * as caregiversDomain from '../../_lib/domain/caregivers.js';
import * as eventsDomain from '../../_lib/domain/events.js';
import { getActor } from '../../_lib/actor.js';
import { internalError } from '../../_lib/errors.js';
import { _resetContentCache, findDisallowedHtml } from '../../_content.mjs';
import { onRequestPost as postTranscribe } from './transcribe.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'agent', 'drafts' | 'changes']

    const action = pathSegments[2];
    if (action === 'drafts') {
      let results;
      try {
        const res = await env.LEGACY_DB
          .prepare(`SELECT id, type_id, data, status, draft_of, updated_by, updated_at FROM content_item WHERE status = 'draft' ORDER BY updated_at DESC`)
          .all();
        results = res.results;
      } catch (err) {
        const res = await env.LEGACY_DB
          .prepare(`SELECT id, type_id, data, status, updated_by, updated_at FROM content_item WHERE status = 'draft' ORDER BY updated_at DESC`)
          .all();
        results = res.results;
      }

      return json({ ok: true, drafts: results });
    }

    if (action === 'changes') {
      const status = url.searchParams.get('status');
      const area = url.searchParams.get('area');
      let query = 'SELECT * FROM agent_change';
      const conditions = [];
      const params = [];

      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }
      if (area) {
        conditions.push('area = ?');
        params.push(area);
      }
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY created_at DESC';

      const stmt = params.length > 0
        ? env.LEGACY_DB.prepare(query).bind(...params)
        : env.LEGACY_DB.prepare(query);

      const { results } = await stmt.all();
      return json({ ok: true, changes: results });
    }

    return json({ ok: false, error: 'invalid route' }, 404);
  } catch (e) {
    return internalError('/api/agent GET', e);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'agent', ...]

    if (pathSegments[2] === 'transcribe') {
      return postTranscribe({ request, env });
    }

    // Governed workflow data changes: /api/agent/change/:subaction
    if (pathSegments.length === 4 && pathSegments[2] === 'change') {
      const subaction = pathSegments[3];
      if (!['draft', 'confirm', 'discard', 'direct'].includes(subaction)) {
        return json({ ok: false, error: 'invalid action' }, 404);
      }

      const body = await request.json().catch(() => ({}));

      if (subaction === 'draft') {
        if (!body.area || !body.target_id || !body.request) {
          return json({ ok: false, error: 'area, target_id, and request are required' }, 400);
        }

        const validAreas = ['grant', 'caregiver', 'event', 'form'];
        if (!validAreas.includes(body.area)) {
          return json({ ok: false, error: `area must be one of: ${validAreas.join(', ')}` }, 400);
        }

        if (body.area !== 'grant' && body.area !== 'caregiver' && body.area !== 'event') {
          return json({ ok: false, refusal: `area ${body.area} is not supported in this slice` });
        }

        let currentRecord = null;
        if (body.area === 'grant') {
          const grantId = parseInt(body.target_id, 10);
          if (isNaN(grantId)) {
            return json({ ok: false, error: 'invalid grant application id' }, 400);
          }
          currentRecord = await env.LEGACY_DB
            .prepare('SELECT id, caregiver_id, requested_for, status, review_notes FROM grant_application WHERE id = ?')
            .bind(grantId)
            .first();

          if (!currentRecord) {
            return json({ ok: false, error: 'grant application not found' }, 404);
          }
        } else if (body.area === 'caregiver') {
          currentRecord = await env.LEGACY_DB
            .prepare('SELECT * FROM caregiver WHERE id = ?')
            .bind(body.target_id)
            .first();

          if (!currentRecord) {
            return json({ ok: false, error: 'caregiver not found' }, 404);
          }
        } else if (body.area === 'event') {
          if (body.target_id && body.target_id !== 'new') {
            currentRecord = await env.LEGACY_DB
              .prepare('SELECT * FROM event WHERE id = ?')
              .bind(body.target_id)
              .first();
          }
        }

        const backend = env.AGENT_MAPPER_BACKEND || null;
        const gatewayUrl = env.EMP_LLM_GATEWAY_URL || null;
        const gatewayKey = env.EMP_LLM_GATEWAY_KEY || null;
        const ai = env.AI || null;
        const model = env.AGENT_MODEL || undefined;

        const mapRes = await mapRequestToWorkflowChange({
          area: body.area,
          target_id: body.target_id,
          request: body.request,
          current: currentRecord,
          backend,
          gatewayUrl,
          gatewayKey,
          ai,
          model,
          role: body.role || 'bulk',
          sensitivity: body.sensitivity || 'low'
        });

        if (!mapRes.ok) {
          return json({ ok: false, refusal: mapRes.refusal });
        }

        const { operation, payload } = mapRes;

        let val;
        if (body.area === 'grant') {
          val = await grantsDomain.validate(env.LEGACY_DB, {
            id: body.target_id,
            operation,
            payload
          });
        } else if (body.area === 'caregiver') {
          val = await caregiversDomain.validate(env.LEGACY_DB, {
            id: body.target_id,
            operation,
            payload
          });
        } else if (body.area === 'event') {
          val = await eventsDomain.validate(env.LEGACY_DB, {
            id: body.target_id,
            operation,
            payload
          });
        }

        if (!val.ok) {
          return json({ ok: false, refusal: `Proposed change cannot be applied: ${val.error}` });
        }

        const change_id = 'ac_' + crypto.randomUUID();
        const actor = getActor(request, env);
        const resolvedTargetId = (val.projected && val.projected.id) ? val.projected.id : body.target_id.toString();

        await env.LEGACY_DB
          .prepare(`
            INSERT INTO agent_change (id, area, operation, target_id, payload_json, before_json, after_json, status, requested_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)
          `)
          .bind(
            change_id,
            body.area,
            operation,
            resolvedTargetId,
            JSON.stringify(payload),
            JSON.stringify(val.before || val.current || {}),
            JSON.stringify(val.after || val.projected || {}),
            actor
          )
          .run();

        return json({
          ok: true,
          change_id,
          change: {
            id: change_id,
            area: body.area,
            operation,
            target_id: body.target_id,
            payload,
            before: val.before || val.current,
            after: val.after || val.projected,
            status: 'draft'
          },
          preview: {
            before: val.before || val.current,
            after: val.after || val.projected
          }
        });
      }

      if (subaction === 'confirm') {
        if (!body.change_id) {
          return json({ ok: false, error: 'change_id is required' }, 400);
        }

        const actor = getActor(request, env);

        const change = await env.LEGACY_DB
          .prepare('SELECT * FROM agent_change WHERE id = ?')
          .bind(body.change_id)
          .first();

        if (!change) {
          return json({ ok: false, error: 'change not found' }, 404);
        }

        if (change.status !== 'draft') {
          return json({ ok: false, error: `cannot confirm change in status ${change.status}` }, 409);
        }

        const payload = JSON.parse(change.payload_json);

        // Re-validate against current record in DB
        let reval;
        if (change.area === 'grant') {
          reval = await grantsDomain.validate(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          });
        } else if (change.area === 'caregiver') {
          reval = await caregiversDomain.validate(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          });
        } else if (change.area === 'event') {
          reval = await eventsDomain.validate(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          });
        }

        if (!reval || !reval.ok) {
          return json({ ok: false, error: `re-validation failed: ${reval?.error || 'state changed'}` }, 409);
        }

        // Verify record has not changed underneath since draft was created
        if (change.before_json && reval.current) {
          try {
            const expectedBefore = JSON.parse(change.before_json);
            for (const [k, v] of Object.entries(expectedBefore)) {
              if (k in reval.current && JSON.stringify(reval.current[k]) !== JSON.stringify(v)) {
                return json({ ok: false, error: `record changed underneath: ${k} was modified since draft` }, 409);
              }
            }
          } catch (e) {
            // fall through
          }
        }

        // Apply via domain module (writes domain audit row with confirming actor)
        let applyRes;
        if (change.area === 'grant') {
          applyRes = await grantsDomain.apply(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          }, actor);
        } else if (change.area === 'caregiver') {
          applyRes = await caregiversDomain.apply(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          }, actor);
        } else if (change.area === 'event') {
          applyRes = await eventsDomain.apply(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          }, actor);
        }

        if (!applyRes || !applyRes.ok) {
          await env.LEGACY_DB
            .prepare("UPDATE agent_change SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(applyRes?.error || 'apply failed', change.id)
            .run();
          return json({ ok: false, error: applyRes?.error || 'apply failed' }, applyRes?.status || 500);
        }

        // Mark published with confirmed_by
        await env.LEGACY_DB
          .prepare("UPDATE agent_change SET status = 'published', confirmed_by = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(actor, change.id)
          .run();

        // Audit log agent_change.confirm
        await env.LEGACY_DB
          .prepare(`
            INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
            VALUES (?, 'agent_change.confirm', 'agent_change', ?, ?, ?)
          `)
          .bind(
            actor,
            change.id,
            JSON.stringify({ status: 'draft' }),
            JSON.stringify({ status: 'published', confirmed_by: actor })
          )
          .run();

        return json({ ok: true });
      }

      if (subaction === 'discard') {
        if (!body.change_id) {
          return json({ ok: false, error: 'change_id is required' }, 400);
        }

        const actor = getActor(request, env);

        const change = await env.LEGACY_DB
          .prepare('SELECT * FROM agent_change WHERE id = ?')
          .bind(body.change_id)
          .first();

        if (!change) {
          return json({ ok: false, error: 'change not found' }, 404);
        }

        if (change.status !== 'draft') {
          return json({ ok: false, error: `cannot discard change in status ${change.status}` }, 409);
        }

        await env.LEGACY_DB
          .prepare("UPDATE agent_change SET status = 'discarded', updated_at = datetime('now') WHERE id = ?")
          .bind(change.id)
          .run();

        await env.LEGACY_DB
          .prepare(`
            INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
            VALUES (?, 'agent_change.discard', 'agent_change', ?, ?, ?)
          `)
          .bind(
            actor,
            change.id,
            JSON.stringify({ status: 'draft' }),
            JSON.stringify({ status: 'discarded' })
          )
          .run();

        return json({ ok: true });
      }

      if (subaction === 'direct') {
        const targetId = body.target_id || body.id;
        if (!targetId || body.data === undefined || body.data === null) {
          return json({ ok: false, error: 'target_id and data are required' }, 400);
        }

        let parsedData = body.data;
        if (typeof parsedData === 'string') {
          try {
            parsedData = JSON.parse(parsedData);
          } catch (e) {
            return json({ ok: false, error: 'data must be a valid JSON object or string' }, 400);
          }
        }
        if (typeof parsedData !== 'object' || Array.isArray(parsedData) || parsedData === null) {
          return json({ ok: false, error: 'data must be a JSON object' }, 400);
        }

        const item = await env.LEGACY_DB
          .prepare('SELECT id, type_id, data, status FROM content_item WHERE id = ?')
          .bind(targetId)
          .first();

        if (!item) {
          return json({ ok: false, error: 'content item not found' }, 404);
        }

        if (item.status !== 'published') {
          return json({ ok: false, error: `cannot directly edit non-published item (status is ${item.status})` }, 409);
        }

        const contentType = await env.LEGACY_DB
          .prepare('SELECT id, json_schema FROM content_type WHERE id = ?')
          .bind(item.type_id)
          .first();

        if (!contentType) {
          return json({ ok: false, error: `content type ${item.type_id} not found` }, 404);
        }

        const jsonSchema = typeof contentType.json_schema === 'string'
          ? JSON.parse(contentType.json_schema)
          : contentType.json_schema;

        const validationErr = validateJsonSchema(parsedData, jsonSchema);
        if (validationErr) {
          return json({ ok: false, error: `validation failed: ${validationErr}`, refusal: `validation failed: ${validationErr}` }, 400);
        }

        const disallowedHtml = findDisallowedHtml(parsedData);
        if (disallowedHtml) {
          return json({ ok: false, error: `disallowed HTML: ${disallowedHtml}`, refusal: `disallowed HTML: ${disallowedHtml}` }, 400);
        }

        // SEC-2: actor comes from the verified identity, never the request body.
        const actor = getActor(request, env);
        const updatedBy = 'staff_' + actor;

        const beforeJson = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
        const afterJson = JSON.stringify(parsedData);

        await env.LEGACY_DB
          .prepare(`
            UPDATE content_item
            SET data = ?, updated_by = ?, updated_at = datetime('now')
            WHERE id = ?
          `)
          .bind(afterJson, updatedBy, item.id)
          .run();

        await env.LEGACY_DB
          .prepare(`
            INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
            VALUES (?, 'content_item.direct_edit', 'content_item', ?, ?, ?)
          `)
          .bind(actor, item.id, beforeJson, afterJson)
          .run();

        try {
          _resetContentCache();
        } catch {}

        return json({ ok: true, id: item.id, updated_by: updatedBy });
      }
    }

    // Existing content editing routes: /api/agent/:action
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
      const ai = env.AI || null;
      const model = env.AGENT_MODEL || undefined;

      const res = await mapRequestToChange({
        request: body.request,
        contentType,
        current: currentData,
        backend,
        gatewayUrl,
        gatewayKey,
        ai,
        model,
        role: body.role || 'bulk',
        sensitivity: body.sensitivity || 'low'
      });

      if (!res.ok) {
        return json({ ok: false, refusal: res.refusal });
      }

      const jsonSchema = typeof contentType.json_schema === 'string'
        ? JSON.parse(contentType.json_schema)
        : contentType.json_schema;
      const validationErr = validateProposal(res.change, jsonSchema);
      if (validationErr) {
        return json({ ok: false, refusal: `Proposed change fails schema validation: ${validationErr}` });
      }

      const disallowedHtml = findDisallowedHtml(res.change);
      if (disallowedHtml) {
        return json({ ok: false, refusal: `Proposed change contains disallowed HTML: ${disallowedHtml}`, error: `disallowed HTML: ${disallowedHtml}` });
      }

      let draftData = { ...res.change };
      if (body.type_id === 'page_section') {
        const { section_key, ...changes } = res.change;
        draftData = currentData ? { ...currentData, ...changes } : changes;
      } else if (currentData) {
        draftData = { ...currentData, ...res.change };
      }

      const isTargeted = Boolean(body.target_id);
      const draft_id = isTargeted ? ('cid_' + crypto.randomUUID()) : (body.target_id || ('ci_' + crypto.randomUUID()));
      const draft_of = isTargeted ? body.target_id : null;
      const dataStr = JSON.stringify(draftData);

      await env.LEGACY_DB
        .prepare(`
          INSERT INTO content_item (id, type_id, data, status, draft_of, updated_by, updated_at)
          VALUES (?, ?, ?, 'draft', ?, 'agent', datetime('now'))
        `)
        .bind(draft_id, body.type_id, dataStr, draft_of)
        .run();

      return json({
        ok: true,
        draft_id,
        draft: {
          id: draft_id,
          type_id: body.type_id,
          data: draftData,
          status: 'draft',
          draft_of
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

      let item;
      try {
        item = await env.LEGACY_DB
          .prepare(`SELECT id, type_id, status, data, draft_of FROM content_item WHERE id = ?`)
          .bind(body.draft_id)
          .first();
      } catch (err) {
        item = await env.LEGACY_DB
          .prepare(`SELECT id, type_id, status, data FROM content_item WHERE id = ?`)
          .bind(body.draft_id)
          .first();
      }

      if (!item) {
        return json({ ok: false, error: 'draft not found' }, 404);
      }

      if (item.status !== 'draft') {
        return json({ ok: false, error: `cannot confirm from status ${item.status}` }, 409);
      }

      if (item.draft_of) {
        const target = await env.LEGACY_DB
          .prepare(`SELECT id, type_id, status, data, updated_by FROM content_item WHERE id = ?`)
          .bind(item.draft_of)
          .first();

        if (!target) {
          return json({ ok: false, error: 'target item not found' }, 404);
        }

        await env.LEGACY_DB
          .prepare(`UPDATE content_item SET data = ?, status = 'published', updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(item.data, 'staff_' + actor, item.draft_of)
          .run();

        await env.LEGACY_DB
          .prepare(`UPDATE content_item SET status = 'archived', updated_at = datetime('now') WHERE id = ?`)
          .bind(body.draft_id)
          .run();

        await env.LEGACY_DB
          .prepare(`
            INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
            VALUES (?, 'content_item.publish', 'content_item', ?, ?, ?)
          `)
          .bind(
            actor,
            item.draft_of,
            JSON.stringify({ status: target.status, data: JSON.parse(target.data) }),
            JSON.stringify({ status: 'published', data: JSON.parse(item.data) })
          )
          .run();

        return json({ ok: true });
      } else {
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
    }

    if (action === 'discard') {
      if (!body.draft_id) {
        return json({ ok: false, error: 'draft_id is required' }, 400);
      }

      let item;
      try {
        item = await env.LEGACY_DB
          .prepare(`SELECT status, data, draft_of FROM content_item WHERE id = ?`)
          .bind(body.draft_id)
          .first();
      } catch (err) {
        item = await env.LEGACY_DB
          .prepare(`SELECT status, data FROM content_item WHERE id = ?`)
          .bind(body.draft_id)
          .first();
      }

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
    return internalError('/api/agent POST', e);
  }
}

function validateProposal(change, schema) {
  if (!change || typeof change !== 'object') return 'data must be an object';

  if (Array.isArray(schema.oneOf)) {
    if (!change.section_key) {
      return 'missing required property: section_key';
    }
    const branch = schema.oneOf.find(
      (b) =>
        b.properties?.section_key?.const === change.section_key ||
        b.properties?.section_key?.enum?.includes(change.section_key)
    );
    if (!branch) {
      return `section_key '${change.section_key}' does not match any valid section schema`;
    }

    if (branch.required) {
      for (const req of branch.required) {
        if (!(req in change) || change[req] === undefined || change[req] === null) {
          return `missing required property: ${req}`;
        }
      }
    }

    for (const [key, val] of Object.entries(change)) {
      const propSchema = branch.properties?.[key];
      if (!propSchema) {
        if (branch.additionalProperties === false) {
          return `unsupported additional property: ${key}`;
        }
        continue;
      }

      if (propSchema.readOnly) {
        return `cannot modify read-only property: ${key}`;
      }

      if (propSchema.type === 'string') {
        if (typeof val !== 'string') {
          return `property ${key} must be a string`;
        }
        if (propSchema.maxLength && val.length > propSchema.maxLength) {
          return `property ${key} exceeds maximum length of ${propSchema.maxLength}`;
        }
      } else if (propSchema.type === 'array') {
        if (!Array.isArray(val)) {
          return `property ${key} must be an array`;
        }
        if (propSchema.maxItems && val.length > propSchema.maxItems) {
          return `property ${key} exceeds maximum items of ${propSchema.maxItems}`;
        }
        if (propSchema.items) {
          for (const it of val) {
            if (propSchema.items.type === 'string' && typeof it !== 'string') {
              return `items of ${key} must be strings`;
            }
            if (propSchema.items.maxLength && typeof it === 'string' && it.length > propSchema.items.maxLength) {
              return `item of ${key} exceeds maximum length of ${propSchema.items.maxLength}`;
            }
          }
        }
      }
    }

    return null;
  }

  return validateJsonSchema(change, schema);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
