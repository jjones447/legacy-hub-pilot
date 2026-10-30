-- Event photos use the existing MEDIA bucket; previous objects stay private for recovery.
ALTER TABLE event ADD COLUMN photo_key TEXT;
ALTER TABLE event ADD COLUMN photo_alt TEXT;

-- A retried upload must refer to its original audit, never create a second effect.
CREATE UNIQUE INDEX IF NOT EXISTS audit_event_photo_request
  ON audit_log(entity_id, json_extract(after_json, '$.request_id'))
  WHERE action = 'event.photo.updated' AND json_valid(after_json);
