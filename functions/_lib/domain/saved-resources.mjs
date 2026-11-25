// The portal adapter supplies the identity and expiry from its verified session.
const eligibleOwner = `
  SELECT id FROM caregiver
  WHERE id = ?1 AND status <> 'archived'
    AND unixepoch('now', 'subsec') * 1000 < ?2`;

const publishedResource = `
  SELECT resource_id FROM saved_resource_catalog
  WHERE resource_id = ?3 AND published = 1`;

function bookmarkBindings(session, resourceId) {
  if (typeof session?.caregiverId !== 'string' || !session.caregiverId ||
      !Number.isSafeInteger(session.expiresAtMs)) {
    throw new TypeError('Invalid verified session');
  }
  if (typeof resourceId !== 'string' || resourceId.length === 0 || resourceId.length > 80 ||
      !/^[a-z0-9]/.test(resourceId) || /[^a-z0-9_-]/.test(resourceId)) {
    throw new TypeError('Invalid resource ID');
  }
  return [session.caregiverId, session.expiresAtMs, resourceId];
}

export async function saveResource(db, session, resourceId) {
  const params = bookmarkBindings(session, resourceId);
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
  const params = bookmarkBindings(session, resourceId);
  // Removal also works after the public resource has been retired.
  const remove = db.prepare(`
    DELETE FROM saved_resource WHERE caregiver_id = ?1 AND resource_id = ?3
    AND EXISTS (${eligibleOwner})`).bind(...params);
  const owner = db.prepare(eligibleOwner).bind(session.caregiverId, session.expiresAtMs);
  const [, result] = await db.batch([remove, owner]);
  return { status: result.results.length ? 'removed' : 'unauthorized' };
}
