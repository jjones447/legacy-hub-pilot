import { confirmationActor } from './agent-confirmation.mjs';
import { PROFILE_FIELDS } from './caregiver-profile-fields.js';
import { notInternalTestCaregiverSql } from './domain/caregivers.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function project(raw, restricted) {
  const fields = JSON.parse(raw ?? '{}');
  if (!object(fields) || Object.keys(fields).some(key => !Object.hasOwn(PROFILE_FIELDS, key)
      || PROFILE_FIELDS[key].readOnly || Boolean(PROFILE_FIELDS[key].restricted) !== restricted)) throw new Error('profile_storage_invalid');
  return fields;
}

export async function staffCaregiverProfile({ request, env, data }) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  if (env.PORTAL_PROFILE_ENABLED !== '1' || url.search || parts.length !== 5
      || !/^[A-Za-z0-9_-]{1,256}$/.test(parts[4])) return json({ ok: false, error: 'not_found' }, 404);
  // This proof is set only by middleware after signature verification and a
  // human staff check; dev headers, service tokens and plain context cannot mint it.
  const actor = confirmationActor(data);
  if (!actor) return json({ ok: false, error: 'forbidden' }, 403);
  // Read role and answers together. A stale middleware admin claim cannot defeat
  // a current downgrade; the nonadmin SQL result never contains restricted JSON.
  const row = await env.LEGACY_DB.prepare(`SELECT c.email, p.revision, p.fields_json,
      CASE WHEN s.role = 'admin' THEN p.restricted_json ELSE NULL END AS restricted_json,
      s.role
    FROM staff_member s JOIN caregiver c ON c.id = ? AND c.status != 'archived'
    JOIN caregiver_profile p ON p.caregiver_id = c.id
    WHERE s.email = ? AND s.status = 'active' AND s.role IN ('admin', 'staff')`)
    .bind(parts[4], actor).first();
  if (!row) return json({ ok: false, error: 'profile_unavailable' }, 404);
  const fields = { ...project(row.fields_json, false), email: row.email };
  if (row.role === 'admin') Object.assign(fields, project(row.restricted_json, true));
  return json({ ok: true, profile: { revision: row.revision, fields } });
}

// Fixed whole-cohort aggregates only. No owner, demographic, date or arbitrary
// filters; no DOB, identity free text, row IDs or restricted JSON is returned.
// Small cohorts/cells (and their complements) are suppressed, not anonymized.
export async function staffProfileSummary({ request, env, data }) {
  const url = new URL(request.url);
  if (env.PORTAL_PROFILE_ENABLED !== '1' || url.pathname !== '/api/staff/profile-summary' || url.search) return json({ ok: false, error: 'not_found' }, 404);
  const actor = confirmationActor(data);
  if (!actor) return json({ ok: false, error: 'forbidden' }, 403);
  const descriptors = [ { key: 'date_of_birth', label: 'Date of birth provided', option: null } ];
  for (const key of ['race_ethnicity', 'gender', 'employment']) {
    for (const option of PROFILE_FIELDS[key].options) descriptors.push({ key, label: option, option });
  }
  const params = [];
  const counts = descriptors.map(({ key, option }, i) => {
    if (option === null) return `SUM(CASE WHEN json_extract(p.restricted_json, '$.${key}') IS NOT NULL AND json_extract(p.restricted_json, '$.${key}') != '' THEN 1 ELSE 0 END) AS n${i}`;
    params.push(option);
    return key === 'race_ethnicity'
      ? `SUM(CASE WHEN EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(p.restricted_json, '$.${key}') = 'array' THEN json_extract(p.restricted_json, '$.${key}') ELSE '[]' END) WHERE value = ?) THEN 1 ELSE 0 END) AS n${i}`
      : `SUM(CASE WHEN json_extract(p.restricted_json, '$.${key}') = ? THEN 1 ELSE 0 END) AS n${i}`;
  });
  // Group by the authorized staff row so an absent/deactivated staff identity
  // produces no row, rather than an apparently authorized zero-count aggregate.
  const row = await env.LEGACY_DB.prepare(`SELECT COUNT(p.caregiver_id) AS total, ${counts.join(', ')}
    FROM staff_member s LEFT JOIN caregiver c ON c.status != 'archived' AND ${notInternalTestCaregiverSql('c')}
    LEFT JOIN caregiver_profile p ON p.caregiver_id = c.id
    WHERE s.email = ? AND s.status = 'active' AND s.role IN ('admin', 'staff') GROUP BY s.email`)
    .bind(...params, actor).first();
  if (!row) return json({ ok: false, error: 'forbidden' }, 403);
  const total = Number(row.total);
  const groups = {};
  for (const [index, descriptor] of descriptors.entries()) {
    (groups[descriptor.key] ??= []).push({ label: descriptor.label, count: Number(row[`n${index}`] ?? 0) });
  }
  for (const group of Object.values(groups)) {
    const suppress = total < 10 || group.some(item => (item.count > 0 && item.count < 5)
      || (total - item.count > 0 && total - item.count < 5));
    if (suppress) for (const item of group) item.count = null;
  }
  return json({ ok: true, summary: { total_profiles: total < 10 ? null : total, groups } });
}
