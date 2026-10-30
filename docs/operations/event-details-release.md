# Event details and unpublish

Staff can create and edit plain-text descriptions and optional external HTTPS registration links. Events with an external link send visitors to the organizer; Hub registrations and counts remain available for events without that link. External capacity and attendance are not inferred from Hub counts. Unsafe links are refused and cannot silently fall back to Hub registration.

Unpublish changes a published event to draft. It hides the public listing while retaining event details, registrations and audit history. Staff can publish it again. Archive remains the existing separate operation. Both REST and governed event proposals use the same validator; assistant changes still require preview and confirmation.

## Installation

The release owner must apply `schema/0017_event_details.sql` once to each qualified target database **before** installing the new Functions bundle. It adds nullable `description` and `registration_url` columns without updating existing rows. Inspect the actual target, migration history and table columns first; source presence does not prove installation. Do not apply candidate migrations or change bindings, secrets, Access, reminders or schedules as part of this release.

After installation, verify draft creation with both fields, staff readback, editing and clearing them, publication and the public exact external link. Confirm unpublish removes the listing and leaves registrations/audit history intact, then republish. Exercise invalid-link refusal and the existing internal registration path with qualified synthetic fixtures. Use the real staff UI for approved public event content after the release has been reviewed and deployed. Source unit tests are not installed or browser acceptance.

## Rollback

Retain the prior deployment identifier and package. Roll back code to that qualified deployment if necessary; leave the two additive nullable columns in place. Old code ignores them. Do not drop columns, delete events or registrations, reset the database, or replay customer/provider actions to roll back. Record source, database/migration readback, deployment and browser results separately in the existing private acceptance record.

Engineering source and tests: [pc2-codex-42], October 25, 2026.

## Registration confirmation email — October 30 source increment

Owner/integration: pc2-codex-41; implementation: pc2-codex-42. This extends the
existing `/api/intake` registration journey, transactional Resend sender,
`LEGACY_DB` registration/followup tables and append-only audit. No new service,
provider, secret, schema migration, scheduled job or reminder is introduced.
Progressive Engineering stage: deterministic application behavior on existing
proven intake/mail foundations; live delivery remains a separate acceptance step.

New ordinary Hub event registrations commit caregiver, registration, existing
confirmation staff task and original intake audit together. Only a successful
new registration can attempt email. The recipient and event facts come from
persisted records, not duplicate request text. The message includes title,
start/end time in America/Chicago, stored location, registered status, and
canonical event/portal URLs. It does not claim payment, attendance or mailbox
delivery. External organizer registration and existing provider receipts are
unchanged. Support-group sign-ups are a separate intake path; this increment
does not yet send their session/Meet confirmation.

### Delivery, duplicates and failures

Before any provider call, one atomic insert-if-absent audit records
`confirmation.claimed` for the persisted registration ID. Its key is
`legacy-registration-<environment>-<registration-id>`. The existing sender gets
that same `Idempotency-Key` and a ten-second abort bound. The durable application
claim, rather than the provider's 24-hour idempotency window, prevents a later
automatic duplicate. Claim/audit rows are never cleared or relabeled to retry.

Outcome audits are `confirmation.accepted`, `.rejected`, `.unknown` or `.skipped`;
they contain only the stable key and safe HTTP status, never recipient address,
message text or credentials. The existing staff followup describes the outcome
and stays open until staff resolves it. Provider acceptance is not recipient
delivery. A lost/ambiguous provider response or outcome-store failure leaves the
claim for reconciliation. A mail failure still returns successful registration.
The endpoint adds `confirmation_email: submitted | needs_review | not_sent`.
The public result must distinguish registration success from email submission;
the companion UI change is coordinated with the active shared `app.js` owner.

Public duplicate submissions read the existing outcome and never send. Old
registrations are never backfilled. If a process dies between committing a
registration and attempting mail, its original staff task remains the recovery
path; a duplicate form submission does not repair it by sending automatically.
Concurrent requests use the same durable claim; no in-memory/global send lock.

### Safe staff recovery in the existing queue

1. Open the original event-confirmation task in Staff follow-ups. Registration
   remains saved. Do not submit another registration or clear a claim.
2. The existing mail custodian reconciles the stable key, recipient and time in
   the existing provider account. Accepted, pending or unknown delivery must not
   be treated as safe to resend. A missing local success audit is not proof that
   the provider did not accept the message.
3. For a proven rejection or proven pre-send failure, correct the specific cause
   using existing custody. Any manual one-recipient recovery requires the
   original authorized request, definitive no-send/nonacceptance evidence and
   a recorded provider outcome; this code has no bulk/backfill/resend endpoint.
   If the outcome cannot be resolved, retain the task for the custodian instead
   of guessing. Resolve/dismiss only the existing task with the normal staff
   workflow after its actual disposition; preserve registration and audit history.

### Staging and release limits

Existing production uses `EMAIL_API_KEY` with absent `ENVIRONMENT` (or explicit
`production`). Preview requires its existing explicit mail opt-in **and** a
comma-separated exact `CONFIRMATION_PREVIEW_RECIPIENTS` allowlist of approved
test mailboxes. No wildcard or arbitrary caregiver preview recipient is allowed.
An empty list refuses confirmation mail while preserving intake. Development
and unknown environment labels cannot send. Portal sign-in policy is unchanged.
Configuration values and approved recipient identities belong in existing
private custody; do not add them to this public runbook or the repository.

Source tests use in-memory SQLite and mocked provider calls, including claim
acknowledgment loss, concurrent duplicates, outcome persistence failure,
registration rollback, policy refusal and unchanged portal-mail behavior.
They are not a real email receipt or deployment. The existing release owner must
coordinate the shared staging bundle and UI result text, qualify the approved
test recipient/policy and verify one authorized registration plus actual mailbox
receipt. No artificial production signup, backfill or unsolicited test send is
authorized by this document. Requester approval of the specific staging result
precedes production; installed source, receipt and user access are separate.
Rollback restores the prior qualified code package without deleting claims,
registrations, staff tasks or audits. Restoring code never authorizes resend.

Primary references: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
and [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/).
