-- LP-01 candidate only. Apply once to a qualified isolated TEST after review.
-- Does not alter caregiver identity, contact consent or existing People0021.
CREATE TABLE caregiver_profile (
  caregiver_id TEXT PRIMARY KEY REFERENCES caregiver(id),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  fields_json TEXT NOT NULL CHECK (json_valid(fields_json) AND json_type(fields_json) = 'object'),
  restricted_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(restricted_json) AND json_type(restricted_json) = 'object'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
