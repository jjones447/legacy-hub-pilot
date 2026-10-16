-- [pc2-codex-42] OPT-IN CANDIDATE. Apply ONLY as one reviewed transaction to isolated D7.
-- Extends one CHECK; preserves every old column/value and the identical active-index predicate.
-- Not an automatically discovered migration. Preflight exact0016 catalog/no unknown dependents.
CREATE TABLE assistant_web_job_v17 (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  input_digest TEXT NOT NULL, pointer_nonce TEXT NOT NULL, app_origin TEXT NOT NULL,
  frozen_json TEXT NOT NULL, state TEXT NOT NULL, dispatch_state TEXT NOT NULL, dispatch_ts TEXT,
  pointer_expires_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  claim_json TEXT, claim_slack_ts TEXT, lease_token TEXT, lease_expires_at INTEGER,
  result_digest TEXT, result_json TEXT, materialized_json TEXT,
  UNIQUE(actor,idempotency_key),
  CHECK(state IN ('pending','claimed','result','refused','materializing','materialized','hold','closed_unmaterialized')),
  CHECK(dispatch_state IN ('new','reserved','sent','hold'))
);
INSERT INTO assistant_web_job_v17 SELECT * FROM assistant_web_job;
DROP TABLE assistant_web_job;
ALTER TABLE assistant_web_job_v17 RENAME TO assistant_web_job;
CREATE UNIQUE INDEX assistant_web_job_one_active ON assistant_web_job(actor)
  WHERE state IN ('pending','claimed','result','materializing','hold');

CREATE TABLE assistant_web_job_disposition (
  job_id TEXT PRIMARY KEY NOT NULL REFERENCES assistant_web_job(id),
  operation_id TEXT NOT NULL UNIQUE, before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  before_digest TEXT NOT NULL, target_revision TEXT NOT NULL, audit_digest TEXT NOT NULL,
  evidence_digest TEXT NOT NULL, authority_digest TEXT NOT NULL, quiescence_digest TEXT NOT NULL,
  operator TEXT NOT NULL, closed_at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome='closed_unmaterialized'),
  delivery TEXT NOT NULL CHECK(delivery='unknown')
);
CREATE TRIGGER assistant_web_job_disposition_guard BEFORE INSERT ON assistant_web_job_disposition
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM assistant_web_job_disposition WHERE job_id=NEW.job_id OR operation_id=NEW.operation_id)
    THEN RAISE(ABORT,'web_job_close_conflict') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM assistant_web_job j WHERE j.id=NEW.job_id
    AND j.state='hold' AND j.dispatch_state='reserved' AND j.dispatch_ts IS NULL
    AND j.app_origin='https://legacy-hub-d7-acceptance.pages.dev'
    AND j.pointer_expires_at<=NEW.closed_at AND j.expires_at<=NEW.closed_at AND j.created_at<NEW.closed_at
    AND j.claim_json IS NULL AND j.claim_slack_ts IS NULL AND j.lease_token IS NULL AND j.lease_expires_at IS NULL
    AND j.result_digest IS NULL AND j.result_json IS NULL AND j.materialized_json IS NULL
    AND j.id IS json_extract(NEW.before_json,'$.id') AND j.actor IS json_extract(NEW.before_json,'$.actor')
    AND j.idempotency_key IS json_extract(NEW.before_json,'$.idempotency_key')
    AND j.input_digest IS json_extract(NEW.before_json,'$.input_digest') AND j.pointer_nonce IS json_extract(NEW.before_json,'$.pointer_nonce')
    AND j.app_origin IS json_extract(NEW.before_json,'$.app_origin') AND j.frozen_json IS json_extract(NEW.before_json,'$.frozen_json')
    AND j.state IS json_extract(NEW.before_json,'$.state') AND j.dispatch_state IS json_extract(NEW.before_json,'$.dispatch_state')
    AND j.dispatch_ts IS json_extract(NEW.before_json,'$.dispatch_ts')
    AND j.pointer_expires_at IS json_extract(NEW.before_json,'$.pointer_expires_at')
    AND j.expires_at IS json_extract(NEW.before_json,'$.expires_at') AND j.created_at IS json_extract(NEW.before_json,'$.created_at')
    AND NOT EXISTS(SELECT 1 FROM assistant_web_job_nonce WHERE nonce='materialize:'||j.id))
    THEN RAISE(ABORT,'web_job_close_refused') END;
