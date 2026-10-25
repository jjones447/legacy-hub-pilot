-- Additive only: existing schedules, registrations and audit history are preserved.
ALTER TABLE event ADD COLUMN description TEXT;
ALTER TABLE event ADD COLUMN registration_url TEXT;
