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
