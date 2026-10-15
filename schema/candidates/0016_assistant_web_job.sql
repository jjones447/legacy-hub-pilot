-- [pc2-codex-42] OPT-IN CANDIDATE ONLY. NOT part of active schema catalog; never executed by handlers.
CREATE TABLE assistant_web_job (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  input_digest TEXT NOT NULL, pointer_nonce TEXT NOT NULL, app_origin TEXT NOT NULL,
  frozen_json TEXT NOT NULL, state TEXT NOT NULL, dispatch_state TEXT NOT NULL, dispatch_ts TEXT,
  pointer_expires_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  claim_json TEXT, claim_slack_ts TEXT, lease_token TEXT, lease_expires_at INTEGER,
  result_digest TEXT, result_json TEXT, materialized_json TEXT,
  UNIQUE(actor,idempotency_key),
  CHECK(state IN ('pending','claimed','result','refused','materializing','materialized','hold')),
  CHECK(dispatch_state IN ('new','reserved','sent','hold'))
);
-- At most one outstanding job per staff member, including unresolved HOLD after crash/uncertain effects.
CREATE UNIQUE INDEX assistant_web_job_one_active ON assistant_web_job(actor)
  WHERE state IN ('pending','claimed','result','materializing','hold');
CREATE TABLE assistant_web_job_nonce (nonce TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
