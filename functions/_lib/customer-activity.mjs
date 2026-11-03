import snapshot from './customer-activity-snapshot.mjs';

const ORIGINS = new Set(['legacy_staff', 'xcentric_maintenance', 'not_established']);
const EXECUTORS = new Set(['legacy_assistant', 'xcentric_team', 'not_established']);
const STATES = {
  source: ['requested', 'in_progress', 'reviewed', 'merged'],
  staging: ['not_deployed', 'available', 'verified'],
  approval: ['pending', 'approved', 'not_required'],
  production: ['not_deployed', 'deployed', 'verified', 'rolled_back'],
};
const fail = () => { throw new Error('invalid customer activity snapshot'); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function text(v, max) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f<>]/.test(v)) fail();
  return v.trim();
}
function date(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) fail();
  const d = new Date(v);
  if (!Number.isFinite(d.getTime()) || d.toISOString().replace('.000Z', 'Z') !== v) fail();
  return v;
}
function link(v) {
  if (v == null) return null;
  // Plain same-site paths only: no authority, query, fragment, encoding or traversal.
  if (typeof v !== 'string' || v.length > 160 || !/^\/[a-z0-9][a-z0-9/_-]*$/.test(v)
      || v.includes('//') || /^\/(api|cdn-cgi)(\/|$)/.test(v)) fail();
  return v;
}

// Selection flags are not approval. The release owner's separately reviewed
// exact-byte digest is required by the package preparation tool. This function
// projects approved text; it cannot decide whether arbitrary prose is private.
export function projectCustomerActivity(input) {
  if (!object(input) || input.version !== 1 || !Array.isArray(input.entries) || input.entries.length > 100) fail();
  const asOf = date(input.as_of);
  const entries = [];
  for (const entry of input.entries) {
    if (!object(entry) || entry.visibility !== 'legacy_staff' || entry.selected !== true) continue;
    if (!ORIGINS.has(entry.request_origin) || !EXECUTORS.has(entry.executor)) fail();
    if (!object(entry.milestones)) fail();
    const milestones = {};
    for (const [stage, states] of Object.entries(STATES)) {
      const m = entry.milestones[stage];
      if (!object(m) || !states.includes(m.state)) fail();
      const at = m.at == null ? null : date(m.at);
      if (!['requested', 'in_progress', 'not_deployed', 'pending', 'not_required'].includes(m.state) && !at) fail();
      if (at && at > asOf) fail();
      milestones[stage] = { state: m.state, at };
    }
    entries.push({
      summary: text(entry.summary, 300), requested_by: text(entry.requested_by, 80),
      request_origin: entry.request_origin, executor: entry.executor,
      milestones, evidence_path: link(entry.evidence_path),
    });
    if (entries.length > 50) fail();
  }
  return { version: 1, as_of: asOf, entries };
}

export function readCustomerActivity(packaged) {
  if (!object(packaged) || packaged.format !== 'customer_activity_projection_v1'
      || !/^[a-f0-9]{64}$/.test(packaged.reviewed_sha256 || '')) return { entries: [], as_of: null };
  try {
    // Re-project at the API boundary; imported extras never become client data.
    const selected = { ...packaged.data, entries: packaged.data.entries.map(e => ({ ...e, selected: true, visibility: 'legacy_staff' })) };
    return projectCustomerActivity(selected);
  } catch { return { entries: [], as_of: null }; }
}
export function customerActivity() { return readCustomerActivity(snapshot); }
