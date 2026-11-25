-- UNAPPLIED new-model confirmation prerequisite. Not a complete Staff writer.
-- A qualifying request must first be marked confirmed in the SAME transaction;
-- registration link/revision and metadata audit must commit together afterward.
CREATE TRIGGER respite_marked_registration_insert BEFORE INSERT ON registration
WHEN (SELECT respite_review_required FROM event WHERE id=NEW.event_id)=1
 OR NEW.source='respite_owner_v1'
BEGIN
 SELECT CASE WHEN NEW.source!='respite_owner_v1' OR NEW.status!='registered'
  THEN RAISE(ABORT,'dedicated respite confirmation required') END;
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM respite_request r
  JOIN respite_participant p ON p.id=r.participant_id AND p.caregiver_id=r.caregiver_id
  JOIN caregiver c ON c.id=r.caregiver_id
  JOIN staff_member s ON s.email=r.reviewed_by
  JOIN event e ON e.id=r.event_id
  WHERE r.id=NEW.external_ref AND r.caregiver_id=NEW.caregiver_id AND r.event_id=NEW.event_id
   AND r.status='confirmed' AND r.needs_review=0 AND r.reviewed_revision=r.revision
   AND r.participant_revision=p.revision AND r.details_json IS NOT NULL
   AND r.removed_at IS NULL AND r.registration_id IS NULL
   AND c.status!='archived' AND s.status='active' AND s.role IN ('staff','admin')
   AND e.respite_review_required=1 AND e.publish_state='published'
   AND julianday(e.starts_at)>julianday('now'))
  THEN RAISE(ABORT,'current reviewed respite request required') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM event e WHERE e.id=NEW.event_id AND e.capacity IS NOT NULL
  AND (SELECT COUNT(*) FROM registration x WHERE x.event_id=e.id AND x.status IN ('registered','attended'))>=e.capacity)
  THEN RAISE(ABORT,'respite capacity unavailable') END;
END;
CREATE TRIGGER respite_marked_event_identity BEFORE UPDATE OF respite_review_required ON event
WHEN NEW.respite_review_required!=OLD.respite_review_required
 AND EXISTS(SELECT 1 FROM respite_request WHERE event_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'respite session marker locked'); END;
