// Staff records: who has signed in to the staff console, their role, and whether they are active.
// Access (checked in _middleware.js) decides who may sign in; this module records the person and
// lets an admin deactivate them. See schema/0011_staff_member.sql.

// Refresh last_seen_at at most this often, so a busy console does not write on every request.
export const LAST_SEEN_REFRESH_MS = 10 * 60 * 1000;

export const STAFF_ROLES = ['admin', 'staff'];
export const STAFF_STATUSES = ['active', 'deactivated'];

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function sqliteNow(now) {
  return new Date(now).toISOString().replace('T', ' ').slice(0, 19);
}

function parseSqliteTime(value) {
  if (!value) return NaN;
  return Date.parse(String(value).replace(' ', 'T') + 'Z');
}

/**
 * Record a verified staff sign-in and return the person's current record.
 * Creates the row on first sign-in; afterwards only refreshes last_seen_at when it is stale.
 */
export async function recordStaffSignIn(db, email, now = Date.now()) {
  const key = normalizeEmail(email);
  if (!key) return null;
  const stamp = sqliteNow(now);

  let row = await db
    .prepare('SELECT email, display_name, role, status, last_seen_at FROM staff_member WHERE email = ?')
    .bind(key)
    .first();

  if (!row) {
    await db
      .prepare('INSERT OR IGNORE INTO staff_member (email, first_seen_at, last_seen_at) VALUES (?, ?, ?)')
      .bind(key, stamp, stamp)
      .run();
    await db
      .prepare("INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'staff.first_sign_in', 'staff_member', ?)")
      .bind(key, key)
      .run();
    return { email: key, display_name: null, role: 'staff', status: 'active', last_seen_at: stamp };
  }

  const last = parseSqliteTime(row.last_seen_at);
  if (!Number.isFinite(last) || now - last >= LAST_SEEN_REFRESH_MS) {
    await db
      .prepare('UPDATE staff_member SET last_seen_at = ?, first_seen_at = COALESCE(first_seen_at, ?) WHERE email = ?')
      .bind(stamp, stamp, key)
      .run();
    row = { ...row, last_seen_at: stamp };
  }
  return row;
}

export async function getStaffMember(db, email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  return db
    .prepare('SELECT email, display_name, role, status, first_seen_at, last_seen_at FROM staff_member WHERE email = ?')
    .bind(key)
    .first();
}

export async function listStaff(db) {
  const { results } = await db
    .prepare(`SELECT email, display_name, role, status, first_seen_at, last_seen_at
              FROM staff_member
              ORDER BY status = 'deactivated', COALESCE(display_name, email) COLLATE NOCASE`)
    .all();
  return results || [];
}

/**
 * Apply an admin's change to one staff record. Returns { ok, status, error?, member? }.
 * Rules: only admins change records; nobody changes their own role or status; the last active
 * admin cannot be demoted or deactivated.
 */
export async function updateStaffMember(db, actorEmail, targetEmail, changes) {
  const actor = await getStaffMember(db, actorEmail);
  if (!actor || actor.role !== 'admin' || actor.status !== 'active') {
    return { ok: false, status: 403, error: 'Only an admin can change staff records.' };
  }
  const target = await getStaffMember(db, targetEmail);
  if (!target) return { ok: false, status: 404, error: 'No staff record for that email.' };

  const next = { display_name: target.display_name, role: target.role, status: target.status };
  if (changes && Object.prototype.hasOwnProperty.call(changes, 'display_name')) {
    const name = changes.display_name == null ? '' : String(changes.display_name).trim();
    if (name.length > 120) return { ok: false, status: 400, error: 'Name is too long (120 characters at most).' };
    next.display_name = name || null;
  }
  if (changes && changes.role !== undefined) {
    if (!STAFF_ROLES.includes(changes.role)) return { ok: false, status: 400, error: 'Role must be admin or staff.' };
    next.role = changes.role;
  }
  if (changes && changes.status !== undefined) {
    if (!STAFF_STATUSES.includes(changes.status)) return { ok: false, status: 400, error: 'Status must be active or deactivated.' };
    next.status = changes.status;
  }

  const isSelf = normalizeEmail(actorEmail) === target.email;
  if (isSelf && (next.role !== target.role || next.status !== target.status)) {
    return { ok: false, status: 400, error: 'You cannot change your own role or deactivate yourself. Ask another admin.' };
  }

  const losesAdmin = target.role === 'admin' && target.status === 'active' && (next.role !== 'admin' || next.status !== 'active');
  if (losesAdmin) {
    const other = await db
      .prepare("SELECT COUNT(*) AS n FROM staff_member WHERE role = 'admin' AND status = 'active' AND email != ?")
      .bind(target.email)
      .first();
    if (!other || Number(other.n) < 1) {
      return { ok: false, status: 400, error: 'At least one active admin must remain.' };
    }
  }

  await db
    .prepare("UPDATE staff_member SET display_name = ?, role = ?, status = ?, updated_at = datetime('now') WHERE email = ?")
    .bind(next.display_name, next.role, next.status, target.email)
    .run();
  await db
    .prepare("INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json) VALUES (?, 'staff.updated', 'staff_member', ?, ?, ?)")
    .bind(
      normalizeEmail(actorEmail),
      target.email,
      JSON.stringify({ display_name: target.display_name, role: target.role, status: target.status }),
      JSON.stringify(next)
    )
    .run();

  return { ok: true, status: 200, member: { ...target, ...next } };
}
