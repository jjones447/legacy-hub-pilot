// Transactional email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// Production only: the key (EMAIL_API_KEY) is set only on the production environment, and
// canSendEmail() also refuses preview/development, so staging can never email a real caregiver.

export const EMAIL_FROM = 'Caregiver Sanctuary <no-reply@caregiversanctuary.org>';
export const EMAIL_REPLY_TO = 'info@legacyhomehealthservices.org';
const RESEND_URL = 'https://api.resend.com/emails';

export function canSendEmail(env) {
  if (!env || !env.EMAIL_API_KEY) return false;
  return env.ENVIRONMENT !== 'preview' && env.ENVIRONMENT !== 'development';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the sign-in email. `link` is an absolute https URL. */
export function signInEmail(link) {
  const safe = escapeHtml(link);
  return {
    subject: 'Your sign-in link for Caregiver Sanctuary',
    text:
      'Here is your link to sign in to your Caregiver Sanctuary portal:\n\n' +
      link + '\n\n' +
      'The link works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.\n\n' +
      'Legacy Home & Respite Care Foundation',
    html:
      '<p>Here is your link to sign in to your Caregiver Sanctuary portal:</p>' +
      `<p><a href="${safe}">Sign in to Caregiver Sanctuary</a></p>` +
      '<p>The link works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.</p>' +
      '<p>Legacy Home &amp; Respite Care Foundation</p>',
  };
}

/** Send one email. Returns { ok, status } and never throws; callers log failures without details. */
export async function sendEmail(env, { to, subject, text, html }, fetchImpl = fetch) {
  if (!canSendEmail(env)) return { ok: false, status: 0 };
  try {
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, reply_to: EMAIL_REPLY_TO, to: [to], subject, text, html }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: -1 };
  }
}
