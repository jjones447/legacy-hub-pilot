// Intake core — pure logic over a D1-shaped binding (prepare/bind/run/first).
// No handler exports, so Pages creates no route for this file. Tested directly
// in tests/intake.test.mjs against the real schema via node:sqlite.

export const INTAKE_KINDS = ['support_request', 'membership', 'event_registration'];

export function validateIntake(body) {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  if (!INTAKE_KINDS.includes(body.kind)) return `kind must be one of ${INTAKE_KINDS.join(', ')}`;
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
};

export async function handleIntake(db, body) {
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
  const matchField = body.email ? 'email' : 'phone';
  const matchValue = body.email || body.phone;
  let caregiver = await db
    .prepare(`SELECT id, sanctuary_member FROM caregiver WHERE ${matchField} = ? AND status != 'archived'`)
    .bind(matchValue)
    .first();

  let caregiverId;
  if (caregiver) {
    caregiverId = caregiver.id;
    await db
      .prepare(`UPDATE caregiver SET updated_at = ? WHERE id = ?`)
      .bind(nowIso(), caregiverId)
      .run();
  } else {
    caregiverId = 'cg_' + crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO caregiver (id, first_name, last_name, email, phone, caring_for, relationship, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        caregiverId,
        body.first_name,
        body.last_name || null,
        body.email || null,
        body.phone || null,
        body.caring_for || null,
        body.relationship || null,
        source
      )
      .run();
  }

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
    await db
      .prepare(`INSERT INTO registration (caregiver_id, event_id, source, external_ref) VALUES (?, ?, ?, ?)`)
      .bind(caregiverId, body.event_id, source, body.external_ref)
      .run();
    await db
      .prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, 'event_confirmation', ?, ?, ?)`)
      .bind(caregiverId, `Confirm registration for ${body.event_id}`, source, body.external_ref + ':fu')
      .run();
  } else if (body.kind === 'membership') {
    await db
      .prepare(`UPDATE caregiver SET sanctuary_member = 1, member_since = COALESCE(member_since, ?), updated_at = ? WHERE id = ?`)
      .bind(nowIso(), nowIso(), caregiverId)
      .run();
    await db
      .prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, 'membership_welcome', ?, ?, ?)`)
      .bind(caregiverId, 'Welcome new Sanctuary member', source, body.external_ref)
      .run();
  } else {
    // support_request
    await db
      .prepare(`INSERT INTO followup (caregiver_id, kind, detail, source, external_ref) VALUES (?, 'support_request', ?, ?, ?)`)
      .bind(caregiverId, body.message || '(no message)', source, body.external_ref)
      .run();
  }

  // Audit trail — every intake mutation lands here.
  await db
    .prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, after_json) VALUES (?, ?, 'caregiver', ?, ?)`)
    .bind(
      source,
      `intake.${body.kind}`,
      caregiverId,
      JSON.stringify({ kind: body.kind, external_ref: body.external_ref, event_id: body.event_id || null })
    )
    .run();

  return { status: 201, body: { ok: true, caregiver_id: caregiverId } };
}
