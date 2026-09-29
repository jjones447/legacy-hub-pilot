-- 0011: staff records (Jacob direct 2026-09-29).
-- Cloudflare Access decides who may sign in (any @legacyhomehealthservices.org address plus named
-- addresses). This table records who actually did: a row is created on a person's first verified
-- sign-in (functions/_lib/staff.js), and an admin can set their name and role or deactivate them
-- from the staff console. A deactivated person is refused even while Access still admits them.

CREATE TABLE IF NOT EXISTS staff_member (
  email         TEXT PRIMARY KEY,                     -- lower-cased Access identity
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  first_seen_at TEXT,
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The people already on the Access allow-list start as admins, so someone can manage the team on day one.
INSERT OR IGNORE INTO staff_member (email, display_name, role) VALUES
  ('info@legacyhomehealthservices.org', 'Shanelle Snowden', 'admin'),
  ('jacob.jones@empyreanconsulting.com', 'Jacob Jones', 'admin'),
  ('jacob.jones447@gmail.com', 'Jacob Jones', 'admin');
