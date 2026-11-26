import { canSendEmail } from './email.js';

const projectHost = 'legacy-support-qualification.pages.dev';
export const SUPPORT_BROWSER_ORIGIN = `https://qa.${projectHost}`;
export const supportBrowserOwnerPredicate = `id = ? AND LOWER(TRIM(email)) = ?
  AND status = 'active' AND source = 'support_qualification' AND segment_tags = '[]'`;
const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export function isSupportBrowserRequest(env, url) {
  const hostname = url.hostname.replace(/\.$/, '');
  return env?.SUPPORT_BROWSER_QUALIFICATION === '1' || hostname === projectHost || hostname.endsWith(`.${projectHost}`);
}

export function readSupportBrowserQualification(env, origin) {
  if (origin !== SUPPORT_BROWSER_ORIGIN || env?.ENVIRONMENT !== 'preview'
      || env.SUPPORT_BROWSER_QUALIFICATION !== '1' || env.PORTAL_SUPPORT_REQUEST_ENABLED !== '1'
      || env.ALLOW_DEV_CONSOLE === '1' || env.PORTAL_TEST_INBOX_ENABLED === '1' || !canSendEmail(env)) return null;

  const ownerId = env.SUPPORT_BROWSER_QA_OWNER_ID;
  const email = normalizedEmail(env.SUPPORT_BROWSER_QA_EMAIL);
  const staffEmail = normalizedEmail(env.SUPPORT_BROWSER_STAFF_EMAIL);
  const sender = normalizedEmail(env.SUPPORT_BROWSER_MAIL_FROM);
  if (typeof ownerId !== 'string' || !/^support_browser_[A-Za-z0-9_-]{1,100}$/.test(ownerId) ||
      !emailPattern.test(email) || email.endsWith('.invalid') || !emailPattern.test(staffEmail) ||
      !emailPattern.test(sender) || sender.endsWith('.invalid')) return null;
  return { ownerId, email, staffEmail, sender };
}

function normalizedEmail(value) {
  return typeof value === 'string' && value.length <= 254 ? value.trim().toLowerCase() : '';
}
