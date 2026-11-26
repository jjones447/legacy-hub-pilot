-- UNAPPLIED composition prerequisite. Requires reviewed caregiver_profile,
-- portal_support_request and respite_staff_eligibility schemas. Missing schema
-- fails INSERT closed. No client eligibility boolean is consumed.
CREATE TRIGGER respite_pending_eligibility_guard BEFORE INSERT ON respite_request BEGIN
 SELECT CASE WHEN NOT (
  EXISTS(SELECT 1 FROM caregiver_profile p WHERE p.caregiver_id=NEW.caregiver_id
   AND json_extract(p.fields_json,'$.respite_interest') IN ('Yes','Maybe'))
  OR EXISTS(SELECT 1 FROM caregiver_profile p,json_each(p.fields_json,'$.support_needs') n
   WHERE p.caregiver_id=NEW.caregiver_id AND json_type(p.fields_json,'$.support_needs')='array' AND n.type='text' AND n.value='Respite care')
  OR EXISTS(SELECT 1 FROM portal_support_request s,json_each(s.needs_json) n
   WHERE s.caregiver_id=NEW.caregiver_id AND json_type(s.needs_json)='array' AND n.type='text' AND n.value='break')
  OR EXISTS(SELECT 1 FROM respite_staff_eligibility g
   WHERE g.caregiver_id=NEW.caregiver_id AND g.enabled=1)
 ) THEN RAISE(ABORT,'respite eligibility unavailable') END;
END;
