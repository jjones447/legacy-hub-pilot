// Existing registration -> followup -> append-only audit -> existing sender.
// A durable claim is never deleted/retried automatically, even after timeout or
// provider idempotency expiry. No customer text, address or mail body in audits.
import { canSendEmail, sendEmail } from './email.js';

const ENTITY = 'registration';
const ZONE = 'America/Chicago';
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function confirmationMailAllowed(env, recipient) {
  if (!EMAIL.test(recipient) || !canSendEmail(env)) return false;
  // This project's existing production binding has no ENVIRONMENT variable.
  // Preserve that convention; preview/development are explicitly marked.
  if (!env.ENVIRONMENT || env.ENVIRONMENT === 'production') return true;
  if (env.ENVIRONMENT !== 'preview') return false;
  const approved = String(env.CONFIRMATION_PREVIEW_RECIPIENTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return approved.includes(recipient.toLowerCase());
}

// Same site contract as publicEventTime: offset-free timestamps are Legacy wall
// time, never the server/visitor's local time. Explicit offsets name instants.
export function confirmationTime(value) {
  if (typeof value !== 'string') throw new Error('missing event time');
  const wall = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(value);
  if (wall) {
    const iso = `${wall[1]}T${wall[2]}:${wall[3] || '00'}`;
    const date = new Date(iso + 'Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== iso) throw new Error('invalid event time');
    return `${wall[1]} ${wall[2]} (${ZONE})`;
  }
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('invalid event time');
  const day = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error('invalid event date');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid event time');
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date) + ` (${ZONE})`;
}

export function registrationEmail(registration, environment) {
  if (registration.status !== 'registered') throw new Error('registration no longer registered');
  const origin = environment === 'preview' ? 'https://staging.caregiversanctuary.org' : 'https://caregiversanctuary.org';
  const lines = [
    'Your registration has been saved.',
    `Event: ${registration.title}`,
    `Starts: ${confirmationTime(registration.starts_at)}`,
    ...(registration.ends_at ? [`Ends: ${confirmationTime(registration.ends_at)}`] : []),
    `Location: ${registration.location || 'Contact Legacy for location or joining details.'}`,
    'Status: Registered. This does not confirm payment or attendance.',
    `Events and updates: ${origin}/events`,
    `Your portal: ${origin}/portal`,
    'Legacy Home & Respite Care Foundation',
  ];
  return {
    subject: 'Your Caregiver Sanctuary event registration',
    text: lines.join('\n\n'),
    html: lines.map(line => `<p>${escape(line)}</p>`).join(''),
  };
}

async function outcome(db, id) {
  const row = await db.prepare(`SELECT action FROM audit_log WHERE entity = ? AND entity_id = ?
    AND action IN ('confirmation.claimed','confirmation.accepted','confirmation.rejected','confirmation.unknown','confirmation.skipped')
    ORDER BY id DESC LIMIT 1`).bind(ENTITY, String(id)).first();
  if (!row) return 'not_sent';
  return row.action === 'confirmation.accepted' ? 'submitted' : 'needs_review';
}

export async function confirmRegistration(env, body, isNew, fetchImpl = fetch) {
  const db = env.LEGACY_DB;
  try {
    const reg = await db.prepare(`SELECT r.id, r.status, e.title, e.starts_at, e.ends_at, e.location,
      c.email, f.id AS followup_id FROM registration r
      JOIN event e ON e.id = r.event_id JOIN caregiver c ON c.id = r.caregiver_id
      JOIN followup f ON f.caregiver_id = r.caregiver_id AND f.source = r.source
        AND f.external_ref = r.external_ref || ':fu' AND f.kind = 'event_confirmation'
      WHERE r.source = ? AND r.external_ref = ?`).bind(body.source || 'site_form', body.external_ref).first();
    if (!reg) return 'needs_review';
    // Duplicate public requests only read the previous result. They never backfill
    // an older registration, claim an unattempted email or retry an uncertain send.
    if (!isNew) return await outcome(db, reg.id);
    const key = `legacy-registration-${env.ENVIRONMENT || 'production'}-${reg.id}`;
    const recipient = typeof reg.email === 'string' ? reg.email.trim() : '';
    let email;
    try { email = registrationEmail(reg, env.ENVIRONMENT); } catch { /* staff recovery below */ }
    const allowed = email && confirmationMailAllowed(env, recipient);
    const claim = await db.prepare(`INSERT INTO audit_log (actor,action,entity,entity_id,after_json)
      SELECT 'system','confirmation.claimed',?,?,? WHERE NOT EXISTS
      (SELECT 1 FROM audit_log WHERE entity = ? AND entity_id = ? AND action = 'confirmation.claimed')
      RETURNING id`).bind(ENTITY, String(reg.id), JSON.stringify({ key }), ENTITY, String(reg.id)).first();
    if (!claim?.id) return await outcome(db, reg.id);
    // If this durable preparation fails, no external call is made. The claim
    // remains for reconciliation; never reset a possibly committed write.
    await db.prepare(`UPDATE followup SET detail = ? WHERE id = ?`).bind(
      `Registration ${reg.id} saved. Confirmation email outcome requires verification before any resend. Reference: ${key}.`, reg.followup_id).run();
    const result = allowed ? await sendEmail(env, {
      to: recipient, ...email, idempotencyKey: key, timeoutMs: 10000,
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
        .bind(`confirmation.${state}`, ENTITY, String(reg.id), JSON.stringify({ key, provider_status: code })),
      db.prepare(`UPDATE followup SET detail = ? WHERE id = ?`)
        .bind(`Registration ${reg.id} saved. ${description} Reference: ${key}.`, reg.followup_id),
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
