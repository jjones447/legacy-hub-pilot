// Server-owned preview/version fences; these are not credentials or human-intent proof.
const PREFIX = 'access_staff:';
const VERIFIED_ACCESS_STAFF = Symbol('verified-active-Access-staff');
// Internal middleware seam. Plain JSON/body/context fields cannot manufacture proof.
export function setVerifiedAccessStaffActor(data, actor) { data[VERIFIED_ACCESS_STAFF] = actor; }
export function confirmationActor(data) {
  const actor = data?.[VERIFIED_ACCESS_STAFF];
  return typeof actor === 'string' && actor.includes('@') && !actor.startsWith('service:') ? actor : null;
}
export const draftOwner = actor => actor ? PREFIX + actor : null;
export const ownsDraft = (owner, actor) => Boolean(actor && owner === draftOwner(actor));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export function matchesPersistedPreview(change, validation) {
  try {
    return JSON.stringify(canonical(JSON.parse(change.before_json))) === JSON.stringify(canonical(validation.before || validation.current || {}))
      && JSON.stringify(canonical(JSON.parse(change.after_json))) === JSON.stringify(canonical(validation.after || validation.projected || {}));
  } catch { return false; }
}
export async function confirmationBinding(db, kind, draft, origin, initialTarget = undefined) {
  const table = kind === 'content' ? 'content_item' : ({ caregiver: 'caregiver', event: 'event', grant: 'grant_application' })[draft.area];
  if (!table) throw new Error('unsupported confirmation target');
  const targetId = kind === 'content' ? draft.draft_of : draft.target_id;
  const projection = table === 'grant_application' ? 'id, caregiver_id, requested_for, status, review_notes' : '*';
  const target = initialTarget !== undefined ? initialTarget
    : targetId ? await db.prepare(`SELECT ${projection} FROM ${table} WHERE id = ?`).bind(targetId).first() : null;
  const owner = kind === 'content' ? draft.updated_by : draft.requested_by;
  // Existing UNIQUE(grant_application_id) bounds this secondary workflow record.
  const linkedAward = table === 'grant_application'
    ? await db.prepare('SELECT * FROM award WHERE grant_application_id = ?').bind(targetId).first() : null;
  // Full persisted proposal and target snapshots, including versions/timestamps.
  const version = await digest({ kind, origin, draft, table, targetId, target, linkedAward });
  return { version, owner, table, targetId, target, linkedAward, draft, kind };
}
function snapshotPredicate(table, record, params) {
  const fields = Object.keys(record);
  if (!fields.every(field => /^[a-z_][a-z0-9_]*$/.test(field))) throw new Error('invalid server snapshot');
  for (const field of fields) params.push(record[field]);
  return `EXISTS (SELECT 1 FROM ${table} WHERE ${fields.map(field => `"${field}" IS ?`).join(' AND ')})`;
}
// Put the ORIGINAL confirmation/discard audit first in the same batch. Its NOT NULL actor
// constraint aborts the entire batch if a proposal/target changed after the read.
// No synthetic receipt/audit or application schema is introduced.
export function confirmationAudit(db, binding, actor, action, entity, entityId, before, after) {
  const params = [];
  const draftTable = binding.kind === 'content' ? 'content_item' : 'agent_change';
  const predicates = [snapshotPredicate(draftTable, binding.draft, params)];
  if (binding.target) predicates.push(snapshotPredicate(binding.table, binding.target, params));
  else if (binding.targetId) {
    predicates.push(`NOT EXISTS (SELECT 1 FROM ${binding.table} WHERE id = ?)`);
    params.push(binding.targetId);
  }
  if (binding.table === 'grant_application') {
    if (binding.linkedAward) predicates.push(snapshotPredicate('award', binding.linkedAward, params));
    else {
      predicates.push('NOT EXISTS (SELECT 1 FROM award WHERE grant_application_id = ?)');
      params.push(binding.targetId);
    }
  }
  return db.prepare(`INSERT INTO audit_log (actor,action,entity,entity_id,before_json,after_json)
    VALUES (CASE WHEN ${predicates.join(' AND ')} THEN ? ELSE NULL END,?,?,?,?,?)`)
    .bind(...params, actor, action, entity, String(entityId), JSON.stringify(before), JSON.stringify(after));
}
