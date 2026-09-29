// Daily well-being check-in reminders (schema 0012; client request 2026-09-29).
// Emails a caregiver when their check-in is due again: they have done at least one check-in, the
// latest is CHECKIN_EVERY_DAYS old, and no reminder went out in the last CHECKIN_EVERY_DAYS.
// People who have never checked in are not emailed. Off until REMINDERS_ENABLED = "1", which is set
// at go-live, because the email links to the portal on the public address.

import { canSendEmail, sendEmail } from '../../../functions/_lib/email.js';
import { CHECKIN_EVERY_DAYS } from '../../../functions/_lib/wellness.js';

const BATCH_LIMIT = 200;

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function reminderEmail(firstName, portalUrl) {
  const hello = firstName ? `Hi ${firstName},` : 'Hi,';
  return {
    subject: 'Time for your Caregiver Sanctuary check-in',
    text:
      `${hello}\n\nIt has been about a month since your last well-being check-in. It takes a minute, ` +
      `and only you and the Legacy team see your answers.\n\n${portalUrl}\n\n` +
      'Legacy Home & Respite Care Foundation',
    html:
      `<p>${escapeHtml(hello)}</p>` +
      '<p>It has been about a month since your last well-being check-in. It takes a minute, and only you and the Legacy team see your answers.</p>' +
      `<p><a href="${escapeHtml(portalUrl)}">Take my check-in</a></p>` +
      '<p>Legacy Home &amp; Respite Care Foundation</p>',
  };
}

/** Caregivers whose check-in is due and who have not had a reminder this cycle. */
export async function dueCaregivers(db, days = CHECKIN_EVERY_DAYS) {
  const window = `-${days} days`;
  const { results } = await db
    .prepare(
      `SELECT c.id, c.first_name, c.email
       FROM caregiver c
       JOIN (SELECT caregiver_id, MAX(created_at) AS latest FROM wellness_checkin GROUP BY caregiver_id) w
         ON w.caregiver_id = c.id
       WHERE c.status = 'active'
         AND c.email IS NOT NULL AND TRIM(c.email) != ''
         AND w.latest <= datetime('now', ?)
         AND NOT EXISTS (
           SELECT 1 FROM audit_log a
           WHERE a.action = 'wellness.reminder_sent' AND a.entity = 'caregiver' AND a.entity_id = c.id
             AND a.at > datetime('now', ?))
       ORDER BY w.latest ASC
       LIMIT ${BATCH_LIMIT}`
    )
    .bind(window, window)
    .all();
  return results || [];
}

export async function runReminders(env, fetchImpl = fetch) {
  if (env.REMINDERS_ENABLED !== '1') return { enabled: false, sent: 0, failed: 0 };
  if (!canSendEmail(env)) return { enabled: true, sent: 0, failed: 0, reason: 'no email key' };
  const db = env.LEGACY_DB;
  const portalUrl = env.PORTAL_URL || 'https://caregiversanctuary.org/portal';
  let sent = 0;
  let failed = 0;
  for (const c of await dueCaregivers(db)) {
    const r = await sendEmail(env, { to: c.email, ...reminderEmail(c.first_name, portalUrl) }, fetchImpl);
    await db
      .prepare("INSERT INTO audit_log (actor, action, entity, entity_id) VALUES ('system', ?, 'caregiver', ?)")
      .bind(r.ok ? 'wellness.reminder_sent' : 'wellness.reminder_failed', c.id)
      .run();
    if (r.ok) sent++;
    else failed++;
  }
  return { enabled: true, sent, failed };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env).then((r) => console.log('reminders', JSON.stringify(r))));
  },
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
