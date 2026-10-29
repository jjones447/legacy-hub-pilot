// GET/POST /api/agent/[[path]] — site-builder agent editing loop endpoints (slice 07)
// and governed workflow data changes (slice D7-S1).
import { mapRequestToChange, mapRequestToWorkflowChange, validateJsonSchema, resolveContentTarget } from './_mapper.mjs';
import * as grantsDomain from '../../_lib/domain/grants.js';
import * as caregiversDomain from '../../_lib/domain/caregivers.js';
import * as eventsDomain from '../../_lib/domain/events.js';
import { getActor } from '../../_lib/actor.js';
import { internalError } from '../../_lib/errors.js';
import { _resetContentCache, findDisallowedHtml, buildContentPreviewInfo } from '../../_content.mjs';
import { onRequestPost as postTranscribe } from './transcribe.js';
import { confirmationActor, draftOwner, ownsDraft, confirmationBinding, confirmationAudit, matchesPersistedPreview } from '../../_lib/agent-confirmation.mjs';
import { createWebJob, enabled as webJobsEnabled } from '../../_lib/assistant-web-jobs.mjs';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'agent', 'drafts' | 'changes' | 'preview']

    const action = pathSegments[2];
    if (action === 'preview') {
      const draftId = url.searchParams.get('draft_id');
      if (!draftId) {
        return json({ ok: false, error: 'draft_id is required' }, 400);
      }
      const item = await env.LEGACY_DB
        .prepare('SELECT id, type_id, data, status, draft_of, updated_by, updated_at FROM content_item WHERE id = ?')
        .bind(draftId)
        .first();
      if (!item) {
        return json({ ok: false, error: 'draft not found' }, 404);
      }
      const afterData = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
      let beforeData = {};
      let targetRow = null;
      if (item.draft_of) {
        targetRow = await env.LEGACY_DB
          .prepare('SELECT id, type_id, data, status, updated_by, updated_at FROM content_item WHERE id = ?')
          .bind(item.draft_of)
          .first();
        if (targetRow && targetRow.data) {
          beforeData = typeof targetRow.data === 'string' ? JSON.parse(targetRow.data) : targetRow.data;
        }
      }
      const binding = await confirmationBinding(env.LEGACY_DB, 'content', item, url.origin, targetRow);
      const previewInfo = buildContentPreviewInfo({
        draftId: item.id,
        targetId: item.draft_of || item.id,
        typeId: item.type_id,
        itemData: afterData,
        previewVersion: binding.version,
        requestUrl: request.url,
        env,
      });
      return json({
        ok: true,
        draft_id: item.id,
        draft_of: item.draft_of || null,
        type_id: item.type_id,
        status: item.status,
        updated_at: item.updated_at,
        preview_version: binding.version,
        ...previewInfo,
        before: beforeData,
        after: afterData,
      });
    }

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

