// Domain module for caregiver workflow updates (slice D7-S1).
// Exports validate and apply functions used by both REST PATCH and the agent.

export const ALLOWED_CAREGIVER_UPDATE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'preferred_contact',
  'caring_for',
  'relationship',
  'segment_tags',
  'status',
  'outcome_status',
  'outcome_notes'
];

export async function validate(db, { id, operation, payload = {} }) {
  if (!id) {
    return { ok: false, status: 400, error: 'missing caregiver id' };
  }

  if (operation !== 'update') {
    return { ok: false, status: 400, error: 'unsupported action' };
  }

  const existing = await db
    .prepare('SELECT * FROM caregiver WHERE id = ?')
    .bind(id)
    .first();

  if (!existing) {
    return { ok: false, status: 404, error: 'caregiver not found' };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, status: 400, error: 'body must be a JSON object' };
  }

  const bodyKeys = Object.keys(payload);
  if (bodyKeys.length === 0) {
    return { ok: false, status: 400, error: 'no update fields provided' };
  }

  for (const key of bodyKeys) {
    if (!ALLOWED_CAREGIVER_UPDATE_FIELDS.includes(key)) {
      return { ok: false, status: 400, error: `unknown or forbidden field: ${key}` };
    }
  }

  const normalizedPayload = { ...payload };

  if ('status' in payload) {
    const validStatuses = ['active', 'inactive', 'archived'];
    if (!validStatuses.includes(payload.status)) {
      return { ok: false, status: 400, error: `status must be one of: ${validStatuses.join(', ')}` };
    }
  }

  if ('outcome_status' in payload && payload.outcome_status !== null) {
    const validOutcomes = ['improving', 'stable', 'needs_support', 'disengaged'];
    if (!validOutcomes.includes(payload.outcome_status)) {
      return { ok: false, status: 400, error: `outcome_status must be one of: ${validOutcomes.join(', ')}` };
    }
  }

  if ('segment_tags' in payload && payload.segment_tags !== null) {
    let tags = payload.segment_tags;
    if (typeof tags === 'string') {
      try {
        tags = JSON.parse(tags);
      } catch (e) {
        return { ok: false, status: 400, error: 'segment_tags must be a JSON array of strings' };
      }
    }
    if (!Array.isArray(tags) || !tags.every(item => typeof item === 'string')) {
      return { ok: false, status: 400, error: 'segment_tags must be a JSON array of strings' };
    }
    normalizedPayload.segment_tags = JSON.stringify(tags);
  }

  const beforeChanges = {};
  const afterChanges = {};
  const projected = { ...existing };

  for (const field of ALLOWED_CAREGIVER_UPDATE_FIELDS) {
    if (field in normalizedPayload) {
      beforeChanges[field] = existing[field];
      afterChanges[field] = normalizedPayload[field];
      projected[field] = normalizedPayload[field];
    }
  }

  return {
    ok: true,
    current: existing,
    projected,
    before: beforeChanges,
    after: afterChanges,
    operation: 'update',
    payload: normalizedPayload
  };
}

export async function apply(db, { id, operation, payload = {} }, actor) {
  const v = await validate(db, { id, operation, payload });
  if (!v.ok) {
    return v;
  }

  const setClauses = [];
  const setParams = [];

  for (const field of ALLOWED_CAREGIVER_UPDATE_FIELDS) {
    if (field in v.payload) {
      setClauses.push(`${field} = ?`);
      setParams.push(v.payload[field]);
    }
  }

  const outcomeChanged =
    ('outcome_status' in v.payload && v.payload.outcome_status !== v.current.outcome_status) ||
    ('outcome_notes' in v.payload && v.payload.outcome_notes !== v.current.outcome_notes);

  if (outcomeChanged) {
    setClauses.push("outcome_updated_at = datetime('now')");
  }

  setClauses.push("updated_at = datetime('now')");

  const updateSql = `
    UPDATE caregiver
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `;
  setParams.push(id);

  await db.prepare(updateSql).bind(...setParams).run();

  await db
    .prepare(`
      INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
      VALUES (?, 'caregiver.update', 'caregiver', ?, ?, ?)
    `)
    .bind(actor, id, JSON.stringify(v.before), JSON.stringify(v.after))
    .run();

  const updatedProfile = await db
    .prepare('SELECT * FROM caregiver WHERE id = ?')
    .bind(id)
    .first();

  return {
    ok: true,
    profile: updatedProfile
  };
}
