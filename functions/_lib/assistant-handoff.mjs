// Existing governed app integration. No model confirm tool, secret getter or audit repair.
import { confirmationActor, ownsDraft, confirmationBinding } from './agent-confirmation.mjs';
import { onRequestPost as agentPost } from '../api/agent/[[path]].js';

const enc = new TextEncoder();
const MAX_BODY = 16384;
const TTL_MS = 15 * 60 * 1000;
const CHALLENGE_MS = 3 * 60 * 1000;
const FIELDS = { content: ['title'], forms: ['name_label'], caregiver: ['segment_tags'], event: ['title'], grant: ['status', 'review_notes'] };
const content = area => area === 'content' || area === 'forms';
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => plain(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const text = (v, max = 120) => typeof v === 'string' && v.length > 0 && v.length <= max;
const canonical = v => Array.isArray(v) ? v.map(canonical) : plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
export const sha256 = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const random = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
const refused = (status = 403) => response({ ok: false, error: 'handoff_refused' }, status);
const held = () => response({ ok: false, error: 'handoff_hold', state: 'hold' }, 409);

function config(env, origin) {
  if (env.ASSISTANT_HANDOFF_ENABLED !== '1' || env.ASSISTANT_APP_ORIGIN !== origin
      || !/^https:\/\/[^/?#@]+$/.test(origin) || !/^T[A-Z0-9]+$/.test(env.ASSISTANT_WORKSPACE || '')
      || !/^C[A-Z0-9]+$/.test(env.ASSISTANT_CHANNEL || '') || !env.LEGACY_DB) return null;
  let catalog;
  try { catalog = JSON.parse(env.ASSISTANT_TARGETS_JSON); } catch { return null; }
  if (!Array.isArray(catalog) || catalog.length < 5 || catalog.length > 128 || catalog.some(t => !plain(t))) return null;
  if (!Object.keys(FIELDS).every(area => catalog.some(t => t.area === area))
      || new Set(catalog.map(t => JSON.stringify([t.area,t.target_id]))).size !== catalog.length) return null;
  for (const t of catalog) {
    if (!plain(t) || !exact(t, content(t.area) ? ['area', 'target_id', 'type_id'] : ['area', 'target_id'])
        || !Object.hasOwn(FIELDS, t.area) || !text(t.target_id) || t.target_id === 'new'
        || (content(t.area) && t.type_id !== 'page_section')
        || (t.area === 'grant' && !/^[1-9][0-9]*$/.test(t.target_id))) return null;
  }
  return catalog;
}
async function bodyText(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new Error('body'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
const rowFor = (db, id) => db.prepare('SELECT * FROM assistant_handoff WHERE id = ?').bind(id).first();
const live = (row, now) => row && row.expires_at > now;
async function transition(db, row, from, to, values = {}) {
  // Keys are server source constants, never wire/model arguments.
  const keys = Object.keys(values);
  const result = await db.prepare(`UPDATE assistant_handoff SET state = ?${keys.map(k => `, ${k} = ?`).join('')} WHERE id = ? AND state = ? RETURNING id`)
    .bind(to, ...keys.map(k => values[k]), row.id, from).first();
  return Boolean(result);
}
async function hmacValid(request, raw, secret, now) {
  const stamp = request.headers.get('x-legacy-timestamp') || '';
  const signature = request.headers.get('x-legacy-signature') || '';
  if (!text(secret, 1024) || secret.length < 32 || !/^[0-9]{13}$/.test(stamp)
      || Math.abs(now - Number(stamp)) > 60000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const data = `${stamp}\n${new URL(request.url).origin}\nPOST\n/api/assistant-intake\n${await sha256(raw)}`;
  const bytes = Uint8Array.from(signature.match(/../g), x => parseInt(x, 16));
  return crypto.subtle.verify('HMAC', key, bytes, enc.encode(data));
}
function machineReceipt(row) {
  return { ok: true, handoff_id: row.id, state: row.state, workspace: row.workspace, channel: row.channel,
    thread: row.thread, delivery_id: row.delivery_id, audit_ids: JSON.parse(row.audit_ids || '[]') };
}

/** Dedicated machine boundary, deliberately outside /api/agent Access middleware. */
export async function intake(context, now = Date.now()) {
  try {
    const { request, env } = context, url = new URL(request.url);
    const catalog = config(env, url.origin);
    if (!catalog || request.method !== 'POST' || url.pathname !== '/api/assistant-intake' || url.search || request.headers.has('origin')) return refused();
    const raw = await bodyText(request);
    if (!await hmacValid(request, raw, env.ASSISTANT_INTAKE_SECRET, now)) return refused();
    const b = JSON.parse(raw), db = env.LEGACY_DB;
    if (b.action === 'intent') {
      if (!exact(b, ['action', 'delivery_id', 'workspace', 'channel', 'thread', 'user', 'area', 'target_id', 'request'])
          || !text(b.delivery_id) || !/^[0-9]+\.[0-9]+$/.test(b.thread || '') || !text(b.thread, 40)
          || !/^U[A-Z0-9]+$/.test(b.user || '') || b.workspace !== env.ASSISTANT_WORKSPACE || b.channel !== env.ASSISTANT_CHANNEL
          || !text(b.request, 4000) || !catalog.some(t => t.area === b.area && t.target_id === b.target_id)) return refused();
      const hash = await sha256(JSON.stringify(canonical(b)));
      const prior = await db.prepare('SELECT * FROM assistant_handoff WHERE delivery_id = ?').bind(b.delivery_id).first();
      if (prior) return prior.intent_hash === hash ? response(machineReceipt(prior)) : refused(409);
      const id = 'ah_' + random();
      await db.prepare(`INSERT INTO assistant_handoff(id,delivery_id,intent_hash,workspace,channel,thread,slack_user,area,target_id,request_text,app_origin,state,expires_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).bind(id,b.delivery_id,hash,b.workspace,b.channel,b.thread,b.user,b.area,b.target_id,b.request,url.origin,now+TTL_MS,now).run();
      return response(machineReceipt(await rowFor(db, id)));
    }
    if (b.action === 'outcome') {
      if (!exact(b, ['action', 'handoff_id'])) return refused();
      const row = await rowFor(db, b.handoff_id);
      return row ? response(machineReceipt(row)) : refused(404);
    }
    if (b.action !== 'verify' || !exact(b, ['action','handoff_id','event_id','workspace','channel','thread','user','challenge']) || !text(b.event_id)) return refused();
    const row = await rowFor(db, b.handoff_id);
    if (!live(row, now) || row.state !== 'challenged' || row.challenge_expires <= now
        || row.workspace !== b.workspace || row.channel !== b.channel || row.thread !== b.thread || row.slack_user !== b.user
        || !/^[a-f0-9]{32}$/.test(b.challenge || '') || await sha256(b.challenge) !== row.challenge_hash) return refused();
    if (!await transition(db, row, 'challenged', 'paired', { challenge_hash: null, challenge_expires: null, verification_event: b.event_id })) return refused(409);
    return response(machineReceipt(await rowFor(db, row.id)));
  } catch { return refused(400); } // Never log request, challenge, actor, keys or raw DB errors.
}

async function appCall(context, row, action, version) {
  const path = content(row.area) ? '/api/agent/' : '/api/agent/change/';
  const b = action === 'draft' ? { ...(content(row.area) ? { type_id: 'page_section' } : { area: row.area }), target_id: row.target_id, request: row.request_text }
    : { [content(row.area) ? 'draft_id' : 'change_id']: row.draft_id, preview_version: version };
  const headers = new Headers(context.request.headers);
  headers.delete('content-length'); headers.set('content-type', 'application/json');
  return agentPost({ request: new Request(row.app_origin + path + action, { method: 'POST', headers, body: JSON.stringify(b) }), env: context.env, data: context.data, redactErrors: true });
}
async function savedDraft(db, row, id = row.draft_id) {
  return db.prepare(`SELECT * FROM ${content(row.area) ? 'content_item' : 'agent_change'} WHERE id = ?`).bind(id).first();
}
function humanView(row) {
  const body = { ok: true, handoff_id: row.id, state: row.state };
  if (['paired','drafted','published','discarded','hold','refused'].includes(row.state)) {
    body.area = row.area; body.target_id = row.target_id; body.request = row.request_text;
    body.preview = row.preview_json ? JSON.parse(row.preview_json) : null;
    body.preview_version = row.preview_version;
  }
  return body;
}
async function originalOutcome(db, row, actor, action) {
  const draft = await savedDraft(db, row), isContent = content(row.area);
  if (!draft) return null;
  const preview = JSON.parse(row.preview_json);
  const table = isContent ? 'content_item' : ({ caregiver:'caregiver',event:'event',grant:'grant_application' })[row.area];
  const projection = row.area === 'grant' ? 'id,caregiver_id,requested_for,status,review_notes' : '*';
  const target = await db.prepare(`SELECT ${projection} FROM ${table} WHERE id = ?`).bind(row.target_id).first();
  if (!target) return null;
  const domainAction = isContent ? 'content_item.publish' : ({caregiver:'caregiver.update',event:'event.update',grant:'grant_application.review'})[row.area];
  const auditAction = action === 'discard' ? (isContent ? 'content_item.discard' : 'agent_change.discard') : domainAction;
  const entityId = action === 'discard' ? row.draft_id : row.target_id;
  const { results } = await db.prepare('SELECT id,actor,action,entity,entity_id,before_json,after_json FROM audit_log WHERE id > ? AND actor = ? AND action = ? AND entity_id = ? ORDER BY id')
    .bind(row.audit_floor,actor,auditAction,entityId).all();
  if (results.length !== 1) return null;
  const audit = results[0];
  if (audit.entity !== (action === 'discard' && !isContent ? 'agent_change' : table)) return null;
  if (action === 'discard') {
    if (draft.status !== (isContent ? 'archived' : 'discarded') || !same(target, JSON.parse(row.target_json))) return null;
    if (!same(JSON.parse(audit.before_json),isContent ? {status:'draft',data:preview.after}:{status:'draft'})
        || !same(JSON.parse(audit.after_json), isContent ? {status:'archived',data:preview.after} : {status:'discarded'})) return null;
    return [audit.id];
  }
  if (draft.status !== (isContent ? 'archived' : 'published') || (!isContent && draft.confirmed_by !== actor)) return null;
  if (isContent) {
    if (target.status !== 'published' || !same(JSON.parse(target.data),preview.after)
        || !same(JSON.parse(audit.after_json),{status:'published',data:preview.after})) return null;
    const baseline = JSON.parse(row.target_json);
    if (!same(JSON.parse(audit.before_json),{status:baseline.status,data:JSON.parse(baseline.data)})) return null;
    return [audit.id];
  }
  if (!Object.keys(preview.after).every(k => same(target[k],preview.after[k])) || !same(JSON.parse(audit.after_json),preview.after)
      || !same(JSON.parse(audit.before_json),preview.before)) return null;
  const { results: confirms } = await db.prepare("SELECT id,after_json FROM audit_log WHERE id > ? AND actor = ? AND action = 'agent_change.confirm' AND entity = 'agent_change' AND entity_id = ? ORDER BY id")
    .bind(row.audit_floor,actor,row.draft_id).all();
  if (confirms.length !== 1 || !same(JSON.parse(confirms[0].after_json),{status:'published',confirmed_by:actor})) return null;
  return [audit.id,confirms[0].id].sort((a,b) => a-b);
}

/** All human actions require the middleware's private active-staff proof and same origin. */
export async function human(context, now = Date.now()) {
  const { request, env } = context, url = new URL(request.url), actor = confirmationActor(context.data);
  const catalog = config(env,url.origin);
  if (!catalog || !actor || request.headers.get('origin') !== url.origin || request.method !== 'POST'
      || url.pathname !== '/api/agent/handoff' || url.search) return refused();
  let row;
  try {
    const b = JSON.parse(await bodyText(request)), db = env.LEGACY_DB;
    if (!exact(b, b.action === 'confirm' || b.action === 'discard' ? ['action','handoff_id','preview_version'] : ['action','handoff_id'])
        || !/^ah_[a-f0-9]{32}$/.test(b.handoff_id || '')) return refused();
    row = await rowFor(db,b.handoff_id);
    if (!row || row.app_origin !== url.origin || row.workspace !== env.ASSISTANT_WORKSPACE || row.channel !== env.ASSISTANT_CHANNEL
        || !catalog.some(t => t.area === row.area && t.target_id === row.target_id)) return refused(404);
    if (b.action === 'view' && row.state === 'pending') return response({ok:true,handoff_id:row.id,state:'pending'});
    if (b.action === 'begin') {
      if (!live(row,now) || row.state !== 'pending') return refused(409);
      const challenge = random();
      if (!await transition(db,row,'pending','challenged',{actor,challenge_hash:await sha256(challenge),challenge_expires:now+CHALLENGE_MS})) return refused(409);
      return response({ok:true,handoff_id:row.id,state:'challenged',challenge,channel:row.channel,thread:row.thread});
    }
    if (row.actor !== actor) return refused();
    if (b.action === 'view') return response(humanView(row));
    if (!live(row,now)) return refused(409);
    if (b.action === 'draft') {
      if (row.state !== 'paired' || !await transition(db,row,'paired','drafting')) return refused(409);
      try {
        const floor = await db.prepare('SELECT COALESCE(MAX(id),0) AS n FROM audit_log').first();
        const result = await appCall(context,row,'draft'), reply = await result.json();
        if (result.status === 200 && reply.ok === false && typeof reply.refusal === 'string') {
          await transition(db,row,'drafting','refused'); return response({ok:false,state:'refused'});
        }
        const id = isId(reply,content(row.area));
        if (!result.ok || !id || typeof reply.preview_version !== 'string') throw new Error('draft');
        const draft = await savedDraft(db,row,id);
        if (!draft || !ownsDraft(content(row.area) ? draft.updated_by : draft.requested_by,actor)) throw new Error('owner');
        const binding = await confirmationBinding(db,content(row.area)?'content':'workflow',draft,url.origin);
        const preview = content(row.area) ? reply.confirmation_preview : reply.preview;
        if (binding.version !== reply.preview_version) throw new Error('version');
        if (!plain(preview?.before) || !plain(preview?.after)) throw new Error('shape');
        if (!Object.keys({...preview.before,...preview.after}).every(k => same(preview.before[k],preview.after[k]) || FIELDS[row.area].includes(k))) throw new Error('fields');
        if (String(content(row.area)?draft.draft_of:draft.target_id) !== row.target_id) throw new Error('target');
        if (!await transition(db,row,'drafting','drafted',{draft_id:id,preview_version:binding.version,preview_json:JSON.stringify(preview),target_json:JSON.stringify(binding.target),audit_floor:floor.n})) throw new Error('state');
        return response(humanView(await rowFor(db,row.id)));
      } catch {
        await transition(db,row,'drafting','hold'); return held();
      }
    }
    if (!['confirm','discard'].includes(b.action) || row.state !== 'drafted' || b.preview_version !== row.preview_version) return refused(409);
    const intermediate = b.action === 'confirm' ? 'confirming' : 'discarding';
    if (!await transition(db,row,'drafted',intermediate,{attempted_action:b.action})) return refused(409);
    try {
      const result = await appCall(context,row,b.action,row.preview_version), reply = await result.json();
      if (!result.ok || reply.ok !== true) throw new Error('ack');
      const ids = await originalOutcome(db,row,actor,b.action);
      if (!ids || !await transition(db,row,intermediate,b.action === 'confirm'?'published':'discarded',{audit_ids:JSON.stringify(ids)})) throw new Error('outcome');
      return response(humanView(await rowFor(db,row.id)));
    } catch {
      await transition(db,row,intermediate,'hold'); return held();
    }
  } catch {
    // An interrupted intermediate state remains a durable refusal to retry after restart.
    return row && ['drafting','confirming','discarding','hold'].includes(row.state) ? held() : refused(400);
  }
}
function isId(reply,isContent) {
  const id = isContent ? reply.draft_id : reply.change_id;
  return typeof id === 'string' && /^(ci[d]?|ac)_[a-f0-9-]{36}$/.test(id) ? id : null;
}
