-- INERT proposal, not a numbered/applied migration. No collection authorization.
CREATE TABLE portal_support_request (
 id TEXT PRIMARY KEY NOT NULL,
 caregiver_id TEXT NOT NULL REFERENCES caregiver(id),
 request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 16 AND 80),
 payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
 needs_json TEXT NOT NULL CHECK(json_valid(needs_json) AND json_type(needs_json)='array'),
 preferred_contact TEXT NOT NULL CHECK(preferred_contact IN ('phone','text','email')),
 message TEXT NOT NULL DEFAULT '' CHECK(length(message)<=2000),
 status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','in_review','followed_up','closed')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision>=1),
 followup_id INTEGER NOT NULL UNIQUE REFERENCES followup(id),
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 updated_at TEXT NOT NULL DEFAULT(datetime('now')),
 UNIQUE(caregiver_id,request_key)
);
CREATE INDEX portal_support_request_owner ON portal_support_request(caregiver_id,created_at,id);
CREATE TRIGGER portal_support_request_insert_guard BEFORE INSERT ON portal_support_request BEGIN
 SELECT CASE WHEN NEW.status!='received' OR NEW.revision!=1 THEN RAISE(ABORT,'initial_state') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM caregiver WHERE id=NEW.caregiver_id AND status!='archived') THEN RAISE(ABORT,'inactive_owner') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup WHERE id=NEW.followup_id AND caregiver_id=NEW.caregiver_id AND kind='support_request') THEN RAISE(ABORT,'foreign_task') END;
 SELECT CASE WHEN json_array_length(NEW.needs_json) NOT BETWEEN 1 AND 5
  OR EXISTS(SELECT 1 FROM json_each(NEW.needs_json) WHERE type!='text' OR value NOT IN ('break','care','connect','resources','unsure'))
  OR (SELECT count(*) FROM json_each(NEW.needs_json))!=(SELECT count(DISTINCT value) FROM json_each(NEW.needs_json))
  THEN RAISE(ABORT,'invalid_needs') END;
END;
CREATE TRIGGER portal_support_request_update_guard BEFORE UPDATE ON portal_support_request BEGIN
 SELECT CASE WHEN NEW.id!=OLD.id OR NEW.caregiver_id!=OLD.caregiver_id OR NEW.request_key!=OLD.request_key
  OR NEW.payload_digest!=OLD.payload_digest OR NEW.needs_json!=OLD.needs_json OR NEW.preferred_contact!=OLD.preferred_contact
  OR NEW.message!=OLD.message OR NEW.followup_id!=OLD.followup_id OR NEW.created_at!=OLD.created_at
  THEN RAISE(ABORT,'immutable_request') END;
 SELECT CASE WHEN NEW.revision!=OLD.revision+1 THEN RAISE(ABORT,'revision_conflict') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM caregiver WHERE id=NEW.caregiver_id AND status!='archived') THEN RAISE(ABORT,'inactive_owner') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM followup WHERE id=NEW.followup_id AND caregiver_id=NEW.caregiver_id AND kind='support_request') THEN RAISE(ABORT,'foreign_task') END;
 SELECT CASE WHEN NOT ((OLD.status='received' AND NEW.status='in_review')
  OR (OLD.status='in_review' AND NEW.status IN ('followed_up','closed'))
  OR (OLD.status='followed_up' AND NEW.status IN ('in_review','closed')))
  THEN RAISE(ABORT,'invalid_transition') END;
END;
-- Removal/retention/restore policy is not implemented; no generic DELETE endpoint.
-- The application writer must bind owner+expected revision in WHERE and atomically
-- persist metadata-only audit. Triggers are integrity guards, NOT actor authorization.
