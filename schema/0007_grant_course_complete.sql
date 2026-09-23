-- Migration 0007: Add 'course_complete' status to grant_application
-- Rebuilds grant_application with widened CHECK constraint while preserving
-- foreign key integrity with the award table and caregiver references.

PRAGMA defer_foreign_keys = true;

CREATE TABLE grant_application_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id  TEXT NOT NULL REFERENCES caregiver(id),
  requested_for TEXT,
  status        TEXT NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted','in_review','awarded','course_complete','declined','closed')),
  review_notes  TEXT,
  source        TEXT NOT NULL,
  external_ref  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_ref)
);

INSERT INTO grant_application_new (id, caregiver_id, requested_for, status, review_notes, source, external_ref, created_at, updated_at)
SELECT id, caregiver_id, requested_for, status, review_notes, source, external_ref, created_at, updated_at
FROM grant_application;

CREATE TABLE award_temp (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_application_id  INTEGER NOT NULL,
  amount                TEXT,
  care_package          TEXT,
  outcome               TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

INSERT INTO award_temp (id, grant_application_id, amount, care_package, outcome, created_at, updated_at)
SELECT id, grant_application_id, amount, care_package, outcome, created_at, updated_at
FROM award;

DROP TABLE award;
DROP TABLE grant_application;

ALTER TABLE grant_application_new RENAME TO grant_application;

CREATE TABLE award (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_application_id  INTEGER NOT NULL REFERENCES grant_application(id),
  amount                TEXT,
  care_package          TEXT,
  outcome               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (grant_application_id)
);

INSERT INTO award (id, grant_application_id, amount, care_package, outcome, created_at, updated_at)
SELECT id, grant_application_id, amount, care_package, outcome, created_at, updated_at
FROM award_temp;

DROP TABLE award_temp;
