-- People search (requester, Nov 12 2026, ts 1794499835.090709): staff mark whether a person
-- who signed up for something is a caregiver. Additive candidate, deliberately outside the
-- active schema/*.sql catalog; TEST apply follows normal review/publisher authority.
-- Production follows the separately customer-approved feature release (Nov20 ruling).
-- NULL = not yet identified (every existing row); no existing value changes.
-- Rollback: stop sending is_caregiver; never drop the column or rewrite values.

ALTER TABLE caregiver ADD COLUMN is_caregiver TEXT
  CHECK (is_caregiver IS NULL OR is_caregiver IN ('yes', 'no'));
