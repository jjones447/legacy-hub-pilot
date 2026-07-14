-- Add the missing award table
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

-- Seed fictional caregiver and grant application for testing
INSERT OR IGNORE INTO caregiver (id, first_name, last_name, email, phone, caring_for, relationship, source)
VALUES (
  'cg_seed_fictional',
  'Jane',
  'Doe',
  'jane.doe@example.com',
  '555-123-4567',
  'Mother with dementia',
  'daughter',
  'seed'
);

INSERT OR IGNORE INTO grant_application (id, caregiver_id, requested_for, status, source, external_ref)
VALUES (
  1001,
  'cg_seed_fictional',
  'Day respite care',
  'submitted',
  'seed',
  'ref_seed_0001'
);
