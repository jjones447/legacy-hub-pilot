-- D3: one provider reference cannot create both a registration and a followup.
-- Existing per-table UNIQUE(source, external_ref) constraints serialize retries
-- within one table. These guards close the cross-table concurrent-routing gap.
-- RAISE(ABORT) makes the existing transactional D1 batch roll back its caregiver,
-- result and audit writes together. The losing delivery gets a retryable 500;
-- after the winning transaction, the existing lookup returns duplicate/200.
-- No historical rows are updated/deleted, and nonpayment sources are unchanged.

CREATE TRIGGER IF NOT EXISTS registration_payment_ref_insert
BEFORE INSERT ON registration
WHEN NEW.source IN ('square', 'givebutter') AND NEW.external_ref IS NOT NULL
  AND EXISTS (SELECT 1 FROM followup
    WHERE source = NEW.source AND external_ref = NEW.external_ref)
BEGIN
  SELECT RAISE(ABORT, 'payment result reference already committed');
END;

CREATE TRIGGER IF NOT EXISTS followup_payment_ref_insert
BEFORE INSERT ON followup
WHEN NEW.source IN ('square', 'givebutter') AND NEW.external_ref IS NOT NULL
  AND EXISTS (SELECT 1 FROM registration
    WHERE source = NEW.source AND external_ref = NEW.external_ref)
BEGIN
  SELECT RAISE(ABORT, 'payment result reference already committed');
END;

CREATE TRIGGER IF NOT EXISTS registration_payment_ref_update
BEFORE UPDATE OF source, external_ref ON registration
WHEN NEW.source IN ('square', 'givebutter') AND NEW.external_ref IS NOT NULL
  AND EXISTS (SELECT 1 FROM followup
    WHERE source = NEW.source AND external_ref = NEW.external_ref)
BEGIN
  SELECT RAISE(ABORT, 'payment result reference already committed');
END;

CREATE TRIGGER IF NOT EXISTS followup_payment_ref_update
BEFORE UPDATE OF source, external_ref ON followup
WHEN NEW.source IN ('square', 'givebutter') AND NEW.external_ref IS NOT NULL
  AND EXISTS (SELECT 1 FROM registration
    WHERE source = NEW.source AND external_ref = NEW.external_ref)
BEGIN
  SELECT RAISE(ABORT, 'payment result reference already committed');
END;