export async function onRequestPost({ request, env, data, redactErrors = false, draftGuards = [] }) {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(Boolean); // ['api', 'agent', ...]

    if (webJobsEnabled(env) && ['/api/agent/draft','/api/agent/change/draft'].includes(url.pathname)) {
      return createWebJob({ request, env, data });
    }

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
        const actor = draftOwner(confirmationActor(data)) || getActor(request, env);
        const resolvedTargetId = String((val.projected && val.projected.id) ? val.projected.id : body.target_id);

        const draftInsert = env.LEGACY_DB
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
          );
        // Optional statements originate ONLY in a trusted internal job materializer, never request JSON.
        if (draftGuards.length) await env.LEGACY_DB.batch([...draftGuards, draftInsert]);
        else await draftInsert.run();

        const savedChange = await env.LEGACY_DB.prepare('SELECT * FROM agent_change WHERE id = ?').bind(change_id).first();
        const binding = await confirmationBinding(env.LEGACY_DB, 'workflow', savedChange, url.origin, val.current || currentRecord || null);
        return json({
          ok: true,
          change_id,
          preview_version: ownsDraft(actor, confirmationActor(data)) ? binding.version : null,
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

        const actor = confirmationActor(data);
        if (!actor || Object.hasOwn(body, 'thread_id') || Object.hasOwn(body, 'conversation_id')) return json({ ok: false, error: 'human confirmation context not qualified' }, 403);

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
        if (!ownsDraft(change.requested_by, actor)) return json({ ok: false, error: 'only the verified initiating staff member can confirm' }, 403);
        const binding = await confirmationBinding(env.LEGACY_DB, 'workflow', change, url.origin);
        if (typeof body.preview_version !== 'string' || body.preview_version !== binding.version) {
          return json({ ok: false, error: 'preview version missing or changed; confirmation refused' }, 409);
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

        // Compare the entire domain preview, including secondary state represented
        // by the existing contract. Malformed metadata never falls through.
        if (!matchesPersistedPreview(change, reval)) return json({ ok: false, error: 'record changed underneath: server preview no longer matches' }, 409);

        // Trusted server-side statements join the domain mutations and original audit.
        const additionalStatements = [
          env.LEGACY_DB
            .prepare("UPDATE agent_change SET status = 'published', confirmed_by = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(actor, change.id),
        ];
        const preconditions = [confirmationAudit(env.LEGACY_DB, binding, actor, 'agent_change.confirm', 'agent_change', change.id,
          { status: 'draft' }, { status: 'published', confirmed_by: actor })];
        // Domain apply commits its mutation(s), original audit and these statements together.
        let applyRes;
        if (change.area === 'grant') {
          applyRes = await grantsDomain.apply(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          }, actor, additionalStatements, preconditions);
        } else if (change.area === 'caregiver') {
          applyRes = await caregiversDomain.apply(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          }, actor, additionalStatements, preconditions);
        } else if (change.area === 'event') {
          applyRes = await eventsDomain.apply(env.LEGACY_DB, {
            id: change.target_id,
            operation: change.operation,
            payload
          }, actor, additionalStatements, preconditions);
        }

        if (!applyRes || !applyRes.ok) {
          // A changed target can refuse in domain re-validation. Do not mutate
          // the draft merely to label an unconfirmed operation as failed.
          return json({ ok: false, error: applyRes?.error || 'apply failed' }, applyRes?.status || 500);
        }

        return json({ ok: true });
      }

      if (subaction === 'discard') {
        if (!body.change_id) {
          return json({ ok: false, error: 'change_id is required' }, 400);
        }

        const actor = confirmationActor(data);
        if (!actor || Object.hasOwn(body, 'thread_id') || Object.hasOwn(body, 'conversation_id')) return json({ ok: false, error: 'human discard context not qualified' }, 403);

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
        if (!ownsDraft(change.requested_by, actor)) return json({ ok: false, error: 'only the verified initiating staff member can discard' }, 403);
        const binding = await confirmationBinding(env.LEGACY_DB, 'workflow', change, url.origin);
        if (typeof body.preview_version !== 'string' || body.preview_version !== binding.version) {
          return json({ ok: false, error: 'preview version missing or changed; discard refused' }, 409);
        }

        await env.LEGACY_DB.batch([
          confirmationAudit(env.LEGACY_DB, binding, actor, 'agent_change.discard', 'agent_change', change.id,
            { status: 'draft' }, { status: 'discarded' }),
          env.LEGACY_DB
            .prepare("UPDATE agent_change SET status = 'discarded', updated_at = datetime('now') WHERE id = ?")
            .bind(change.id),
        ]);

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

        // The content mutation and original audit must commit or roll back together.
        await env.LEGACY_DB.batch([
          env.LEGACY_DB.prepare(`
            UPDATE content_item
            SET data = ?, updated_by = ?, updated_at = datetime('now')
            WHERE id = ?
          `)
          .bind(afterJson, updatedBy, item.id),
          env.LEGACY_DB.prepare(`
            INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
            VALUES (?, 'content_item.direct_edit', 'content_item', ?, ?, ?)
          `)
          .bind(actor, item.id, beforeJson, afterJson),
        ]);

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
      if (!body.request || typeof body.request !== 'string' || !body.request.trim()) {
        return json({ ok: false, error: 'request and type_id are required' }, 400);
      }

      let resolvedTypeId = (body.type_id && body.type_id !== 'auto') ? body.type_id : null;
      let resolvedTargetId = body.target_id || null;
      let currentData = null;
      let currentItem = null;

      if (!resolvedTargetId && !resolvedTypeId) {
        let publishedItems = [];
        try {
          const pubRes = await env.LEGACY_DB
            .prepare("SELECT id, type_id, data, status, updated_by, updated_at FROM content_item WHERE status = 'published' ORDER BY id")
            .all();
          publishedItems = pubRes.results || [];
        } catch {
          publishedItems = [];
        }

        const resolution = resolveContentTarget({
          request: body.request,
          publishedItems,
          area: body.area || 'auto',
        });

        if (resolution.clarification_needed) {
          return json({
            ok: true,
            clarification_needed: true,
            reason: resolution.reason,
            message: resolution.message,
            candidates: resolution.candidates || [],
            ...(resolution.workflow_area ? { workflow_area: resolution.workflow_area } : {}),
          });
        }

        resolvedTargetId = resolution.target_id;
        resolvedTypeId = resolution.type_id;
        currentItem = resolution.item;
        currentData = resolution.currentData;
      }

      if (!resolvedTypeId) {
        return json({ ok: false, error: 'request and type_id are required' }, 400);
      }

      const contentType = await env.LEGACY_DB
        .prepare(`SELECT id, json_schema FROM content_type WHERE id = ?`)
        .bind(resolvedTypeId)
        .first();

      if (!contentType) {
        return json({ ok: false, error: `content type ${resolvedTypeId} not found` }, 404);
      }

      if (resolvedTargetId && !currentItem) {
        const item = await env.LEGACY_DB
          .prepare(`SELECT * FROM content_item WHERE id = ? AND type_id = ?`)
          .bind(resolvedTargetId, resolvedTypeId)
          .first();

        if (!item) {
          return json({ ok: false, error: `content item ${resolvedTargetId} not found` }, 404);
        }
        currentData = JSON.parse(item.data);
        currentItem = item;
      }

      if (resolvedTypeId === 'page_section' && currentData && !currentData.section_key && resolvedTargetId?.startsWith('ps_')) {
        currentData = { section_key: resolvedTargetId.slice(3), ...currentData };
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

      if (resolvedTypeId === 'page_section' && currentData?.section_key && res.change && typeof res.change === 'object' && !('section_key' in res.change)) {
        res.change = { section_key: currentData.section_key, ...res.change };
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
      if (resolvedTypeId === 'page_section') {
        const { section_key, ...changes } = res.change;
        draftData = currentData ? { ...currentData, ...changes } : changes;
      } else if (currentData) {
        draftData = { ...currentData, ...res.change };
      }

      const isTargeted = Boolean(resolvedTargetId);
      const draft_id = isTargeted ? ('cid_' + crypto.randomUUID()) : (resolvedTargetId || ('ci_' + crypto.randomUUID()));
      const draft_of = isTargeted ? resolvedTargetId : null;
      const dataStr = JSON.stringify(draftData);

      const draftInsert = env.LEGACY_DB
        .prepare(`
          INSERT INTO content_item (id, type_id, data, status, draft_of, updated_by, updated_at)
          VALUES (?, ?, ?, 'draft', ?, ?, datetime('now'))
        `)
        .bind(draft_id, resolvedTypeId, dataStr, draft_of, draftOwner(confirmationActor(data)) || 'agent');
      if (draftGuards.length) await env.LEGACY_DB.batch([...draftGuards, draftInsert]);
      else await draftInsert.run();

      const savedDraft = await env.LEGACY_DB.prepare('SELECT * FROM content_item WHERE id = ?').bind(draft_id).first();
      const binding = await confirmationBinding(env.LEGACY_DB, 'content', savedDraft, url.origin, currentItem);
      const previewInfo = buildContentPreviewInfo({
        draftId: draft_id,
        targetId: draft_of || draft_id,
        typeId: resolvedTypeId,
        itemData: draftData,
        previewVersion: binding.version,
        requestUrl: request.url,
        env,
      });
      return json({
        ok: true,
        draft_id,
        resolved_target_id: draft_of || draft_id,
        ...previewInfo,
        preview_version: confirmationActor(data) ? binding.version : null,
        confirmation_preview: { before: currentData || {}, after: draftData },
        draft: {
          id: draft_id,
          type_id: resolvedTypeId,
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
      const actor = confirmationActor(data);
      if (!actor || Object.hasOwn(body, 'thread_id') || Object.hasOwn(body, 'conversation_id')) return json({ ok: false, error: 'human confirmation context not qualified' }, 403);

      let item;
      try {
        item = await env.LEGACY_DB
          .prepare(`SELECT * FROM content_item WHERE id = ?`)
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
      if (!ownsDraft(item.updated_by, actor)) return json({ ok: false, error: 'only the verified initiating staff member can confirm' }, 403);
      const binding = await confirmationBinding(env.LEGACY_DB, 'content', item, url.origin);
      if (typeof body.preview_version !== 'string' || body.preview_version !== binding.version) {
        return json({ ok: false, error: 'preview version missing or changed; confirmation refused' }, 409);
      }

      if (item.draft_of) {
        const target = await env.LEGACY_DB
          .prepare(`SELECT id, type_id, status, data, updated_by FROM content_item WHERE id = ?`)
          .bind(item.draft_of)
          .first();

        if (!target) {
          return json({ ok: false, error: 'target item not found' }, 404);
        }

        // Include draft archival: a failed archive or audit must leave the target unchanged.
        await env.LEGACY_DB.batch([
          confirmationAudit(env.LEGACY_DB, binding, actor, 'content_item.publish', 'content_item', item.draft_of,
            { status: target.status, data: JSON.parse(target.data) }, { status: 'published', data: JSON.parse(item.data) }),
          env.LEGACY_DB.prepare(`UPDATE content_item SET data = ?, status = 'published', updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
            .bind(item.data, 'staff_' + actor, item.draft_of),
          env.LEGACY_DB.prepare(`UPDATE content_item SET status = 'archived', updated_at = datetime('now') WHERE id = ?`)
            .bind(body.draft_id),
        ]);

        return json({ ok: true });
      } else {
        await env.LEGACY_DB.batch([
          confirmationAudit(env.LEGACY_DB, binding, actor, 'content_item.publish', 'content_item', body.draft_id,
            { status: 'draft', data: JSON.parse(item.data) }, { status: 'published', data: JSON.parse(item.data) }),
          env.LEGACY_DB.prepare(`UPDATE content_item SET status = 'published', updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
            .bind('staff_' + actor, body.draft_id),
        ]);

        return json({ ok: true });
      }
    }

    if (action === 'discard') {
      if (!body.draft_id) {
        return json({ ok: false, error: 'draft_id is required' }, 400);
      }

      const actor = confirmationActor(data);
      if (!actor || Object.hasOwn(body, 'thread_id') || Object.hasOwn(body, 'conversation_id')) return json({ ok: false, error: 'human discard context not qualified' }, 403);
      const item = await env.LEGACY_DB.prepare('SELECT * FROM content_item WHERE id = ?').bind(body.draft_id).first();

      if (!item) {
        return json({ ok: false, error: 'draft not found' }, 404);
      }

      if (item.status !== 'draft') {
        return json({ ok: false, error: `cannot discard from status ${item.status}` }, 409);
      }
      if (!ownsDraft(item.updated_by, actor)) return json({ ok: false, error: 'only the verified initiating staff member can discard' }, 403);
      const binding = await confirmationBinding(env.LEGACY_DB, 'content', item, url.origin);
      if (typeof body.preview_version !== 'string' || body.preview_version !== binding.version) {
        return json({ ok: false, error: 'preview version missing or changed; discard refused' }, 409);
      }

      await env.LEGACY_DB.batch([
        confirmationAudit(env.LEGACY_DB, binding, actor, 'content_item.discard', 'content_item', body.draft_id,
          { status: 'draft', data: JSON.parse(item.data) }, { status: 'archived', data: JSON.parse(item.data) }),
        env.LEGACY_DB.prepare(`UPDATE content_item SET status = 'archived', updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind('staff_' + actor, body.draft_id),
      ]);

      return json({ ok: true });
    }

    return json({ ok: false, error: 'unsupported action' }, 400);
  } catch (e) {
    // Trusted internal handoff calls suppress raw provider/DB error details.
    // This option is server context, never accepted from request JSON.
    if (redactErrors) return json({ ok: false, error: 'internal_error' }, 500);
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
