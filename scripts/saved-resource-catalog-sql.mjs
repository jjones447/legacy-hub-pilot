// Run from the reviewed site revision to print the SQL for its bookmark catalog.
import { publicResourceIds } from '../functions/_lib/resource-cards.mjs';
import { isSavedResourceId } from '../functions/_lib/domain/saved-resources.mjs';

const ids = publicResourceIds();
if (!ids.every(isSavedResourceId)) throw new Error('Invalid resource ID in public catalog');

// The resource ID alphabet excludes quotes. The current IDs and retirements are
// reconciled in one statement so a failed publication leaves the old set intact.
process.stdout.write(`WITH current_ids(resource_id) AS (
  SELECT value FROM json_each('${JSON.stringify(ids)}')
), desired(resource_id, published) AS (
  SELECT resource_id, 1 FROM current_ids
  UNION ALL
  SELECT resource_id, 0 FROM saved_resource_catalog
  WHERE published = 1 AND resource_id NOT IN (SELECT resource_id FROM current_ids)
)
INSERT INTO saved_resource_catalog (resource_id, published)
SELECT resource_id, published FROM desired WHERE 1
ON CONFLICT(resource_id) DO UPDATE SET published = excluded.published
WHERE saved_resource_catalog.published <> excluded.published;
`);
