-- 0012: caregiver well-being check-ins (client request 2026-09-29).
-- A caregiver answers a short check-in from the portal: first after joining, then on a schedule
-- (default monthly). They see their own trend on a "My Wellness" tile; staff see a chart per
-- caregiver. Answers are personal data: portal reads are scoped to the signed-in caregiver.

CREATE TABLE IF NOT EXISTS wellness_checkin (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id  TEXT NOT NULL REFERENCES caregiver(id),
  answers_json  TEXT NOT NULL,                        -- {"stress":1-5,"sleep":1-5,"support":1-5,"self_time":1-5}
  score         INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),  -- 100 = doing well
  note          TEXT,                                 -- optional free text from the caregiver
  source        TEXT NOT NULL DEFAULT 'portal',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wellness_checkin_caregiver ON wellness_checkin (caregiver_id, created_at);
