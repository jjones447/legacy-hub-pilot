-- UNAPPLIED design candidate; no migration number or activation authority.
-- Replaces, does not follow, unapplied 0019_respite_pending_review.sql.
-- Source slice only: routes, transactional writer and operating qualification absent.
CREATE TABLE respite_participant (
 id TEXT PRIMARY KEY,
 caregiver_id TEXT NOT NULL REFERENCES caregiver(id),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 details_json TEXT NOT NULL CHECK(json_valid(details_json) AND length(details_json)<=12000),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE respite_request (
 id TEXT PRIMARY KEY,
 caregiver_id TEXT NOT NULL REFERENCES caregiver(id),
 participant_id TEXT REFERENCES respite_participant(id) ON DELETE SET NULL,
 event_id TEXT NOT NULL REFERENCES event(id),
 request_key TEXT NOT NULL UNIQUE,
 payload_digest TEXT NOT NULL,
 details_json TEXT CHECK(details_json IS NULL OR (json_valid(details_json) AND length(details_json)<=12000)),
 participant_revision INTEGER NOT NULL CHECK(participant_revision>0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','declined','withdrawn')),
 needs_review INTEGER NOT NULL DEFAULT 1 CHECK(needs_review IN (0,1)),
 first_time INTEGER NOT NULL CHECK(first_time IN (0,1)),
 followup_by TEXT, followup_at TEXT,
 reviewed_by TEXT, reviewed_at TEXT, reviewed_revision INTEGER,
 privacy_version TEXT NOT NULL, nonmedical_version TEXT NOT NULL, acknowledged_at TEXT NOT NULL,
 registration_id INTEGER UNIQUE REFERENCES registration(id),
 removed_at TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 CHECK(status!='confirmed' OR (needs_review=0 AND reviewed_revision=revision AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND details_json IS NOT NULL AND removed_at IS NULL AND (first_time=0 OR (followup_by IS NOT NULL AND followup_at IS NOT NULL)))),
 CHECK(removed_at IS NULL OR (details_json IS NULL AND status='withdrawn' AND needs_review=1 AND reviewed_by IS NULL AND reviewed_at IS NULL AND reviewed_revision IS NULL))
);
CREATE INDEX respite_participant_owner ON respite_participant(caregiver_id,id);
CREATE INDEX respite_request_owner ON respite_request(caregiver_id,id);
CREATE INDEX respite_request_session ON respite_request(event_id,status);
CREATE TRIGGER respite_participant_identity BEFORE UPDATE ON respite_participant
WHEN NEW.id IS NOT OLD.id OR NEW.caregiver_id IS NOT OLD.caregiver_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'participant identity locked'); END;
CREATE TRIGGER respite_participant_revision BEFORE UPDATE ON respite_participant
WHEN NEW.revision!=OLD.revision+1
BEGIN SELECT RAISE(ABORT,'participant revision required'); END;
CREATE TRIGGER respite_request_identity BEFORE UPDATE ON respite_request
WHEN NEW.id IS NOT OLD.id OR NEW.caregiver_id IS NOT OLD.caregiver_id OR NEW.event_id IS NOT OLD.event_id OR NEW.request_key IS NOT OLD.request_key OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'request identity locked'); END;
CREATE TRIGGER respite_request_owner_insert BEFORE INSERT ON respite_request
WHEN NEW.participant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM respite_participant p WHERE p.id=NEW.participant_id AND p.caregiver_id=NEW.caregiver_id)
BEGIN SELECT RAISE(ABORT,'participant owner mismatch'); END;
CREATE TRIGGER respite_request_owner_update BEFORE UPDATE ON respite_request
WHEN NEW.participant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM respite_participant p WHERE p.id=NEW.participant_id AND p.caregiver_id=NEW.caregiver_id)
BEGIN SELECT RAISE(ABORT,'participant owner mismatch'); END;
CREATE TRIGGER respite_request_change BEFORE UPDATE ON respite_request
WHEN (NEW.details_json IS NOT OLD.details_json OR NEW.participant_revision IS NOT OLD.participant_revision OR NEW.first_time IS NOT OLD.first_time)
 AND (NEW.revision!=OLD.revision+1 OR NEW.needs_review!=1 OR NEW.status='confirmed' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_revision IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'changed needs require fresh review'); END;
