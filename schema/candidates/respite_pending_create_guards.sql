-- UNAPPLIED prerequisite/supplement to the retained new-model lifecycle candidate.
-- No migration number, marker population, activation or complete capacity producer.
ALTER TABLE event ADD COLUMN respite_review_required INTEGER NOT NULL DEFAULT 0
 CHECK(respite_review_required IN (0,1));
CREATE TRIGGER respite_pending_create_guard BEFORE INSERT ON respite_request BEGIN
 SELECT CASE WHEN NEW.status!='pending' OR NEW.needs_review!=1 OR NEW.revision!=1
  OR NEW.registration_id IS NOT NULL OR NEW.removed_at IS NOT NULL
  OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reviewed_revision IS NOT NULL
  OR NEW.followup_by IS NOT NULL OR NEW.followup_at IS NOT NULL
  THEN RAISE(ABORT,'pending creation only') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM caregiver WHERE id=NEW.caregiver_id AND status!='archived') THEN RAISE(ABORT,'owner unavailable') END;
 SELECT CASE WHEN NEW.participant_id IS NULL OR NOT EXISTS(SELECT 1 FROM respite_participant p WHERE p.id=NEW.participant_id AND p.caregiver_id=NEW.caregiver_id AND p.revision=NEW.participant_revision AND p.details_json=NEW.details_json AND json_type(p.details_json)='object') THEN RAISE(ABORT,'participant changed') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM event e WHERE e.id=NEW.event_id AND e.respite_review_required=1 AND e.publish_state='published' AND julianday(e.starts_at)>julianday('now')) THEN RAISE(ABORT,'session unavailable') END;
 SELECT CASE WHEN length(NEW.privacy_version) NOT BETWEEN 1 AND 80 OR length(NEW.nonmedical_version) NOT BETWEEN 1 AND 80 THEN RAISE(ABORT,'acknowledgments unavailable') END;
END;
