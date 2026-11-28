-- TEST candidate. The publisher reconciles these IDs against the rendered catalog.
-- A retired resource keeps its ID so existing owners can still remove it.
CREATE TABLE saved_resource_catalog (
  resource_id TEXT NOT NULL PRIMARY KEY CHECK (
    length(resource_id) BETWEEN 1 AND 80
    AND resource_id GLOB '[a-z0-9]*'
    AND resource_id NOT GLOB '*[^a-z0-9_-]*'
    AND instr(resource_id, char(0)) = 0
  ),
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);

CREATE TABLE saved_resource (
  caregiver_id TEXT NOT NULL REFERENCES caregiver(id),
  resource_id TEXT NOT NULL REFERENCES saved_resource_catalog(resource_id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (caregiver_id, resource_id)
);

CREATE INDEX saved_resource_owner_newest
  ON saved_resource (caregiver_id, created_at DESC, resource_id);

-- Re-check both conditions at insertion, including retries after retirement.
CREATE TRIGGER saved_resource_check_insert
BEFORE INSERT ON saved_resource
WHEN NOT EXISTS (
  SELECT 1 FROM caregiver WHERE id = NEW.caregiver_id AND status <> 'archived'
) OR NOT EXISTS (
  SELECT 1 FROM saved_resource_catalog WHERE resource_id = NEW.resource_id AND published = 1
)
BEGIN
  SELECT RAISE(ABORT, 'saved resource unavailable');
END;

-- A bookmark's owner, target, and original creation time are immutable.
CREATE TRIGGER saved_resource_no_update
BEFORE UPDATE ON saved_resource
BEGIN
  SELECT RAISE(ABORT, 'saved resource is immutable');
END;
