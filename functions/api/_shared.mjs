// Intake core — pure logic over a D1-shaped binding (prepare/bind/run/first/batch).
// No handler exports, so Pages creates no route for this file. Tested directly
// in tests/intake.test.mjs against the real schema via node:sqlite.
import { handleNewsletter, validateNewsletter } from '../_lib/newsletter.mjs';

// 'newsletter' (email list, schema/0020) writes only email_subscriber: no caregiver record.
export const INTAKE_KINDS = ['support_request', 'membership', 'event_registration', 'grant_application', 'newsletter'];

export function validateIntake(body) {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  if (!INTAKE_KINDS.includes(body.kind)) return `kind must be one of ${INTAKE_KINDS.join(', ')}`;
  if (body.kind === 'newsletter') return validateNewsletter(body);
  if (!body.first_name || typeof body.first_name !== 'string') return 'first_name is required';
  if (!body.email && !body.phone) return 'email or phone is required';
  if (!body.external_ref || typeof body.external_ref !== 'string') return 'external_ref is required';
  if (body.kind === 'event_registration' && !body.event_id) return 'event_id is required for event_registration';
  return null;
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// The idempotency target table per intake kind.
const KIND_TABLE = {
  support_request: 'followup',
  membership: 'followup',
  event_registration: 'registration',
  grant_application: 'grant_application',
};

export async function handleIntake(db, body) {
  // Email-list sign-ups keep the intake conventions (validation, IP limit, idempotency on
  // (source, external_ref)) but never touch caregiver, followup or any email sender.
  if (body && typeof body === 'object' && body.kind === 'newsletter') return handleNewsletter(db, body);
  // One person, one record (requester, Nov 12): "Jane@Example.org " and "jane@example.org"
  // are the same caregiver. Match existing records case- and space-insensitively, as the
  // portal does, and store new emails trimmed and lower-case.
  if (body && typeof body === 'object' && typeof body.email === 'string') body.email = body.email.trim();
  const err = validateIntake(body);
  if (err) return { status: 400, body: { ok: false, error: err } };

  const source = body.source || 'site_form';
  const table = KIND_TABLE[body.kind];

  // Idempotency: same (source, external_ref) → no-op, report the earlier write.
  const dup = await db
    .prepare(`SELECT id FROM ${table} WHERE source = ? AND external_ref = ?`)
    .bind(source, body.external_ref)
    .first();
  if (dup) return { status: 200, body: { ok: true, duplicate: true } };

  // Upsert caregiver by email (fallback phone).
  const resolved = await resolveCaregiverByContact(db, body.email, body.phone);
  const caregiver = resolved.caregiver;
  const newEmail = resolved.newEmail;
  const disputed = Boolean(resolved.ambiguousIds);

  let caregiverId;
  let caregiverWrite;
  if (disputed) {
    caregiverId = 'cg_unmatched_intake';
    caregiverWrite = db.prepare(
      `INSERT OR IGNORE INTO caregiver (id, first_name, last_name, source, status)
       VALUES ('cg_unmatched_intake', 'Unmatched', 'Website sign-up', 'site_form', 'inactive')`
    ).bind();
  } else if (caregiver) {
    caregiverId = caregiver.id;
    caregiverWrite = db
      .prepare(`UPDATE caregiver SET updated_at = ? WHERE id = ?`)
      .bind(nowIso(), caregiverId);
  } else {
    caregiverId = 'cg_' + crypto.randomUUID();
    caregiverWrite = db
      .prepare(
        `INSERT INTO caregiver (id, first_name, last_name, email, phone, caring_for, relationship, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        caregiverId,
        body.first_name,
        body.last_name || null,
        newEmail,
        body.phone || null,
        body.caring_for || null,
        body.relationship || null,
        source
      );
  }

  // Membership/support business mutations and their original audit commit together.
  // Keep the existing event/grant workflow and request-limit accounting unchanged.
  // A held (disputed-identity) submission of any kind commits with its review task and audit.
  const atomic = disputed || body.kind === 'membership' || body.kind === 'support_request';
  const writes = atomic ? [caregiverWrite] : null;
  if (!atomic) await caregiverWrite.run();
  const write = async statement => { if (atomic) writes.push(statement); else await statement.run(); };

  // Kind-specific workflow row.
  if (body.kind === 'event_registration') {
    const event = await db
      .prepare(`SELECT id, capacity FROM event WHERE id = ? AND publish_state = 'published'`)
      .bind(body.event_id)
      .first();
    if (!event) return { status: 404, body: { ok: false, error: 'event not found or not published' } };
    if (event.capacity !== null && event.capacity !== undefined) {
      const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM registration WHERE event_id = ? AND status IN ('registered','attended')`)
        .bind(body.event_id)
        .first();
      if (row.n >= event.capacity) {
        return { status: 409, body: { ok: false, error: 'event_full' } };
      }
    }
    await write(db
      .prepare(`INSERT INTO registration (caregiver_id, event_id, source, external_ref) VALUES (?, ?, ?, ?)`)
      .bind(caregiverId, body.event_id, source, body.external_ref));
    await write(db
      .prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, 'event_confirmation', ?, ?, ?)`)
      .bind(caregiverId, `Confirm registration for ${body.event_id}`, source, body.external_ref + ':fu'));
  } else if (body.kind === 'membership') {
    // A disputed identity is not made a member here; staff apply it after reconciling.
    if (!disputed) writes.push(db
      .prepare(`UPDATE caregiver SET sanctuary_member = 1, member_since = COALESCE(member_since, ?), updated_at = ? WHERE id = ?`)
      .bind(nowIso(), nowIso(), caregiverId));
    const note = typeof body.message === 'string' ? body.message : '';
    const detail = note.trim() ? `Welcome new Sanctuary member\n\n${note}` : 'Welcome new Sanctuary member';
    writes.push(db
      .prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, 'membership_welcome', ?, ?, ?)`)
      .bind(caregiverId, detail, source, body.external_ref));
  } else if (body.kind === 'grant_application') {
    await write(db
      .prepare(
        `INSERT INTO grant_application (caregiver_id, status, requested_for, source, external_ref)
         VALUES (?, 'submitted', ?, ?, ?)`
      )
      .bind(caregiverId, body.requested_for || null, source, body.external_ref));
    await write(db
      .prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, 'grant_review', ?, ?, ?)`)
      .bind(caregiverId, 'New wellness-grant application', source, body.external_ref + ':fu'));
  } else {
    // support_request
    writes.push(db
      .prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, 'support_request', ?, ?, ?)`)
      .bind(caregiverId, body.message || '(no message)', source, body.external_ref));
  }

  // Audit trail — every intake mutation lands here.
  const auditWrite = db
    .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, after_json) VALUES (?, ?, 'caregiver', ?, ?)`)
    .bind(
      source,
      `intake.${body.kind}`,
      caregiverId,
      JSON.stringify({ kind: body.kind, external_ref: body.external_ref, event_id: body.event_id || null })
    );

  // Disputed identity: an actionable staff task with the submitted contact and the candidates.
  const duplicateReview = disputed ? db
    .prepare(`INSERT OR IGNORE INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, 'possible_duplicate', ?, 'duplicate_check', ?)`)
    .bind(
      caregiverId,
      possibleDuplicateDetail(`Website ${body.kind.replace(/_/g, ' ')} (${body.external_ref})`, body, resolved.ambiguousIds),
      source + ':' + body.external_ref
    ) : null;

  if (atomic) {
    if (duplicateReview) writes.push(duplicateReview);
    writes.push(auditWrite);
    const results = await db.batch(writes);
    if (!Array.isArray(results) || results.length !== writes.length || results.some(result => result?.success !== true)) {
      throw new Error('intake batch did not confirm all mutations');
    }
  } else {
    if (duplicateReview) await duplicateReview.run();
    await auditWrite.run();
  }

  return { status: 201, body: { ok: true, caregiver_id: caregiverId } };
}

// Find the one active caregiver for this contact. Email matches ignore capitals and
// surrounding spaces. When several records match that way the identity is disputed: the
// caller keeps the activity on a no-email holding record for staff reconciliation (as Square
// does for unmatched payments), so no existing row is chosen and no new sign-in identity is made.
export async function resolveCaregiverByContact(db, email, phone) {
  if (!email) {
    const caregiver = await db
      .prepare(`SELECT id, sanctuary_member FROM caregiver WHERE phone = ? AND status != 'archived'`)
      .bind(phone)
      .first();
    return { caregiver: caregiver || null, newEmail: null, ambiguousIds: null };
  }
  const key = String(email).trim().toLowerCase();
  const found = await db
    .prepare(`SELECT COUNT(*) AS n, MIN(id) AS first_id, group_concat(id, ',') AS ids
      FROM caregiver WHERE LOWER(TRIM(email)) = ? AND status != 'archived'`)
    .bind(key)
    .first();
  const n = Number(found?.n || 0);
  if (n === 0) return { caregiver: null, newEmail: key, ambiguousIds: null };
  if (n === 1) {
    const caregiver = await db.prepare(`SELECT id, sanctuary_member FROM caregiver WHERE id = ?`).bind(found.first_id).first();
    return { caregiver, newEmail: key, ambiguousIds: null };
  }
  return { caregiver: null, newEmail: null, ambiguousIds: String(found.ids || '').split(',').filter(Boolean).sort() };
}

// Staff-only text for a disputed-identity review task: who submitted what, and the candidates.
export function possibleDuplicateDetail(channel, contact, ambiguousIds) {
  const name = [contact.first_name, contact.last_name].filter(v => typeof v === 'string' && v.trim()).join(' ') || '(no name)';
  const extra = [['caring for', contact.caring_for], ['relationship', contact.relationship]]
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([label, value]) => `${label}: ${value.trim()}`);
  return `${channel} from ${name} <${contact.email}>${contact.phone ? ' / ' + contact.phone : ''}` +
    `${extra.length ? ' (' + extra.join('; ') + ')' : ''} was kept here because several records share this email: ` +
    `${ambiguousIds.join(', ')}. Decide which person it belongs to (merge the duplicates if they are the same person), then move it there.`;
}

// Per-IP request limits, counted in audit_log (no new binding or table).
// The client address (CF-Connecting-IP) is only ever used as a SHA-256 digest:
// the raw address is never bound or stored. Any store error fails closed.
export const IP_LIMITS = {
  portalLogin: { action: 'portal.login_ip', limit: 20, windowMinutes: 15 },
  intake: { action: 'intake.submit_ip', limit: 10, windowMinutes: 60 },
  unsubscribe: { action: 'unsubscribe.submit_ip', limit: 20, windowMinutes: 60 },
};

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkIpRequestLimit(db, request, { action, limit, windowMinutes }) {
  try {
    const ip = (request.headers.get('CF-Connecting-IP') || '').trim() || 'unknown';
    const actor = await sha256Hex('ip:' + ip);
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND actor = ? AND at > datetime('now', ?)`)
      .bind(action, actor, `-${windowMinutes} minutes`)
      .first();
    if (!row || typeof row.n !== 'number') throw new Error('request count unavailable');
    if (row.n >= limit) return { ok: false, status: 429, error: 'rate_limited' };
    await db
      .prepare(`INSERT INTO audit_log (actor, action, entity) VALUES (?, ?, 'request_limit')`)
      .bind(actor, action)
      .run();
    return { ok: true };
  } catch {
    return { ok: false, status: 503, error: 'unavailable' };
  }
}
