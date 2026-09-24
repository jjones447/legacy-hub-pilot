-- Migration 0008: Governed agent data changes table (slice D7-S1)
-- Stores workflow data change drafts (grant, caregiver, event, form)
-- through draft -> preview -> human confirm -> publish -> audit.

CREATE TABLE IF NOT EXISTS agent_change (
  id            TEXT PRIMARY KEY,                     -- ac_<uuid>
  area          TEXT NOT NULL
                CHECK (area IN ('grant', 'caregiver', 'event', 'form')),
  operation     TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  before_json   TEXT,
  after_json    TEXT,
  status        TEXT NOT NULL
                CHECK (status IN ('draft', 'published', 'discarded', 'failed')),
  requested_by  TEXT NOT NULL,
  confirmed_by  TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_change_status ON agent_change(status);
CREATE INDEX IF NOT EXISTS idx_agent_change_area ON agent_change(area);
