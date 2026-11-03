-- UNAPPLIED B1 candidate. NOT in the active migration catalog. pc1-codex-5.
-- No real collection until program/privacy/storage owners qualify policy and activation.
ALTER TABLE event ADD COLUMN respite_review_required INTEGER NOT NULL DEFAULT 0
  CHECK(respite_review_required IN (0,1));
CREATE TABLE respite_application (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  payload_digest TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES event(id),
  caregiver_id TEXT REFERENCES caregiver(id),
  identity_basis TEXT NOT NULL DEFAULT 'unresolved' CHECK(identity_basis IN ('unresolved','staff_verified')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','declined')),
  revision INTEGER NOT NULL DEFAULT 1,
  first_time INTEGER NOT NULL CHECK(first_time IN (0,1)),
  followup_by TEXT,
  followup_at TEXT,
  identity_verified_by TEXT,
  identity_verified_at TEXT,
  privacy_version TEXT NOT NULL,
  nonmedical_version TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  registration_id INTEGER UNIQUE REFERENCES registration(id),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now')),
  CHECK ((caregiver_id IS NULL AND identity_basis='unresolved') OR
    (caregiver_id IS NOT NULL AND identity_basis='staff_verified' AND identity_verified_by IS NOT NULL AND identity_verified_at IS NOT NULL)),
  CHECK (status!='confirmed' OR (caregiver_id IS NOT NULL AND (first_time=0 OR (followup_by IS NOT NULL AND followup_at IS NOT NULL))))
);
CREATE INDEX respite_application_session ON respite_application(event_id,status,created_at);
CREATE TABLE respite_application_private (
  application_id TEXT PRIMARY KEY REFERENCES respite_application(id),
  schema_version TEXT NOT NULL CHECK(schema_version='b1-fictional-v1'),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json)<=12000)
);
CREATE TRIGGER respite_private_immutable BEFORE UPDATE ON respite_application_private
BEGIN SELECT RAISE(ABORT,'respite snapshot is immutable'); END;
CREATE TRIGGER respite_private_no_delete BEFORE DELETE ON respite_application_private
BEGIN SELECT RAISE(ABORT,'respite retention decision required'); END;
-- Prevent changing the identity/receipt/payload after submission, including reparenting.
CREATE TRIGGER respite_application_immutable BEFORE UPDATE ON respite_application
WHEN NEW.id IS NOT OLD.id OR NEW.request_key IS NOT OLD.request_key OR
 NEW.payload_digest IS NOT OLD.payload_digest OR NEW.event_id IS NOT OLD.event_id OR
 NEW.first_time IS NOT OLD.first_time OR NEW.privacy_version IS NOT OLD.privacy_version OR
 NEW.nonmedical_version IS NOT OLD.nonmedical_version OR NEW.acknowledged_at IS NOT OLD.acknowledged_at OR
 NEW.created_at IS NOT OLD.created_at OR OLD.status!='pending' AND
 (NEW.status IS NOT OLD.status OR NEW.caregiver_id IS NOT OLD.caregiver_id OR NEW.followup_by IS NOT OLD.followup_by)
BEGIN SELECT RAISE(ABORT,'respite immutable fields'); END;
CREATE TRIGGER respite_application_no_delete BEFORE DELETE ON respite_application
BEGIN SELECT RAISE(ABORT,'respite retention decision required'); END;
CREATE TRIGGER respite_registration_link BEFORE UPDATE OF registration_id ON respite_application
WHEN NEW.registration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM registration r WHERE
 r.id=NEW.registration_id AND r.event_id=NEW.event_id AND r.caregiver_id=NEW.caregiver_id
 AND r.source='respite_b1_v1' AND r.external_ref=NEW.id AND NEW.status='confirmed') OR
 OLD.registration_id IS NOT NULL AND NEW.registration_id IS NOT OLD.registration_id
BEGIN SELECT RAISE(ABORT,'respite registration link locked'); END;
CREATE TRIGGER respite_event_marker BEFORE UPDATE OF respite_review_required ON event
WHEN NEW.respite_review_required!=OLD.respite_review_required AND
 (EXISTS(SELECT 1 FROM respite_application WHERE event_id=OLD.id) OR
 EXISTS(SELECT 1 FROM registration WHERE event_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'respite event marker requires separate reconciliation'); END;
CREATE TRIGGER respite_registration_no_delete BEFORE DELETE ON registration
WHEN OLD.source='respite_b1_v1'
BEGIN SELECT RAISE(ABORT,'respite registration is retained'); END;
-- Every existing registration writer is fenced, including intake and payment webhooks.
-- The reviewed producer changes application state first, inserts registration, then links,
-- all in ONE D1 batch transaction. A failed guard/audit rolls the whole batch back.
CREATE TRIGGER respite_registration_insert BEFORE INSERT ON registration
WHEN (SELECT respite_review_required FROM event WHERE id=NEW.event_id)=1 OR NEW.source='respite_b1_v1'
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM respite_application a JOIN event e ON e.id=a.event_id
   JOIN caregiver c ON c.id=a.caregiver_id
   WHERE a.id=NEW.external_ref AND a.status='confirmed' AND a.registration_id IS NULL
   AND a.event_id=NEW.event_id AND a.caregiver_id=NEW.caregiver_id AND c.status!='archived'
   AND e.respite_review_required=1 AND e.publish_state='published' AND julianday(e.starts_at)>julianday('now')
   AND NEW.source='respite_b1_v1' AND NEW.status='registered'
   AND (e.capacity IS NULL OR (SELECT COUNT(*) FROM registration r WHERE r.event_id=e.id
     AND r.status IN ('registered','attended'))<e.capacity))
 THEN RAISE(ABORT,'respite staffed review required') END;
END;
CREATE TRIGGER respite_registration_update BEFORE UPDATE ON registration
WHEN (SELECT respite_review_required FROM event WHERE id=NEW.event_id)=1 OR
 (SELECT respite_review_required FROM event WHERE id=OLD.event_id)=1 OR OLD.source='respite_b1_v1' OR NEW.source='respite_b1_v1'
BEGIN
 SELECT CASE WHEN NEW.event_id IS NOT OLD.event_id OR NEW.caregiver_id IS NOT OLD.caregiver_id OR
  NEW.source IS NOT OLD.source OR NEW.external_ref IS NOT OLD.external_ref OR
  NOT EXISTS(SELECT 1 FROM respite_application a WHERE a.registration_id=OLD.id AND a.status='confirmed'
    AND a.id=OLD.external_ref AND a.event_id=OLD.event_id AND a.caregiver_id=OLD.caregiver_id)
  THEN RAISE(ABORT,'respite registration identity locked') END;
 SELECT CASE WHEN NEW.status IN ('registered','attended') AND OLD.status NOT IN ('registered','attended') AND
  EXISTS(SELECT 1 FROM event e WHERE e.id=NEW.event_id AND (e.publish_state!='published' OR
    e.capacity IS NOT NULL AND (SELECT COUNT(*) FROM registration r WHERE r.event_id=e.id
      AND r.status IN ('registered','attended'))>=e.capacity))
  THEN RAISE(ABORT,'respite capacity unavailable') END;
END;
