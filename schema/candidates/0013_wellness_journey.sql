-- LP04 additive candidate, deliberately outside the active schema/*.sql migration catalog.
-- SOURCE ONLY: do not promote/apply until independent review and D1 acceptance.
-- Extends 0001/0011 without rewriting legacy 0012 observations or selecting anyone automatically.
-- Caller must authenticate staff/signed caregiver, validate snapshots/answers with the journey
-- producers, and derive calendar periods server-side. SQL is not an authentication boundary.
-- Defaults: optional repeatable baseline observations; one response per assigned quarter;
-- withdrawal blocks new quarterly responses, preserves history, and re-selection is explicit.
-- Rollback stops producers; never drop these tables or delete responses/audits.

CREATE TABLE IF NOT EXISTS journey_questionnaire (
  questionnaire_id TEXT NOT NULL CHECK (length(questionnaire_id) BETWEEN 1 AND 80),
  version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version > 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  created_by TEXT NOT NULL REFERENCES staff_member(email),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (questionnaire_id, version),
  CHECK (json_extract(snapshot_json, '$.id') IS questionnaire_id),
  CHECK (json_type(snapshot_json, '$.version') = 'integer'
         AND json_extract(snapshot_json, '$.version') IS version)
);

CREATE TABLE IF NOT EXISTS journey_participation (
  id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id > 0),
  caregiver_id TEXT NOT NULL REFERENCES caregiver(id),
  state TEXT NOT NULL CHECK (state IN ('selected', 'withdrawn')),
  previous_id INTEGER REFERENCES journey_participation(id),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  changed_by TEXT NOT NULL REFERENCES staff_member(email),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (caregiver_id, request_id),
  UNIQUE (id, caregiver_id)
);
CREATE INDEX IF NOT EXISTS journey_participation_owner ON journey_participation(caregiver_id, id DESC);

CREATE TABLE IF NOT EXISTS journey_period (
  id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id > 0),
  caregiver_id TEXT NOT NULL REFERENCES caregiver(id),
  period_id TEXT NOT NULL CHECK (period_id GLOB '[0-9][0-9][0-9][0-9]-Q[1-4]'
                                AND substr(period_id, 1, 4) BETWEEN '0001' AND '9998'),
  policy_json TEXT NOT NULL CHECK (json_valid(policy_json) AND json_type(policy_json) = 'object'),
  participation_id INTEGER NOT NULL,
  questionnaire_id TEXT NOT NULL,
  questionnaire_version INTEGER NOT NULL,
  assigned_by TEXT NOT NULL REFERENCES staff_member(email),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (caregiver_id, period_id),
  UNIQUE (id, caregiver_id, questionnaire_id, questionnaire_version),
  FOREIGN KEY (participation_id, caregiver_id) REFERENCES journey_participation(id, caregiver_id),
  FOREIGN KEY (questionnaire_id, questionnaire_version) REFERENCES journey_questionnaire(questionnaire_id, version)
);

CREATE TABLE IF NOT EXISTS journey_response (
  id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id > 0),
  caregiver_id TEXT NOT NULL REFERENCES caregiver(id),
  kind TEXT NOT NULL CHECK (kind IN ('baseline', 'quarterly')),
  period_assignment_id INTEGER,
  questionnaire_id TEXT NOT NULL,
  questionnaire_version INTEGER NOT NULL,
  answers_json TEXT NOT NULL CHECK (json_valid(answers_json) AND json_type(answers_json) = 'object'),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'baseline' AND period_assignment_id IS NULL)
         OR (kind = 'quarterly' AND period_assignment_id IS NOT NULL)),
  UNIQUE (caregiver_id, request_id),
  UNIQUE (period_assignment_id),
  FOREIGN KEY (questionnaire_id, questionnaire_version) REFERENCES journey_questionnaire(questionnaire_id, version),
  FOREIGN KEY (period_assignment_id, caregiver_id, questionnaire_id, questionnaire_version)
    REFERENCES journey_period(id, caregiver_id, questionnaire_id, questionnaire_version)
);
CREATE INDEX IF NOT EXISTS journey_response_history ON journey_response(caregiver_id, id DESC);

-- BEFORE INSERT guards also reject INSERT OR REPLACE, including when recursive triggers are off.
-- Same-key retries must read/compare the existing canonical record, not attempt replacement.
-- Trusted producers MUST omit IDs. NEW.rowid before automatic allocation is undefined in
-- SQLite's documented contract: the conservative -1 fence below is NOT proof of omission.
-- CHECK(id > 0) validates the persisted ID after allocation, closing explicit -1 admission
-- without relying on that sentinel for ordering safety. A different runtime sentinel fails
-- closed at the BEFORE fence; D1 auto-ID availability must be rehearsed before promotion.
CREATE TRIGGER IF NOT EXISTS journey_questionnaire_insert_guard BEFORE INSERT ON journey_questionnaire
BEGIN
  SELECT RAISE(ABORT, 'questionnaire version already exists') WHERE EXISTS (
    SELECT 1 FROM journey_questionnaire WHERE questionnaire_id = NEW.questionnaire_id AND version = NEW.version);
  SELECT RAISE(ABORT, 'active staff required') WHERE NOT EXISTS (
    SELECT 1 FROM staff_member WHERE email = NEW.created_by AND status = 'active');
END;
CREATE TRIGGER IF NOT EXISTS journey_participation_insert_guard BEFORE INSERT ON journey_participation
BEGIN
  SELECT RAISE(ABORT, 'participation already exists') WHERE EXISTS (
    SELECT 1 FROM journey_participation WHERE id = NEW.id
      OR (caregiver_id = NEW.caregiver_id AND request_id = NEW.request_id));
  SELECT RAISE(ABORT, 'database assigned sequence required') WHERE NEW.id != -1;
  SELECT RAISE(ABORT, 'active staff required') WHERE NOT EXISTS (
    SELECT 1 FROM staff_member WHERE email = NEW.changed_by AND status = 'active');
  SELECT RAISE(ABORT, 'active caregiver required') WHERE NOT EXISTS (
    SELECT 1 FROM caregiver WHERE id = NEW.caregiver_id AND status = 'active');
  SELECT RAISE(ABORT, 'stale participation') WHERE NEW.previous_id IS NOT (
    SELECT max(id) FROM journey_participation WHERE caregiver_id = NEW.caregiver_id);
  SELECT RAISE(ABORT, 'selection required before withdrawal') WHERE NEW.state = 'withdrawn' AND NOT EXISTS (
    SELECT 1 FROM journey_participation WHERE id = NEW.previous_id AND state = 'selected');
END;
CREATE TRIGGER IF NOT EXISTS journey_period_insert_guard BEFORE INSERT ON journey_period
BEGIN
  SELECT RAISE(ABORT, 'period already exists') WHERE EXISTS (
    SELECT 1 FROM journey_period WHERE id = NEW.id
      OR (caregiver_id = NEW.caregiver_id AND period_id = NEW.period_id));
  SELECT RAISE(ABORT, 'database assigned sequence required') WHERE NEW.id != -1;
  SELECT RAISE(ABORT, 'active staff required') WHERE NOT EXISTS (
    SELECT 1 FROM staff_member WHERE email = NEW.assigned_by AND status = 'active');
  SELECT RAISE(ABORT, 'active caregiver required') WHERE NOT EXISTS (
    SELECT 1 FROM caregiver WHERE id = NEW.caregiver_id AND status = 'active');
  SELECT RAISE(ABORT, 'current selection required') WHERE NOT EXISTS (
    SELECT 1 FROM journey_participation WHERE id = NEW.participation_id AND caregiver_id = NEW.caregiver_id
      AND state = 'selected' AND id = (SELECT max(id) FROM journey_participation WHERE caregiver_id = NEW.caregiver_id));
END;
CREATE TRIGGER IF NOT EXISTS journey_response_insert_guard BEFORE INSERT ON journey_response
BEGIN
  SELECT RAISE(ABORT, 'response already exists') WHERE EXISTS (
    SELECT 1 FROM journey_response WHERE id = NEW.id
      OR (caregiver_id = NEW.caregiver_id AND request_id = NEW.request_id)
      OR (NEW.period_assignment_id IS NOT NULL AND period_assignment_id = NEW.period_assignment_id));
  SELECT RAISE(ABORT, 'database assigned sequence required') WHERE NEW.id != -1;
  SELECT RAISE(ABORT, 'active caregiver required') WHERE NOT EXISTS (
    SELECT 1 FROM caregiver WHERE id = NEW.caregiver_id AND status = 'active');
  SELECT RAISE(ABORT, 'current selection required') WHERE NEW.kind = 'quarterly' AND NOT EXISTS (
    SELECT 1 FROM journey_participation WHERE caregiver_id = NEW.caregiver_id AND state = 'selected'
      AND id = (SELECT max(id) FROM journey_participation WHERE caregiver_id = NEW.caregiver_id));
END;

-- Trigger audit writes are part of the inserting statement: audit failure rolls back the record.
-- Only identifiers/version/state go into audit, never answers or questionnaire wording.
CREATE TRIGGER IF NOT EXISTS journey_questionnaire_audit AFTER INSERT ON journey_questionnaire
BEGIN
  INSERT INTO audit_log(actor, action, entity, entity_id, after_json)
  VALUES (NEW.created_by, 'journey.questionnaire', 'journey_questionnaire', NEW.questionnaire_id,
          json_object('questionnaire_id', NEW.questionnaire_id, 'version', NEW.version));
END;
CREATE TRIGGER IF NOT EXISTS journey_participation_audit AFTER INSERT ON journey_participation
BEGIN
  INSERT INTO audit_log(actor, action, entity, entity_id, after_json)
  VALUES (NEW.changed_by, 'journey.participation', 'journey_participation', CAST(NEW.id AS TEXT),
          json_object('caregiver_id', NEW.caregiver_id, 'state', NEW.state, 'previous_id', NEW.previous_id));
END;
CREATE TRIGGER IF NOT EXISTS journey_period_audit AFTER INSERT ON journey_period
BEGIN
  INSERT INTO audit_log(actor, action, entity, entity_id, after_json)
  VALUES (NEW.assigned_by, 'journey.period', 'journey_period', CAST(NEW.id AS TEXT),
          json_object('caregiver_id', NEW.caregiver_id, 'period_id', NEW.period_id,
                      'questionnaire_id', NEW.questionnaire_id, 'version', NEW.questionnaire_version));
END;
CREATE TRIGGER IF NOT EXISTS journey_response_audit AFTER INSERT ON journey_response
BEGIN
  INSERT INTO audit_log(actor, action, entity, entity_id, after_json)
  VALUES ('portal:' || NEW.caregiver_id, 'journey.response', 'journey_response', CAST(NEW.id AS TEXT),
          json_object('caregiver_id', NEW.caregiver_id, 'kind', NEW.kind,
                      'period_assignment_id', NEW.period_assignment_id,
                      'questionnaire_id', NEW.questionnaire_id, 'version', NEW.questionnaire_version));
END;

CREATE TRIGGER IF NOT EXISTS journey_questionnaire_no_update BEFORE UPDATE ON journey_questionnaire
BEGIN SELECT RAISE(ABORT, 'journey questionnaire is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journey_questionnaire_no_delete BEFORE DELETE ON journey_questionnaire
BEGIN SELECT RAISE(ABORT, 'journey questionnaire is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journey_participation_no_update BEFORE UPDATE ON journey_participation
BEGIN SELECT RAISE(ABORT, 'journey participation is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journey_participation_no_delete BEFORE DELETE ON journey_participation
BEGIN SELECT RAISE(ABORT, 'journey participation is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journey_period_no_update BEFORE UPDATE ON journey_period
BEGIN SELECT RAISE(ABORT, 'journey period is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journey_period_no_delete BEFORE DELETE ON journey_period
BEGIN SELECT RAISE(ABORT, 'journey period is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journey_response_no_update BEFORE UPDATE ON journey_response
BEGIN SELECT RAISE(ABORT, 'journey response is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journey_response_no_delete BEFORE DELETE ON journey_response
BEGIN SELECT RAISE(ABORT, 'journey response is append-only'); END;
