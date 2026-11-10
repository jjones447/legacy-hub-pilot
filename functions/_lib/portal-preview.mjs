// Deliberate, single-identity preview authentication. No identity is embedded in source.
// This is a policy reader only: it never enables flags or reads a caregiver record.
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const CAREGIVER_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function previewQACaregiver(env) {
  if (env?.ENVIRONMENT !== 'preview') return null;
  const flag = String(env.PORTAL_PREVIEW_MAIL_ENABLED ?? '').trim().toLowerCase();
  if (flag !== '1' && flag !== 'true') return null;
  if (typeof env.PORTAL_PREVIEW_QA_CAREGIVER_ID !== 'string'
      || typeof env.PORTAL_PREVIEW_QA_EMAIL !== 'string') return null;
  const id = env.PORTAL_PREVIEW_QA_CAREGIVER_ID.trim();
  const email = env.PORTAL_PREVIEW_QA_EMAIL.trim().toLowerCase();
  if (!CAREGIVER_ID.test(id) || email.length > 254 || !EMAIL.test(email)) return null;
  return { id, email };
}

export function matchesPreviewQACaregiver(env, id, email) {
  const qa = previewQACaregiver(env);
  return !!qa && id === qa.id && typeof email === 'string'
    && email.trim().toLowerCase() === qa.email;
}

// Explicit additional preview recipients never gain QA/sample eligibility.
// The original QA identity remains the stable token/session namespace anchor.
export function previewRecipients(env) {
  const qa = previewQACaregiver(env);
  if (!qa) return [];
  const raw = env.PORTAL_PREVIEW_RECIPIENTS;
  if (raw === undefined || raw === '') return [qa];
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 8192) return [];
  let extra;
  try { extra = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(extra) || extra.length > 19) return [];
  const result = [qa];
  for (const row of extra) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
        || Object.keys(row).sort().join(',') !== 'email,id'
        || typeof row.id !== 'string' || typeof row.email !== 'string') return [];
    const id = row.id.trim(), email = row.email.trim().toLowerCase();
    if (id !== row.id || email !== row.email || !CAREGIVER_ID.test(id)
        || email.length > 254 || !EMAIL.test(email)
        || result.some(r => r.id === id || r.email === email)) return [];
    result.push({ id, email });
  }
  return result;
}

export function previewRecipient(env, { id, email } = {}) {
  if (id === undefined && email === undefined) return null;
  return previewRecipients(env).find(row =>
    (id === undefined || row.id === id)
    && (email === undefined || (typeof email === 'string' && row.email === email.trim().toLowerCase()))
  ) || null;
}
