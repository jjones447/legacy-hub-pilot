-- Legacy Caregiver Hub — D1 schema v0 (slice 03)
-- Rules (docs/architecture/data-model.md): soft-delete via status (no DELETE);
-- audit_log append-only (trigger-enforced); intake idempotent on (source, external_ref).

CREATE TABLE IF NOT EXISTS caregiver (
  id                TEXT PRIMARY KEY,                 -- cg_<uuid>
  first_name        TEXT NOT NULL,
  last_name         TEXT,
  email             TEXT,
  phone             TEXT,
  preferred_contact TEXT NOT NULL DEFAULT 'email',
  sanctuary_member  INTEGER NOT NULL DEFAULT 0,
  member_since      TEXT,
  source            TEXT NOT NULL DEFAULT 'site_form',
  caring_for        TEXT,                             -- short free text, no clinical detail
  relationship      TEXT,
  segment_tags      TEXT NOT NULL DEFAULT '[]',       -- JSON array
  volunteer         INTEGER NOT NULL DEFAULT 0,
  donor             INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive','archived')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS caregiver_email_uq
  ON caregiver(email) WHERE email IS NOT NULL AND status != 'archived';

CREATE TABLE IF NOT EXISTS event (
  id            TEXT PRIMARY KEY,                     -- ev_<slug>
  title         TEXT NOT NULL,
  type          TEXT NOT NULL
                CHECK (type IN ('support_group','memory_social','caregiver_event','wellness','other')),
  starts_at     TEXT NOT NULL,
  ends_at       TEXT,
  location      TEXT,
  capacity      INTEGER,                              -- NULL = uncapped
  recurring     INTEGER NOT NULL DEFAULT 0,
  publish_state TEXT NOT NULL DEFAULT 'draft'
                CHECK (publish_state IN ('draft','published','archived')),  -- archived = soft delete
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS registration (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id  TEXT NOT NULL REFERENCES caregiver(id),
  event_id      TEXT NOT NULL REFERENCES event(id),
  status        TEXT NOT NULL DEFAULT 'registered'
                CHECK (status IN ('registered','attended','no_show','cancelled')),
  source        TEXT NOT NULL,                        -- site_form / staff / agent
  external_ref  TEXT,                                 -- client UUID (idempotency)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_ref)
);

CREATE TABLE IF NOT EXISTS grant_application (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id  TEXT NOT NULL REFERENCES caregiver(id),
  requested_for TEXT,
  status        TEXT NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted','in_review','awarded','declined','closed')),
  review_notes  TEXT,
  source        TEXT NOT NULL,
  external_ref  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_ref)
);

CREATE TABLE IF NOT EXISTS followup (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id  TEXT NOT NULL REFERENCES caregiver(id),
  kind          TEXT NOT NULL,                        -- support_request / membership_welcome / event_confirmation / ...
  detail        TEXT,
  due           TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','done','dismissed')),
  source        TEXT,
  external_ref  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_ref)
);

CREATE TABLE IF NOT EXISTS note (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id  TEXT NOT NULL REFERENCES caregiver(id),
  author        TEXT NOT NULL,
  body          TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'staff',
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','archived')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_type (
  id            TEXT PRIMARY KEY,                     -- resource / page_section / announcement / event_copy / settings
  json_schema   TEXT NOT NULL                         -- JSON Schema the agent validates against
);

CREATE TABLE IF NOT EXISTS content_item (
  id            TEXT PRIMARY KEY,
  type_id       TEXT NOT NULL REFERENCES content_type(id),
  data          TEXT NOT NULL,                        -- JSON, valid per content_type.json_schema
  status        TEXT NOT NULL DEFAULT 'published'
                CHECK (status IN ('draft','published','archived')),
  updated_by    TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor         TEXT NOT NULL,                        -- staff id / agent / site_form / webhook
  action        TEXT NOT NULL,                        -- e.g. intake.support_request
  entity        TEXT NOT NULL,
  entity_id     TEXT,
  before_json   TEXT,
  after_json    TEXT,
  at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- audit_log is append-only: block UPDATE and DELETE at the engine.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
  BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
  BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