CREATE TRIGGER respite_request_no_revive BEFORE UPDATE ON respite_request
WHEN OLD.removed_at IS NOT NULL AND (NEW.removed_at IS NOT OLD.removed_at OR NEW.details_json IS NOT NULL OR NEW.status!='withdrawn')
BEGIN SELECT RAISE(ABORT,'removed request cannot revive'); END;
-- A linked live reservation must be cancelled before invalidating review/removing.
-- Both writes must be one transaction in the future dedicated writer.
CREATE TRIGGER respite_request_reservation BEFORE UPDATE ON respite_request
WHEN (NEW.status!='confirmed' OR NEW.needs_review=1) AND EXISTS(
 SELECT 1 FROM registration r WHERE r.id=OLD.registration_id AND r.status='registered')
BEGIN SELECT RAISE(ABORT,'cancel reservation atomically first'); END;
CREATE TRIGGER respite_registration_no_revive BEFORE UPDATE OF status ON registration
WHEN NEW.status IN ('registered','attended') AND EXISTS(SELECT 1 FROM respite_request a WHERE a.registration_id=OLD.id)
 AND NOT EXISTS(SELECT 1 FROM respite_request a WHERE a.registration_id=OLD.id AND a.caregiver_id=NEW.caregiver_id AND a.event_id=NEW.event_id AND a.status='confirmed' AND a.needs_review=0 AND a.reviewed_revision=a.revision AND a.removed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'fresh respite review required'); END;
-- Every request write advances its CAS revision; no writer-only exemption.
CREATE TRIGGER respite_request_revision BEFORE UPDATE ON respite_request
WHEN NEW.revision!=OLD.revision+1
BEGIN SELECT RAISE(ABORT,'request revision required'); END;
-- An issued receipt/consent cannot be rewritten. New consent needs a new request.
CREATE TRIGGER respite_request_receipt BEFORE UPDATE ON respite_request
WHEN NEW.payload_digest IS NOT OLD.payload_digest OR NEW.privacy_version IS NOT OLD.privacy_version OR NEW.nonmedical_version IS NOT OLD.nonmedical_version OR NEW.acknowledged_at IS NOT OLD.acknowledged_at
BEGIN SELECT RAISE(ABORT,'request receipt locked'); END;
CREATE TRIGGER respite_request_review_invalidation BEFORE UPDATE ON respite_request
WHEN (NEW.participant_id IS NOT OLD.participant_id OR (OLD.status='confirmed' AND NEW.status!='confirmed'))
 AND (NEW.needs_review!=1 OR NEW.status='confirmed' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_revision IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'fresh review required after transition'); END;
CREATE TRIGGER respite_request_registration_lock BEFORE UPDATE ON respite_request
WHEN OLD.registration_id IS NOT NULL AND NEW.registration_id IS NOT OLD.registration_id
BEGIN SELECT RAISE(ABORT,'registration link locked'); END;
CREATE TRIGGER respite_request_registration_insert BEFORE INSERT ON respite_request
WHEN NEW.registration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM registration r WHERE r.id=NEW.registration_id AND r.caregiver_id=NEW.caregiver_id AND r.event_id=NEW.event_id)
BEGIN SELECT RAISE(ABORT,'registration identity mismatch'); END;
CREATE TRIGGER respite_request_registration_update BEFORE UPDATE ON respite_request
WHEN NEW.registration_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM registration r WHERE r.id=NEW.registration_id AND r.caregiver_id=NEW.caregiver_id AND r.event_id=NEW.event_id)
BEGIN SELECT RAISE(ABORT,'registration identity mismatch'); END;
CREATE TRIGGER respite_registration_identity BEFORE UPDATE ON registration
WHEN EXISTS(SELECT 1 FROM respite_request a WHERE a.registration_id=OLD.id)
 AND (NEW.id IS NOT OLD.id OR NEW.caregiver_id IS NOT OLD.caregiver_id OR NEW.event_id IS NOT OLD.event_id)
BEGIN SELECT RAISE(ABORT,'linked registration identity locked'); END;
