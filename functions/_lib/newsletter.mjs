// Email list (schema/0019, issue #301 phase 1): sign-up, unsubscribe, and the staff view.
// Pure logic over a D1-shaped binding. No handler exports, so Pages creates no route here.
//
// Phase 1 never sends email. A sign-up never creates a caregiver record. The unsubscribe
// token is only ever placed in the subscriber's own link: no function here returns it,
// logs it or writes it to the audit log.

// The exact consent line shown beside the home page form; stored with every sign-up.
// tests/email-list.test.mjs asserts the rendered home page shows this same text.
export const NEWSLETTER_CONSENT_TEXT =
  'By joining, you agree to receive occasional emails from Legacy. You can unsubscribe anytime.';

export const NEWSLETTER_DEFAULT_SOURCE = 'site_form:newsletter';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const MAX_EMAIL = 254;
const MAX_FIRST_NAME = 100;
const MAX_REF = 200;
const MAX_SOURCE = 64;

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function normalizeSubscriberEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isUnsubscribeToken(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

// 128 random bits as 32 lowercase hex characters.
export function newUnsubscribeToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Returns null when valid, or a short error string (same convention as validateIntake).
export function validateNewsletter(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  if (body.kind !== 'newsletter') return 'kind must be newsletter';
  const email = normalizeSubscriberEmail(body.email);
  if (!email) return 'email is required';
  if (email.length > MAX_EMAIL || !EMAIL_PATTERN.test(email)) return 'email is not valid';
  if (body.first_name !== undefined && body.first_name !== null && typeof body.first_name !== 'string') {
    return 'first_name must be a string';
  }
  if (typeof body.first_name === 'string' && body.first_name.trim().length > MAX_FIRST_NAME) return 'first_name is too long';
  if (!body.external_ref || typeof body.external_ref !== 'string') return 'external_ref is required';
  if (body.external_ref.length > MAX_REF) return 'external_ref is too long';
  if (body.source !== undefined && (typeof body.source !== 'string' || !body.source.trim() || body.source.length > MAX_SOURCE)) {
    return 'source is not valid';
  }
  return null;
}

function confirmBatch(results, expected) {
  if (!Array.isArray(results) || results.length !== expected || results.some((r) => r?.success === false)) {
    throw new Error('newsletter batch did not confirm all mutations');
  }
}

function isUniqueViolation(error) {
  return /UNIQUE constraint failed/i.test(String(error && error.message));
}

// POST /api/intake with kind 'newsletter'. Every accepted outcome (new, already subscribed,
// re-subscribed) answers the same 200 { ok: true }, so the public form cannot be used to
// learn whether an address is on the list. A replay of the same (source, external_ref)
// answers { ok: true, duplicate: true }, like every other intake kind.
export async function handleNewsletter(db, body) {
  const err = validateNewsletter(body);
  if (err) return { status: 400, body: { ok: false, error: err } };

  const source = typeof body.source === 'string' ? body.source.trim() : NEWSLETTER_DEFAULT_SOURCE;
  const externalRef = body.external_ref;
  const email = normalizeSubscriberEmail(body.email);
  const firstName = typeof body.first_name === 'string' && body.first_name.trim() ? body.first_name.trim() : null;

  const dup = await db
    .prepare(`SELECT id FROM email_subscriber WHERE source = ? AND external_ref = ?`)
    .bind(source, externalRef)
    .first();
  if (dup) return { status: 200, body: { ok: true, duplicate: true } };

  const existing = await db
    .prepare(`SELECT id, status FROM email_subscriber WHERE email = ?`)
    .bind(email)
    .first();

  // Already on the list: nothing to write, and nothing a stranger could overwrite.
  if (existing && existing.status === 'subscribed') return { status: 200, body: { ok: true } };

  const now = nowIso();
  let id;
  let write;
  let action;
  if (existing) {
    id = existing.id;
    action = 'newsletter.resubscribe';
    write = db
      .prepare(
        `UPDATE email_subscriber
            SET status = 'subscribed', unsubscribed_at = NULL, first_name = COALESCE(?, first_name),
                source = ?, external_ref = ?, consent_text = ?, updated_at = ?
          WHERE id = ? AND status = 'unsubscribed'`
      )
      .bind(firstName, source, externalRef, NEWSLETTER_CONSENT_TEXT, now, id);
  } else {
    id = 'sub_' + crypto.randomUUID();
    action = 'newsletter.subscribe';
    write = db
      .prepare(
        `INSERT INTO email_subscriber
           (id, email, first_name, status, source, external_ref, consent_text, unsubscribe_token, created_at, updated_at)
         VALUES (?, ?, ?, 'subscribed', ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, email, firstName, source, externalRef, NEWSLETTER_CONSENT_TEXT, newUnsubscribeToken(), now, now);
  }

  // The audit row names the subscriber id only: no email address, no token.
  const audit = db
    .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, after_json) VALUES (?, ?, 'email_subscriber', ?, ?)`)
    .bind(source, action, id, JSON.stringify({ status: 'subscribed', external_ref: externalRef }));

  try {
    confirmBatch(await db.batch([write, audit]), 2);
  } catch (error) {
    // A concurrent sign-up for the same address (or the same retry key) won the race:
    // the address is on the list either way.
    if (isUniqueViolation(error)) return { status: 200, body: { ok: true } };
    throw error;
  }
  return { status: 200, body: { ok: true } };
}

// POST /api/unsubscribe. Known and unknown tokens get the same answer (no enumeration);
// repeating an unsubscribe changes nothing.
export async function handleUnsubscribe(db, body) {
  const token = body && typeof body === 'object' ? body.token : undefined;
  if (!isUnsubscribeToken(token)) return { status: 400, body: { ok: false, error: 'invalid_request' } };

  const row = await db
    .prepare(`SELECT id, status FROM email_subscriber WHERE unsubscribe_token = ?`)
    .bind(token)
    .first();
  if (row && row.status === 'subscribed') {
    const now = nowIso();
    const results = await db.batch([
      db
        .prepare(`UPDATE email_subscriber SET status = 'unsubscribed', unsubscribed_at = ?, updated_at = ? WHERE id = ? AND status = 'subscribed'`)
        .bind(now, now, row.id),
      db
        .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json) VALUES ('unsubscribe_link', 'newsletter.unsubscribe', 'email_subscriber', ?, ?, ?)`)
        .bind(row.id, JSON.stringify({ status: 'subscribed' }), JSON.stringify({ status: 'unsubscribed' })),
    ]);
    confirmBatch(results, 2);
  }
  return { status: 200, body: { ok: true } };
}

// Columns staff may see. unsubscribe_token is deliberately absent.
const STAFF_COLUMNS = 'id, email, first_name, status, source, consent_text, created_at, updated_at, unsubscribed_at';

function likePattern(q) {
  return '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

// GET /api/staff/subscribers — list (newest first) with whole-list counts and optional search.
export async function listSubscribers(db, { q = '', status = '', limit = 200 } = {}) {
  const query = String(q || '').trim().slice(0, 200);
  const conditions = [];
  const params = [];
  if (query) {
    const pattern = likePattern(query.toLowerCase());
    conditions.push(`(email LIKE ? ESCAPE '\\' OR LOWER(COALESCE(first_name, '')) LIKE ? ESCAPE '\\')`);
    params.push(pattern, pattern);
  }
  if (status === 'subscribed' || status === 'unsubscribed') {
    conditions.push('status = ?');
    params.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const cap = Math.min(Math.max(Number.parseInt(limit, 10) || 200, 1), 500);

  const countsRow = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'subscribed' THEN 1 ELSE 0 END), 0) AS subscribed,
              COALESCE(SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END), 0) AS unsubscribed
         FROM email_subscriber`
    )
    .first();
  const matchRow = await db.prepare(`SELECT COUNT(*) AS n FROM email_subscriber ${where}`).bind(...params).first();
  const { results } = await db
    .prepare(`SELECT ${STAFF_COLUMNS} FROM email_subscriber ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...params, cap)
    .all();

  return {
    subscribers: results || [],
    matching: Number(matchRow?.n || 0),
    limit: cap,
    counts: {
      subscribed: Number(countsRow?.subscribed || 0),
      unsubscribed: Number(countsRow?.unsubscribed || 0),
      total: Number(countsRow?.total || 0),
    },
  };
}

// One CSV cell: neutralize spreadsheet formulas, then quote (RFC 4180).
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export const SUBSCRIBER_CSV_COLUMNS = ['email', 'first_name', 'status', 'source', 'created_at', 'updated_at'];

export function subscribersCsv(rows) {
  const lines = [SUBSCRIBER_CSV_COLUMNS.map(csvCell).join(',')];
  for (const row of rows) lines.push(SUBSCRIBER_CSV_COLUMNS.map((column) => csvCell(row[column])).join(','));
  return lines.join('\r\n') + '\r\n';
}

// GET /api/staff/subscribers.csv — every currently subscribed address, oldest first.
export async function subscribedForExport(db) {
  const { results } = await db
    .prepare(
      `SELECT email, first_name, status, source, created_at, updated_at
         FROM email_subscriber WHERE status = 'subscribed' ORDER BY created_at ASC, id ASC`
    )
    .all();
  return results || [];
}
