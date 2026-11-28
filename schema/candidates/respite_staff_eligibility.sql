-- UNAPPLIED proposal, not a numbered migration or route authorization.
-- Staff actor MUST come from ct13's verified human Staff context, never a body.
-- Current Staff predicates below are integrity checks, not authentication.
CREATE TABLE respite_staff_eligibility (
 caregiver_id TEXT PRIMARY KEY NOT NULL REFERENCES caregiver(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TRIGGER respite_staff_eligibility_insert BEFORE INSERT ON respite_staff_eligibility BEGIN
 SELECT CASE WHEN NEW.revision!=1 THEN RAISE(ABORT,'initial revision required') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM caregiver WHERE id=NEW.caregiver_id AND status!='archived') THEN RAISE(ABORT,'owner unavailable') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM staff_member WHERE lower(email)=lower(NEW.updated_by) AND status='active' AND role IN ('staff','admin')) THEN RAISE(ABORT,'current Staff required') END;
END;
CREATE TRIGGER respite_staff_eligibility_update BEFORE UPDATE ON respite_staff_eligibility BEGIN
 SELECT CASE WHEN NEW.caregiver_id IS NOT OLD.caregiver_id THEN RAISE(ABORT,'owner identity locked') END;
 SELECT CASE WHEN NEW.revision!=OLD.revision+1 THEN RAISE(ABORT,'exact revision increment required') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM caregiver WHERE id=NEW.caregiver_id AND status!='archived') THEN RAISE(ABORT,'owner unavailable') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM staff_member WHERE lower(email)=lower(NEW.updated_by) AND status='active' AND role IN ('staff','admin')) THEN RAISE(ABORT,'current Staff required') END;
END;
-- Keep revocation history rather than deleting the grant row. The eventual
-- writer must CAS by expected revision and batch metadata-only audit atomically.
CREATE TRIGGER respite_staff_eligibility_delete BEFORE DELETE ON respite_staff_eligibility BEGIN
 SELECT RAISE(ABORT,'revoke through reviewed writer');
END;
