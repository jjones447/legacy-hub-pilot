-- Isolated Support browser qualification only. Source is the first statement
-- in 0003_grant_award.sql and the seed-free 0012_wellness_checkin.sql.
CREATE TABLE IF NOT EXISTS award (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_application_id  INTEGER NOT NULL REFERENCES grant_application(id),
  amount                TEXT,
  care_package          TEXT,
  outcome               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (grant_application_id)
);

CREATE TABLE IF NOT EXISTS wellness_checkin (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id  TEXT NOT NULL REFERENCES caregiver(id),
  answers_json  TEXT NOT NULL,
  score         INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  note          TEXT,
  source        TEXT NOT NULL DEFAULT 'portal',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wellness_checkin_caregiver ON wellness_checkin (caregiver_id, created_at);
