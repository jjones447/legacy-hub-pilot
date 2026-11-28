// The portal adapter supplies the identity and expiry from its verified session.
const eligibleOwner = `
  SELECT id FROM caregiver
  WHERE id = ?1 AND status <> 'archived'
    AND unixepoch('now', 'subsec') * 1000 < ?2`;

const publishedResource = `
  SELECT resource_id FROM saved_resource_catalog
  WHERE resource_id = ?3 AND published = 1`;

function ownerBindings(session) {
  if (typeof session?.caregiverId !== 'string' || !session.caregiverId ||
      !Number.isSafeInteger(session.expiresAtMs)) {
    throw new TypeError('Invalid verified session');
  }
  return [session.caregiverId, session.expiresAtMs];
}

export function isSavedResourceId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 &&
    /^[a-z0-9]/.test(value) && !/[^a-z0-9_-]/.test(value);
}

function checkedResourceId(resourceId) {
  if (!isSavedResourceId(resourceId)) throw new TypeError('Invalid resource ID');
  return resourceId;
}

export async function saveResource(db, session, resourceId) {
  const params = [...ownerBindings(session), checkedResourceId(resourceId)];
  const insert = db.prepare(`
    INSERT INTO saved_resource (caregiver_id, resource_id)
    SELECT ?1, ?3 WHERE EXISTS (${eligibleOwner}) AND EXISTS (${publishedResource})
    ON CONFLICT (caregiver_id, resource_id) DO NOTHING`).bind(...params);

  // Read the original timestamp even when an earlier attempt already committed.
  const receipt = db.prepare(`
    SELECT EXISTS (${eligibleOwner}) AS eligible, (
      SELECT created_at FROM saved_resource WHERE caregiver_id = ?1 AND resource_id = ?3
      AND EXISTS (${eligibleOwner}) AND EXISTS (${publishedResource})
    ) AS created_at`).bind(...params);
  const [, result] = await db.batch([insert, receipt]);
  const [row] = result.results;
  if (!row.eligible) return { status: 'unauthorized' };
  if (row.created_at === null) return { status: 'unavailable' };
  return { status: 'saved', createdAt: row.created_at };
}

export async function removeSavedResource(db, session, resourceId) {
  const params = [...ownerBindings(session), checkedResourceId(resourceId)];
  // Removal also works after the public resource has been retired.
  const remove = db.prepare(`
    DELETE FROM saved_resource WHERE caregiver_id = ?1 AND resource_id = ?3
    AND EXISTS (${eligibleOwner})`).bind(...params);
  const owner = db.prepare(eligibleOwner).bind(session.caregiverId, session.expiresAtMs);
  const [, result] = await db.batch([remove, owner]);
  return { status: result.results.length ? 'removed' : 'unauthorized' };
}

const PAGE_SIZE = 50;

// The HTTP adapter handles the external cursor. This store accepts its decoded sort key.
export async function listSavedResources(db, session, after = null) {
  const identity = ownerBindings(session);
  const params = [...identity];
  let continuation = '';
  if (after !== null) {
    if (typeof after?.createdAt !== 'string' || after.createdAt.length !== 19 ||
        !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(after.createdAt)) {
      throw new TypeError('Invalid bookmark timestamp');
    }
    params.push(after.createdAt, checkedResourceId(after.resourceId));
    continuation = 'AND (s.created_at < ?3 OR (s.created_at = ?3 AND s.resource_id > ?4))';
  }

  const page = db.prepare(`
    SELECT s.resource_id AS resourceId, s.created_at AS createdAt, c.published
    FROM saved_resource AS s
    JOIN saved_resource_catalog AS c ON c.resource_id = s.resource_id
    WHERE s.caregiver_id IN (${eligibleOwner}) ${continuation}
    ORDER BY s.created_at DESC, s.resource_id ASC
    LIMIT ${PAGE_SIZE + 1}`).bind(...params);
  const owner = db.prepare(eligibleOwner).bind(...identity);
  const [result, currentOwner] = await db.batch([page, owner]);
  if (!currentOwner.results.length) return { status: 'unauthorized' };
  const items = result.results.slice(0, PAGE_SIZE).map(row => ({
    resourceId: row.resourceId, createdAt: row.createdAt, available: row.published === 1,
  }));
  const last = items.at(-1);
  const next = result.results.length > PAGE_SIZE ? { createdAt: last.createdAt, resourceId: last.resourceId } : null;
  return { status: 'ok', items, next };
}
