-- Explicit candidate/opt-in migration; excluded from the active backup/schema catalog.
-- Never apply to shared/customer databases implicitly.
-- Pending intent/transport state is NOT the application's append-only audit.
CREATE TABLE IF NOT EXISTS assistant_handoff (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE,
  intent_hash TEXT NOT NULL,
  workspace TEXT NOT NULL,
  channel TEXT NOT NULL,
  thread TEXT NOT NULL,
  slack_user TEXT NOT NULL,
  area TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_text TEXT NOT NULL,
  app_origin TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','challenged','paired','drafting','drafted','confirming','discarding','hold','published','discarded','refused')),
  expires_at INTEGER NOT NULL,
  actor TEXT,
  challenge_hash TEXT,
  challenge_expires INTEGER,
  verification_event TEXT UNIQUE,
  draft_id TEXT,
  preview_version TEXT,
  preview_json TEXT,
  target_json TEXT,
  audit_floor INTEGER,
  attempted_action TEXT,
  audit_ids TEXT,
  created_at INTEGER NOT NULL
);