END;
-- Inserting the separate disposition and changing ONLY state is ONE atomic SQL statement.
CREATE TRIGGER assistant_web_job_disposition_close AFTER INSERT ON assistant_web_job_disposition
BEGIN
  UPDATE assistant_web_job SET state='closed_unmaterialized' WHERE id=NEW.job_id AND state='hold';
  SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'web_job_close_refused') END;
END;
CREATE TRIGGER assistant_web_job_close_guard BEFORE UPDATE ON assistant_web_job
WHEN OLD.state='closed_unmaterialized' OR NEW.state='closed_unmaterialized'
BEGIN
  SELECT CASE WHEN OLD.state='closed_unmaterialized' OR OLD.state<>'hold'
    OR NOT EXISTS(SELECT 1 FROM assistant_web_job_disposition WHERE job_id=OLD.id)
    OR NOT (NEW.id IS OLD.id AND NEW.actor IS OLD.actor AND NEW.idempotency_key IS OLD.idempotency_key
      AND NEW.input_digest IS OLD.input_digest AND NEW.pointer_nonce IS OLD.pointer_nonce
      AND NEW.app_origin IS OLD.app_origin AND NEW.frozen_json IS OLD.frozen_json
      AND NEW.dispatch_state IS OLD.dispatch_state AND NEW.dispatch_ts IS OLD.dispatch_ts
      AND NEW.pointer_expires_at IS OLD.pointer_expires_at AND NEW.expires_at IS OLD.expires_at AND NEW.created_at IS OLD.created_at
      AND NEW.claim_json IS OLD.claim_json AND NEW.claim_slack_ts IS OLD.claim_slack_ts
      AND NEW.lease_token IS OLD.lease_token AND NEW.lease_expires_at IS OLD.lease_expires_at
      AND NEW.result_digest IS OLD.result_digest AND NEW.result_json IS OLD.result_json AND NEW.materialized_json IS OLD.materialized_json)
    THEN RAISE(ABORT,'web_job_closed_immutable') END;
END;
CREATE TRIGGER assistant_web_job_closed_no_delete BEFORE DELETE ON assistant_web_job
WHEN OLD.state='closed_unmaterialized' BEGIN SELECT RAISE(ABORT,'web_job_closed_immutable'); END;
CREATE TRIGGER assistant_web_job_closed_no_insert BEFORE INSERT ON assistant_web_job
WHEN NEW.state='closed_unmaterialized' OR EXISTS(SELECT 1 FROM assistant_web_job WHERE id=NEW.id AND state='closed_unmaterialized')
BEGIN SELECT RAISE(ABORT,'web_job_closed_immutable'); END;
CREATE TRIGGER assistant_web_job_disposition_no_update BEFORE UPDATE ON assistant_web_job_disposition
BEGIN SELECT RAISE(ABORT,'web_job_disposition_immutable'); END;
CREATE TRIGGER assistant_web_job_disposition_no_delete BEFORE DELETE ON assistant_web_job_disposition
BEGIN SELECT RAISE(ABORT,'web_job_disposition_immutable'); END;

-- Explicit operator attestation for a legacy browser session that lost job correlation.
-- This is NOT authority to close a job or blanket-clear other confirmation holds.
CREATE TABLE assistant_web_job_browser_reconciliation (
  session_id TEXT PRIMARY KEY NOT NULL, job_id TEXT NOT NULL REFERENCES assistant_web_job(id),
  actor TEXT NOT NULL, app_origin TEXT NOT NULL, operator TEXT NOT NULL,
  evidence_digest TEXT NOT NULL, authority_digest TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER assistant_web_job_browser_guard BEFORE INSERT ON assistant_web_job_browser_reconciliation
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM assistant_web_job_browser_reconciliation WHERE session_id=NEW.session_id)
    OR NOT EXISTS(SELECT 1 FROM assistant_web_job j JOIN assistant_web_job_disposition d ON d.job_id=j.id
      WHERE j.id=NEW.job_id AND j.actor=NEW.actor AND j.app_origin=NEW.app_origin
        AND j.state='closed_unmaterialized' AND d.outcome='closed_unmaterialized' AND d.delivery='unknown')
    THEN RAISE(ABORT,'web_job_browser_reconciliation_refused') END;
END;
CREATE TRIGGER assistant_web_job_browser_no_update BEFORE UPDATE ON assistant_web_job_browser_reconciliation
BEGIN SELECT RAISE(ABORT,'web_job_browser_reconciliation_immutable'); END;
CREATE TRIGGER assistant_web_job_browser_no_delete BEFORE DELETE ON assistant_web_job_browser_reconciliation
BEGIN SELECT RAISE(ABORT,'web_job_browser_reconciliation_immutable'); END;
