# Event details and unpublish

Staff can create and edit plain-text descriptions and optional external HTTPS registration links. Events with an external link send visitors to the organizer; Hub registrations and counts remain available for events without that link. External capacity and attendance are not inferred from Hub counts. Unsafe links are refused and cannot silently fall back to Hub registration.

Unpublish changes a published event to draft. It hides the public listing while retaining event details, registrations and audit history. Staff can publish it again. Archive remains the existing separate operation. Both REST and governed event proposals use the same validator; assistant changes still require preview and confirmation.

## Installation

The release owner must apply `schema/0017_event_details.sql` once to each qualified target database **before** installing the new Functions bundle. It adds nullable `description` and `registration_url` columns without updating existing rows. Inspect the actual target, migration history and table columns first; source presence does not prove installation. Do not apply candidate migrations or change bindings, secrets, Access, reminders or schedules as part of this release.

After installation, verify draft creation with both fields, staff readback, editing and clearing them, publication and the public exact external link. Confirm unpublish removes the listing and leaves registrations/audit history intact, then republish. Exercise invalid-link refusal and the existing internal registration path with qualified synthetic fixtures. Use the real staff UI for approved public event content after the release has been reviewed and deployed. Source unit tests are not installed or browser acceptance.

## Rollback

Retain the prior deployment identifier and package. Roll back code to that qualified deployment if necessary; leave the two additive nullable columns in place. Old code ignores them. Do not drop columns, delete events or registrations, reset the database, or replay customer/provider actions to roll back. Record source, database/migration readback, deployment and browser results separately in the existing private acceptance record.

Engineering source and tests: [pc2-codex-42], October 25, 2026.
