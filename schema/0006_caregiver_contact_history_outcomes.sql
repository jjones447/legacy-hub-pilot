-- Migration 0006: Caregiver contact history and outcome tracking (slice D2)
-- Additive only: adds contact_history table and outcome fields to caregiver.

CREATE TABLE IF NOT EXISTS contact_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id  TEXT NOT NULL REFERENCES caregiver(id),
  occurred_at   TEXT NOT NULL,
  channel       TEXT NOT NULL
                CHECK (channel IN ('phone', 'email', 'in_person', 'event', 'other')),
  direction     TEXT NOT NULL
                CHECK (direction IN ('inbound', 'outbound')),
  summary       TEXT NOT NULL,
  recorded_by   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contact_history_caregiver_occurred
  ON contact_history(caregiver_id, occurred_at);

-- Outcome fields on caregiver (additive, basic outcome tracking, zero PHI)
ALTER TABLE caregiver ADD COLUMN outcome_status TEXT
  CHECK (outcome_status IN ('improving', 'stable', 'needs_support', 'disengaged'));
ALTER TABLE caregiver ADD COLUMN outcome_notes TEXT;
ALTER TABLE caregiver ADD COLUMN outcome_updated_at TEXT;
