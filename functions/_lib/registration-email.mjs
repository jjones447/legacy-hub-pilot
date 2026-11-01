// Support-group sign-up -> followup -> append-only audit -> existing sender (support-only slice
// of #285: ordinary event registrations have NO confirmation dispatch in this module).
// A durable claim is never deleted/retried automatically, even after timeout or
// provider idempotency expiry. No customer text, address or mail body in audits.
import { canSendEmail, sendEmail } from './email.js';
import { SUPPORT_GROUP_SOURCE, SUPPORT_GROUP_MEET, supportGroupSession } from './support-group-session.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function confirmationMailAllowed(env, recipient) {
  return canSendEmail(env, { purpose: 'confirmation', recipient });
}

export function supportGroupEmail(sessionDate, environment) {
  const session = supportGroupSession(sessionDate);
  if (!session) throw new Error('unavailable support-group session');
  const origin = environment === 'preview' ? 'https://staging.caregiversanctuary.org' : 'https://caregiversanctuary.org';
  const link = `${origin}/programs#support-group`;
  const lines = [
    'Your sign-up for the Virtual Caregiver Support Group has been saved.',
    `Session: ${session.label}`,
    ...(session.date ? [`Date: ${session.date}`] : ['This is a general sign-up, not a reservation for a particular date. Check the upcoming sessions; some Wednesdays may be cancelled.']),
    `Join on Google Meet: ${SUPPORT_GROUP_MEET}`,
    `Session dates and updates: ${link}`,
    'This confirmation does not record attendance or enable reminders.',
    'Legacy Home & Respite Care Foundation',
  ];
  return {
    subject: 'Your Caregiver Sanctuary support-group sign-up',
    text: lines.join('\n\n'),
    html: lines.map(line => `<p>${escape(line)}</p>`).join('')
      + `<p><a href="${SUPPORT_GROUP_MEET}">Join the support group on Google Meet</a></p>`
      + `<p><a href="${link}">Check upcoming session dates</a></p>`,
  };
}

async function outcome(db, entity, id) {
  const row = await db.prepare(`SELECT action FROM audit_log WHERE entity = ? AND entity_id = ?
    AND action IN ('confirmation.claimed','confirmation.accepted','confirmation.rejected','confirmation.unknown','confirmation.skipped')
    ORDER BY id DESC LIMIT 1`).bind(entity, String(id)).first();
  if (!row) return 'not_sent';
  return row.action === 'confirmation.accepted' ? 'submitted' : 'needs_review';
}

export async function confirmSupportGroup(env, body, isNew, fetchImpl = fetch) {
  const db = env.LEGACY_DB;
  try {
    const task = await db.prepare(`SELECT f.id, f.detail, c.email, a.after_json FROM followup f
      JOIN caregiver c ON c.id = f.caregiver_id
      JOIN audit_log a ON a.entity = 'caregiver' AND a.entity_id = f.caregiver_id
        AND a.actor = f.source AND a.action = 'intake.support_request'
        AND json_extract(a.after_json, '$.external_ref') = f.external_ref
      WHERE f.source = ? AND f.external_ref = ? AND f.kind = 'support_request'
      ORDER BY a.id ASC LIMIT 1`).bind(SUPPORT_GROUP_SOURCE, body.external_ref).first();
    if (!task) return 'needs_review';
    // Older sign-ups and duplicates never become a backfill or resend request.
    if (!isNew) return await outcome(db, 'followup', task.id);
    const original = JSON.parse(task.after_json);
    let email;
    try {
      // Require the structured value captured in the original atomic intake.
      // No date is inferred from caller text, a changed retry or historical label.
      if (!Object.hasOwn(original, 'session_date')) throw new Error('missing original session identity');
      email = supportGroupEmail(original.session_date, env.ENVIRONMENT);
    } catch { /* retain task and record skipped confirmation */ }
    return await deliverConfirmation(env, {
      entity: 'followup', id: task.id, followupId: task.id, recipient: task.email, email,
      keyPrefix: 'support-group', saved: `Support-group sign-up ${task.id} saved.`, originalDetail: task.detail,
    }, fetchImpl);
  } catch {
    return 'needs_review';
  }
}

// Delivery state machine (from #285) used here only for support-group sign-ups. The
// durable entity ID resolves to their original (source, external_ref) identity.
async function deliverConfirmation(env, { entity, id, followupId, recipient: rawRecipient, email, keyPrefix, saved, originalDetail }, fetchImpl) {
  const db = env.LEGACY_DB;
  try {
    const key = `legacy-${keyPrefix}-${env.ENVIRONMENT || 'production'}-${id}`;
    const recipient = typeof rawRecipient === 'string' ? rawRecipient.trim() : '';
    const allowed = email && confirmationMailAllowed(env, recipient);
    const claim = await db.prepare(`INSERT INTO audit_log (actor,action,entity,entity_id,after_json)
      SELECT 'system','confirmation.claimed',?,?,? WHERE NOT EXISTS
      (SELECT 1 FROM audit_log WHERE entity = ? AND entity_id = ? AND action = 'confirmation.claimed')
      RETURNING id`).bind(entity, String(id), JSON.stringify({ key }), entity, String(id)).first();
    if (!claim?.id) return await outcome(db, entity, id);
    const detail = message => `${originalDetail ? originalDetail + '\n\n' : ''}${saved} ${message} Reference: ${key}.`;
    // If this durable preparation fails, no external call is made. The claim
    // remains for reconciliation; never reset a possibly committed write.
    await db.prepare(`UPDATE followup SET detail = ? WHERE id = ?`).bind(
      detail('Confirmation email outcome requires verification before any resend.'), followupId).run();
    const result = allowed ? await sendEmail(env, {
      to: recipient, ...email, idempotencyKey: key, timeoutMs: 10000, purpose: 'confirmation',
    }, fetchImpl) : { ok: false, status: 0 };
    const code = Number.isInteger(result.status) ? result.status : -1;
    const state = result.ok ? 'accepted' : code === 0 ? 'skipped'
      : [400, 401, 403, 404, 422, 429].includes(code) ? 'rejected' : 'unknown';
    const description = result.ok ? 'Confirmation email submitted to the mail provider; recipient delivery is not yet verified.'
      : state === 'skipped' ? 'Confirmation email not sent: recipient, event details or mail policy need staff review.'
      : state === 'rejected' ? 'Confirmation email rejected by the mail provider. Review before any resend.'
      : 'Confirmation email outcome unknown. Reconcile the provider record before any resend.';
    const writes = [
      db.prepare(`INSERT INTO audit_log (actor,action,entity,entity_id,after_json) VALUES ('system',?,?,?,?)`)
        .bind(`confirmation.${state}`, entity, String(id), JSON.stringify({ key, provider_status: code })),
      db.prepare(`UPDATE followup SET detail = ? WHERE id = ?`)
        .bind(detail(description), followupId),
    ];
    const recorded = await db.batch(writes);
    if (!Array.isArray(recorded) || recorded.length !== 2 || recorded.some(row => row?.success !== true)) return 'needs_review';
    return result.ok ? 'submitted' : 'needs_review';
  } catch {
    // Successful registration is never turned into a retryable intake failure
    // because of a mail/outcome-store fault. Original staff task is retained.
    return 'needs_review';
  }
}
