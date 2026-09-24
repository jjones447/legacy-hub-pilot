// Domain module for event management (slice D7-S2A).
// Exports validate and apply functions used by REST handlers and the governed agent pipeline.

export const EVENT_TYPES = [
  'support_group',
  'memory_social',
  'caregiver_event',
  'wellness',
  'other'
];

export const ALLOWED_EVENT_UPDATE_FIELDS = [
  'title',
  'type',
  'starts_at',
  'ends_at',
  'location',
  'capacity',
  'recurring'
];

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function validate(db, { id, operation, payload = {} }) {
  if (!['create', 'update', 'publish', 'archive'].includes(operation)) {
    return { ok: false, status: 400, error: `unsupported operation: ${operation}` };
  }

  if (operation === 'create') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, status: 400, error: 'payload must be an object' };
    }

    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (!title) {
      return { ok: false, status: 400, error: 'title is required' };
    }

    if (!payload.type || !EVENT_TYPES.includes(payload.type)) {
      return { ok: false, status: 400, error: `type must be one of: ${EVENT_TYPES.join(', ')}` };
    }

    if (!payload.starts_at || isNaN(Date.parse(payload.starts_at))) {
      return { ok: false, status: 400, error: 'starts_at must be a valid date' };
    }

    let ends_at = null;
    if (payload.ends_at !== undefined && payload.ends_at !== null) {
      if (isNaN(Date.parse(payload.ends_at))) {
        return { ok: false, status: 400, error: 'ends_at must be a valid date' };
      }
      if (Date.parse(payload.ends_at) < Date.parse(payload.starts_at)) {
        return { ok: false, status: 400, error: 'ends_at cannot be earlier than starts_at' };
      }
      ends_at = payload.ends_at;
    }

    let capacity = null;
    if (payload.capacity !== undefined && payload.capacity !== null && payload.capacity !== '') {
      const capNum = Number(payload.capacity);
      if (!Number.isInteger(capNum) || capNum < 1) {
        return { ok: false, status: 400, error: 'capacity must be an integer >= 1' };
      }
      capacity = capNum;
    }

    const recurring = payload.recurring ? 1 : 0;
    const location = payload.location ? String(payload.location).trim() : null;

    let eventId = payload.id || (id && id !== 'new' ? id : null);
    if (eventId) {
      eventId = String(eventId).trim();
      if (!eventId.startsWith('ev_')) {
        eventId = 'ev_' + eventId;
      }
    } else {
      const baseSlug = slugify(title);
      eventId = 'ev_' + (baseSlug || 'event');
    }

    // Check ID collision
    const existing = await db
      .prepare('SELECT id FROM event WHERE id = ?')
      .bind(eventId)
      .first();

    if (existing) {
      return { ok: false, status: 409, error: `event id '${eventId}' already exists` };
    }

    const createdEvent = {
      id: eventId,
      title,
      type: payload.type,
      starts_at: payload.starts_at,
      ends_at,
      location,
      capacity,
      recurring,
      publish_state: 'draft'
    };

    return {
      ok: true,
      current: null,
      projected: createdEvent,
      before: {},
      after: createdEvent,
      operation: 'create',
      payload: createdEvent
    };
  }

  // Operations update, publish, archive require an existing event
  const targetId = id || payload.id;
  if (!targetId) {
    return { ok: false, status: 400, error: 'missing event id' };
  }

  const current = await db
    .prepare('SELECT * FROM event WHERE id = ?')
    .bind(targetId)
    .first();

  if (!current) {
    return { ok: false, status: 404, error: 'event not found' };
  }

  if (operation === 'update') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, status: 400, error: 'payload must be an object' };
    }

    if (payload.id && payload.id !== targetId) {
      return { ok: false, status: 400, error: 'updating event id is not permitted' };
    }

    if ('publish_state' in payload) {
      return { ok: false, status: 400, error: 'publish_state cannot be updated directly; use publish or archive' };
    }

    const keys = Object.keys(payload).filter(k => k !== 'id');
    if (keys.length === 0) {
      return { ok: false, status: 400, error: 'no update fields provided' };
    }

    for (const key of keys) {
      if (!ALLOWED_EVENT_UPDATE_FIELDS.includes(key)) {
        return { ok: false, status: 400, error: `unknown or forbidden field: ${key}` };
      }
    }

    const normalized = {};

    if ('title' in payload) {
      const t = typeof payload.title === 'string' ? payload.title.trim() : '';
      if (!t) return { ok: false, status: 400, error: 'title cannot be empty' };
      normalized.title = t;
    }

    if ('type' in payload) {
      if (!EVENT_TYPES.includes(payload.type)) {
        return { ok: false, status: 400, error: `type must be one of: ${EVENT_TYPES.join(', ')}` };
      }
      normalized.type = payload.type;
    }

    const effectiveStartsAt = 'starts_at' in payload ? payload.starts_at : current.starts_at;
    if ('starts_at' in payload) {
      if (!payload.starts_at || isNaN(Date.parse(payload.starts_at))) {
        return { ok: false, status: 400, error: 'starts_at must be a valid date' };
      }
      normalized.starts_at = payload.starts_at;
    }

    if ('ends_at' in payload) {
      if (payload.ends_at !== null && payload.ends_at !== '') {
        if (isNaN(Date.parse(payload.ends_at))) {
          return { ok: false, status: 400, error: 'ends_at must be a valid date' };
        }
        if (Date.parse(payload.ends_at) < Date.parse(effectiveStartsAt)) {
          return { ok: false, status: 400, error: 'ends_at cannot be earlier than starts_at' };
        }
        normalized.ends_at = payload.ends_at;
      } else {
        normalized.ends_at = null;
      }
    }

    if ('capacity' in payload) {
      if (payload.capacity !== null && payload.capacity !== '') {
        const capNum = Number(payload.capacity);
        if (!Number.isInteger(capNum) || capNum < 1) {
          return { ok: false, status: 400, error: 'capacity must be an integer >= 1' };
        }
        normalized.capacity = capNum;
      } else {
        normalized.capacity = null;
      }
    }

    if ('location' in payload) {
      normalized.location = payload.location ? String(payload.location).trim() : null;
    }

    if ('recurring' in payload) {
      normalized.recurring = payload.recurring ? 1 : 0;
    }

    const before = {};
    const after = {};
    const projected = { ...current };

    for (const [k, v] of Object.entries(normalized)) {
      before[k] = current[k];
      after[k] = v;
      projected[k] = v;
    }

    return {
      ok: true,
      current,
      projected,
      before,
      after,
      operation: 'update',
      payload: normalized
    };
  }

  if (operation === 'publish') {
    if (current.publish_state !== 'draft') {
      return { ok: false, status: 409, error: `cannot publish from status ${current.publish_state}` };
    }

    return {
      ok: true,
      current,
      projected: { ...current, publish_state: 'published' },
      before: { publish_state: current.publish_state },
      after: { publish_state: 'published' },
      operation: 'publish',
      payload: {}
    };
  }

  if (operation === 'archive') {
    if (current.publish_state === 'archived') {
      return { ok: false, status: 409, error: 'cannot archive from status archived' };
    }

    // Registrations guard
    const regRow = await db
      .prepare("SELECT COUNT(*) AS count FROM registration WHERE event_id = ? AND status IN ('registered', 'attended')")
      .bind(targetId)
      .first();

    const regCount = regRow ? (regRow.count || 0) : 0;

    if (regCount > 0 && payload.confirm_with_registrations !== true) {
      return {
        ok: false,
        status: 409,
        error: `event has ${regCount} registration(s); pass confirm_with_registrations to proceed`,
        registration_count: regCount
      };
    }

    const afterState = { publish_state: 'archived' };
    if (regCount > 0) {
      afterState.registration_count = regCount;
    }

    return {
      ok: true,
      current,
      projected: { ...current, publish_state: 'archived' },
      before: { publish_state: current.publish_state },
      after: afterState,
      operation: 'archive',
      payload: { confirm_with_registrations: payload.confirm_with_registrations === true }
    };
  }

  return { ok: false, status: 400, error: 'unsupported operation' };
}

