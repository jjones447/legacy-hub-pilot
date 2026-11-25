-- UNAPPLIED integrity supplement, not actor authorization or an Attendance writer.
-- A dedicated audited reconfirmation/correction protocol remains unimplemented;
-- generic inactive->active revival must fail closed until that protocol exists.
CREATE TRIGGER respite_marked_registration_update BEFORE UPDATE ON registration
WHEN OLD.source='respite_owner_v1' OR NEW.source='respite_owner_v1'
 OR (SELECT respite_review_required FROM event WHERE id=OLD.event_id)=1
 OR (SELECT respite_review_required FROM event WHERE id=NEW.event_id)=1
BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.caregiver_id IS NOT OLD.caregiver_id
  OR NEW.event_id IS NOT OLD.event_id OR NEW.source IS NOT OLD.source
  OR NEW.external_ref IS NOT OLD.external_ref OR NEW.created_at IS NOT OLD.created_at
  THEN RAISE(ABORT,'respite registration identity locked') END;
 SELECT CASE WHEN NEW.status IN ('registered','attended') AND OLD.status NOT IN ('registered','attended')
  THEN RAISE(ABORT,'dedicated respite reconfirmation required') END;
 SELECT CASE WHEN NEW.status IN ('registered','attended') AND NOT EXISTS(
  SELECT 1 FROM respite_request r WHERE r.registration_id=OLD.id
   AND r.id=NEW.external_ref AND NEW.source='respite_owner_v1'
   AND r.caregiver_id=NEW.caregiver_id AND r.event_id=NEW.event_id
   AND r.status='confirmed' AND r.needs_review=0
   AND r.reviewed_revision=r.revision AND r.removed_at IS NULL)
  THEN RAISE(ABORT,'reviewed linked respite request required') END;
END;
