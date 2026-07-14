-- Add portal_token table for magic-link auth
CREATE TABLE IF NOT EXISTS portal_token (
  token_hash   TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL REFERENCES caregiver(id),
  expires_at   TEXT NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