export async function apply(db, { id, operation, payload = {} }, actor) {
  const v = await validate(db, { id, operation, payload });
  if (!v.ok) {
    return v;
  }

  const targetId = v.projected.id;

  if (operation === 'create') {
    await db
      .prepare(`
        INSERT INTO event (id, title, type, starts_at, ends_at, location, capacity, recurring, publish_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `)
      .bind(
        targetId,
        v.projected.title,
        v.projected.type,
        v.projected.starts_at,
        v.projected.ends_at,
        v.projected.location,
        v.projected.capacity,
        v.projected.recurring
      )
      .run();

    await db
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'event.create', 'event', ?, ?, ?)
      `)
      .bind(actor, targetId, JSON.stringify(v.before), JSON.stringify(v.after))
      .run();

    const created = await db
      .prepare('SELECT * FROM event WHERE id = ?')
      .bind(targetId)
      .first();

    return {
      ok: true,
      event: created
    };
  }

  if (operation === 'update') {
    const setClauses = [];
    const setParams = [];

    for (const [k, vVal] of Object.entries(v.payload)) {
      setClauses.push(`${k} = ?`);
      setParams.push(vVal);
    }

    setClauses.push("updated_at = datetime('now')");

    const sql = `UPDATE event SET ${setClauses.join(', ')} WHERE id = ?`;
    setParams.push(targetId);

    await db.prepare(sql).bind(...setParams).run();

    await db
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'event.update', 'event', ?, ?, ?)
      `)
      .bind(actor, targetId, JSON.stringify(v.before), JSON.stringify(v.after))
      .run();

    const updated = await db
      .prepare('SELECT * FROM event WHERE id = ?')
      .bind(targetId)
      .first();

    return {
      ok: true,
      event: updated
    };
  }

  if (operation === 'publish') {
    await db
      .prepare("UPDATE event SET publish_state = 'published', updated_at = datetime('now') WHERE id = ?")
      .bind(targetId)
      .run();

    await db
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'event.publish', 'event', ?, ?, ?)
      `)
      .bind(actor, targetId, JSON.stringify(v.before), JSON.stringify(v.after))
      .run();

    const updated = await db
      .prepare('SELECT * FROM event WHERE id = ?')
      .bind(targetId)
      .first();

    return {
      ok: true,
      event: updated
    };
  }

  if (operation === 'archive') {
    await db
      .prepare("UPDATE event SET publish_state = 'archived', updated_at = datetime('now') WHERE id = ?")
      .bind(targetId)
      .run();

    await db
      .prepare(`
        INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
        VALUES (?, 'event.archive', 'event', ?, ?, ?)
      `)
      .bind(actor, targetId, JSON.stringify(v.before), JSON.stringify(v.after))
      .run();

    const updated = await db
      .prepare('SELECT * FROM event WHERE id = ?')
      .bind(targetId)
      .first();

    return {
      ok: true,
      event: updated
    };
  }

  return { ok: false, status: 400, error: 'unsupported operation' };
}
