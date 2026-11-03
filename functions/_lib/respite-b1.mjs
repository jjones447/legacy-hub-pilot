// Source-only B1 draft. No mail, AI, caregiver upsert, reusable profile or live policy.
import { confirmationActor } from './agent-confirmation.mjs';
import { checkIpRequestLimit } from '../api/_shared.mjs';

export const RESPITE_SOURCE = 'respite_b1_v1';
export const ACK_VERSION = 'b1-fictional-v1';
export const ACK_COPY = Object.freeze({
  privacy: 'DRAFT — fictional qualification only: I allow these one-session details to be used by the authorized respite coordination team for review and follow-up.',
  nonmedical: 'DRAFT — fictional qualification only: I understand this is non-medical group respite, subject to staffing, support needs and capacity review. Submitting is not confirmation.',
});
export const FIELDS = Object.freeze({
  caregiver_name: [120, true], contact_email: [254, true], contact_phone: [40, true],
  participant_name: [120, true], age: [3, false], relationship: [80, true],
  mobility: [600, true], communication: [600, true], personal_care_detail: [600, false],
  safety: [600, false], allergies_diet: [600, true], activities: [600, true], comfort: [600, false],
  emergency_name: [120, true], emergency_relationship: [80, true], emergency_phone: [40, true],
});
const BOOLS = ['first_time', 'personal_care_help', 'medication_help', 'caregiver_onsite'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const fail = (status, error) => reply({ ok: false, error }, status);
export const reply = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
function enabled(env) {
  // No config is added to Wrangler. Production deliberately cannot enable this draft.
  return env?.ENVIRONMENT === 'preview' && env?.RESPITE_B1_COLLECTION === ACK_VERSION;
}
function reviewers(env) {
  try {
    const list = JSON.parse(env.RESPITE_B1_REVIEWERS || '[]');
    return Array.isArray(list) && list.length <= 20 && list.every(x =>
      typeof x === 'string' && x.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) && x === x.toLowerCase())
      ? [...new Set(list)] : [];
  } catch { return []; }
}
async function ready(env) {
  if (!enabled(env) || !reviewers(env).length || !env.LEGACY_DB) return false;
  // Missing candidate schema fails closed without creating/applying anything.
  await env.LEGACY_DB.prepare('SELECT respite_review_required FROM event LIMIT 1').all();
  await env.LEGACY_DB.prepare('SELECT id FROM respite_application LIMIT 1').all();
  await env.LEGACY_DB.prepare('SELECT application_id FROM respite_application_private LIMIT 1').all();
  const { results } = await env.LEGACY_DB.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name IN
    ('respite_private_immutable','respite_private_no_delete','respite_application_immutable',
    'respite_application_no_delete','respite_registration_link','respite_event_marker',
    'respite_registration_no_delete','respite_registration_insert','respite_registration_update')`).all();
  return results?.length === 9;
}
function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin &&
    [null, 'same-origin'].includes(request.headers.get('Sec-Fetch-Site'));
}
async function readBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || '')) return null;
  if (request.headers.has('Content-Length') && (!/^\d+$/.test(request.headers.get('Content-Length')) ||
      Number(request.headers.get('Content-Length')) > 12000)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const value of chunks) { bytes.set(value, offset); offset += value.length; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && !Array.isArray(value) && typeof value === 'object' ? value : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
export function validateApplication(body) {
  if (!body) return null;
  const allowed = [...Object.keys(FIELDS), ...BOOLS, 'request_id', 'event_id', 'privacy_ack', 'nonmedical_ack', 'ack_version'];
  if (Object.keys(body).some(key => !allowed.includes(key)) || typeof body.request_id !== 'string' || !UUID.test(body.request_id) ||
    typeof body.event_id !== 'string' || !ID.test(body.event_id) || body.privacy_ack !== true || body.nonmedical_ack !== true || body.ack_version !== ACK_VERSION) return null;
  const snapshot = {};
  for (const [name, [max, required]] of Object.entries(FIELDS)) {
    if (typeof body[name] !== 'string') return null;
    const value = body[name].trim();
    if (value.length > max || required && !value || /[\u0000-\u001f\u007f]/.test(value)) return null;
    snapshot[name] = value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.contact_email) ||
      ![snapshot.contact_phone, snapshot.emergency_phone].every(x => /^[0-9+() .-]{7,40}$/.test(x) && x.replace(/\D/g, '').length >= 7) ||
      snapshot.age && !/^\d{1,3}$/.test(snapshot.age) ||
      body.personal_care_help && !snapshot.personal_care_detail) return null;
  for (const name of BOOLS) { if (typeof body[name] !== 'boolean') return null; snapshot[name] = body[name]; }
  return { snapshot, request_id: body.request_id.toLowerCase(), event_id: body.event_id };
}
const receipt = () => reply({ ok: true, status: 'pending_review', message: 'Received for review. This is not a confirmed place. Staff will follow up.' }, 202);
export async function publicGet({ env }) {
  try {
    if (!await ready(env)) return fail(404, 'unavailable');
    const { results } = await env.LEGACY_DB.prepare(`SELECT id,title,starts_at,ends_at,location FROM event
      WHERE respite_review_required=1 AND publish_state='published' AND julianday(starts_at)>julianday('now')
      ORDER BY starts_at LIMIT 40`).all();
    return reply({ ok: true, draft: true, ack_version: ACK_VERSION, acknowledgments: ACK_COPY, sessions: results });
  } catch { return fail(503, 'unavailable'); }
}
export async function publicPost({ request, env }) {
  try {
    if (!await ready(env)) return fail(404, 'unavailable');
    if (!sameOrigin(request)) return fail(403, 'forbidden');
    const input = validateApplication(await readBody(request));
    if (!input) return fail(400, 'invalid_application');
    const db = env.LEGACY_DB;
    const limit = await checkIpRequestLimit(db, request, { action: 'respite.submit_ip', limit: 10, windowMinutes: 60 });
    if (!limit.ok) return fail(limit.status, limit.error);
    const key = await digest(input.request_id);
    const hash = await digest(JSON.stringify([input.event_id, input.snapshot, ACK_VERSION]));
    const old = await db.prepare('SELECT payload_digest FROM respite_application WHERE request_key=?').bind(key).first();
    if (old) return old.payload_digest === hash ? receipt() : fail(409, 'request_changed');
    const id = 'ra_' + crypto.randomUUID();
    // First SELECT is eligibility-gated. No caregiver lookup, submitted ID, session or email linking.
    const results = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO respite_application
        (id,request_key,payload_digest,event_id,first_time,privacy_version,nonmedical_version,acknowledged_at)
        SELECT ?,?,?,id,?,?,?,datetime('now') FROM event WHERE id=? AND respite_review_required=1
        AND publish_state='published' AND julianday(starts_at)>julianday('now')`)
        .bind(id, key, hash, Number(input.snapshot.first_time), ACK_VERSION, ACK_VERSION, input.event_id),
      db.prepare(`INSERT INTO respite_application_private(application_id,schema_version,snapshot_json)
        SELECT id,?,? FROM respite_application WHERE id=?`).bind(ACK_VERSION, JSON.stringify(input.snapshot), id),
      db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,after_json)
        SELECT 'public','respite.pending','respite_application',id,? FROM respite_application WHERE id=?`)
        .bind(JSON.stringify({ status: 'pending', ack_version: ACK_VERSION }), id),
    ]);
    if (!Array.isArray(results) || results.length !== 3 || results.some(x => x.success !== true)) return fail(503, 'unavailable');
    const stored = await db.prepare('SELECT payload_digest FROM respite_application WHERE request_key=?').bind(key).first();
    if (!stored) return fail(409, 'session_unavailable');
    return stored.payload_digest === hash ? receipt() : fail(409, 'request_changed');
  } catch { return fail(503, 'unavailable'); } // Unknown commit: retry SAME request_id; never reset or auto-resubmit.
}
async function reviewer(context) {
  const actor = confirmationActor(context.data);
  if (!actor || !reviewers(context.env).includes(actor)) return null;
  const row = await context.env.LEGACY_DB.prepare("SELECT email FROM staff_member WHERE email=? AND status='active'").bind(actor).first();
  return row?.email === actor ? actor : null;
}
const summaryColumns = 'id,event_id,status,revision,first_time,followup_at,caregiver_id,identity_basis,registration_id';
export async function staffGet(context) {
  try {
    if (!await ready(context.env)) return fail(404, 'unavailable');
    if (!await reviewer(context)) return fail(403, 'forbidden');
    const url = new URL(context.request.url), db = context.env.LEGACY_DB;
    const id = url.searchParams.get('id'), event = url.searchParams.get('event_id');
    if (id && ID.test(id)) {
      const row = await db.prepare(`SELECT ${summaryColumns},privacy_version,nonmedical_version,acknowledged_at
        FROM respite_application WHERE id=?`).bind(id).first();
      if (!row) return fail(404, 'not_found');
      const privateRow = await db.prepare('SELECT snapshot_json FROM respite_application_private WHERE application_id=?').bind(id).first();
      return reply({ ok: true, application: row, details: JSON.parse(privateRow.snapshot_json), acknowledgments: ACK_COPY });
    }
    if (!ID.test(event || '')) return fail(400, 'event_required');
    const { results } = await db.prepare(`SELECT ${summaryColumns} FROM respite_application WHERE event_id=?
      ORDER BY created_at,id LIMIT 100`).bind(event).all();
    return reply({ ok: true, applications: results });
  } catch { return fail(503, 'unavailable'); }
}
export async function staffPost(context) {
  try {
    const { request, env } = context;
    if (!await ready(env)) return fail(404, 'unavailable');
    const actor = await reviewer(context);
    if (!actor || !sameOrigin(request)) return fail(403, 'forbidden');
    const body = await readBody(request);
    if (!body || Object.keys(body).some(x => !['id','revision','action','caregiver_id','identity_verified'].includes(x)) ||
      !ID.test(body.id || '') || !Number.isSafeInteger(body.revision) || body.revision < 1 ||
      !['resolve_identity','complete_followup','confirm','decline'].includes(body.action)) return fail(400, 'invalid_action');
    const db = env.LEGACY_DB;
    const row = await db.prepare('SELECT * FROM respite_application WHERE id=?').bind(body.id).first();
    if (!row || row.status !== 'pending' || row.revision !== body.revision) return fail(409, 'stale_review');
    let set = '', caregiver = row.caregiver_id;
    if (body.action === 'resolve_identity') {
      if (body.identity_verified !== true || !ID.test(body.caregiver_id || '')) return fail(400, 'verification_required');
      caregiver = body.caregiver_id;
      set = "caregiver_id=?,identity_basis='staff_verified',identity_verified_by=?,identity_verified_at=datetime('now'),";
    } else if (body.action === 'complete_followup') {
      set = "followup_by=?,followup_at=datetime('now'),";
    } else if (body.action === 'confirm') {
      if (!caregiver || row.first_time && (!row.followup_by || !row.followup_at)) return fail(409, 'review_required');
      set = "status='confirmed',";
    } else set = "status='declined',";
    const liveCaregiver = ['resolve_identity','confirm'].includes(body.action);
    // Fail the first NOT NULL actor constraint if snapshot or current actor/target changed.
    // Therefore zero-row CAS is a transaction failure, never a silently audited success.
    const predicates = `EXISTS(SELECT 1 FROM respite_application WHERE id=? AND status='pending' AND revision=?)
      AND EXISTS(SELECT 1 FROM staff_member WHERE email=? AND status='active')
      ${liveCaregiver ? "AND EXISTS(SELECT 1 FROM caregiver WHERE id=? AND status!='archived')" : ''}`;
    const params = [body.id, body.revision, actor, ...(liveCaregiver ? [caregiver] : [])];
    const writes = [db.prepare(`INSERT INTO audit_log(actor,action,entity,entity_id,after_json)
      VALUES(CASE WHEN ${predicates} THEN ? ELSE NULL END,?,'respite_application',?,?)`)
      .bind(...params, actor, 'respite.' + body.action, body.id, JSON.stringify({ revision: body.revision + 1,
        ...(liveCaregiver ? { caregiver_id: caregiver } : {}) })),
      db.prepare(`UPDATE respite_application SET ${set}revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND status='pending'`)
        .bind(...(body.action === 'resolve_identity' ? [caregiver, actor] : body.action === 'complete_followup' ? [actor] : []), body.id, body.revision)];
    if (body.action === 'confirm') writes.push(
      db.prepare(`INSERT INTO registration(caregiver_id,event_id,source,external_ref)
        SELECT caregiver_id,event_id,?,id FROM respite_application WHERE id=? AND status='confirmed'`).bind(RESPITE_SOURCE, body.id),
      db.prepare(`UPDATE respite_application SET registration_id=(SELECT id FROM registration WHERE source=? AND external_ref=?) WHERE id=?`)
        .bind(RESPITE_SOURCE, body.id, body.id));
    const results = await db.batch(writes);
    if (!Array.isArray(results) || results.length !== writes.length || results.some(x => x.success !== true)) return fail(503, 'unavailable');
    return reply({ ok: true });
  } catch { return fail(409, 'review_not_confirmed'); }
}
