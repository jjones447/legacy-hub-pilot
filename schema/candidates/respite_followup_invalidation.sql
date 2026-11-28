-- UNAPPLIED supplement. Old owner writer already clears these fields; enforce
-- the same invariant for any future writer that changes material session needs.
CREATE TRIGGER respite_material_change_followup BEFORE UPDATE ON respite_request
WHEN (NEW.details_json IS NOT OLD.details_json OR NEW.participant_revision IS NOT OLD.participant_revision
 OR NEW.first_time IS NOT OLD.first_time OR NEW.participant_id IS NOT OLD.participant_id)
 AND (NEW.followup_by IS NOT NULL OR NEW.followup_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'changed needs require fresh followup'); END;
