-- 0019: email list subscribers (phase 1, issue #301).
-- The home page "Join our email list" form saves a subscriber here through POST /api/intake
-- (kind 'newsletter'). It never creates a caregiver record and never sends email: phase 1 only
-- collects consented addresses, lets a subscriber leave with their own link, and lets staff
-- see and export the list. Sending is a later phase.
--
-- email is stored normalized (trimmed, lower-cased) and is unique: one row per address.
-- consent_text is the exact consent line shown beside the form when the person joined.
-- unsubscribe_token is a random 128-bit hex value used only in that person's unsubscribe link;
-- it is never returned by any API response or written to the audit log.
-- (source, external_ref) is the same idempotency key every other intake table uses.

CREATE TABLE IF NOT EXISTS email_subscriber (
  id                TEXT PRIMARY KEY,                 -- sub_<uuid>
  email             TEXT NOT NULL UNIQUE,             -- normalized: trimmed, lower-cased
  first_name        TEXT,
  status            TEXT NOT NULL DEFAULT 'subscribed' CHECK (status IN ('subscribed', 'unsubscribed')),
  source            TEXT,
  external_ref      TEXT,
  consent_text      TEXT,
  unsubscribe_token TEXT NOT NULL UNIQUE,             -- 32 lowercase hex characters
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at   TEXT,
  UNIQUE (source, external_ref)
);

CREATE INDEX IF NOT EXISTS idx_email_subscriber_status ON email_subscriber (status, created_at);
