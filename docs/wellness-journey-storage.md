# Wellness journey storage candidate

This additive source candidate preserves the existing 30-day wellness observations while
providing separate version, participation, quarter-assignment and response records. It is not
an applied migration or an enabled collection feature. No existing route imports it. Its SQL
lives in `schema/candidates/`, outside the non-recursive active migration catalog. Existing
bootstrap, restore and backup metadata therefore remain at their unchanged schema0012 contract.

## Data relationships

- `journey_questionnaire` holds immutable `(questionnaire_id, version)` snapshots. Question
  edits publish a new version; references retain the original wording and options.
- `journey_participation` appends staff selection and withdrawal events. Database sequence,
  not caller timestamps, determines current state. `previous_id` is an optimistic comparison
  against the current event: a stale staff action fails instead of overwriting newer intent.
- `journey_period` freezes one assignment per caregiver and calendar quarter, including its
  policy snapshot, current selection event and exact questionnaire version.
- `journey_response` references that exact owner/assignment/version combination for quarterly
  responses. Baseline observations are optional, separately dated and may be repeated; they
  never satisfy a quarterly assignment. One immutable response completes each assignment.

Withdrawal denies new quarterly submissions even after assignment. Existing responses and
assignments remain readable. Re-selection requires a new explicit staff event; it does not
rewrite previous selection evidence. An authenticated future producer can make baseline
repeatability more restrictive without changing these historical records.

## Write contract

The future staff producer must verify the active authenticated staff identity before using
`created_by`, `changed_by` or `assigned_by`; never accept these from the request body. Portal
writes must derive the caregiver from the signed session, enforce exact-origin CSRF and bounded
input, and validate questionnaire and answers with the versioned questionnaire producer.
Calendar assignments must be computed server-side using the period producer. Database JSON
checks enforce storage shape/identity only, not the full question, answer or timezone contract.
There is no consent, export, health-data collection or endpoint authorization in this schema.

New versions, selections and assignments require active staff. New selections, assignments and
responses require an active caregiver. Composite foreign keys bind responses to the assigned
owner and questionnaire version. Selection comparison, insert and audit trigger execute in the
same SQL statement. Audit failure aborts the insert; audit metadata excludes answers and wording.
Foreign keys must remain enabled, as on D1 by default. Do not add cascaded deletion.

Retries keep the same owner-scoped request ID and read the existing row before attempting a
new insert. The producer must compare canonical payload/version/assignment before treating a
row as acknowledged; the schema does not itself implement HTTP replay acknowledgement.
Never use `INSERT OR REPLACE` to recover an uncertain acknowledgement. Guards reject replacement,
updates and deletions, including SQLite replacement with recursive triggers disabled.

Trusted producers must omit sequence IDs from inserts. All three sequence tables require a
strictly positive persisted ID after automatic allocation; an explicitly supplied `-1` cannot
be recorded behind an existing selected event or add a misleading audit. The conservative
BEFORE INSERT ID fence rejects other caller-assigned IDs in the tested SQLite environment,
but SQLite documents an unspecified `NEW.rowid` before allocation as undefined. That fence
is not portable proof of caller omission or an authentication boundary. If another runtime
uses a different preallocation value it fails closed; ordinary D1 auto-ID availability remains
unverified until the separate rehearsal. Do not remove the positive stored-ID constraint or
relax sequence admission to accommodate a runtime without reviewing the ordering contract.

## Read consumers

`functions/_lib/wellness-journey-history.js` supplies read-only, parameter-bound candidate
queries. Owner history is newest sequence first, with original questionnaire and quarter-policy
snapshots. A baseline never becomes a quarterly response. Withdrawal preserves earlier history.
The staff selector uses the latest selection event and includes selected caregivers who have
never submitted a baseline or response; withdrawn and inactive caregivers are excluded.

Pages default to 25, cap at 50, and use exclusive sequence or caregiver-ID cursors. Reads omit
contacts, request keys, staff identities and audit records. JSON is capped at 64 KiB per field
and 256 KiB per page; invalid stored shapes fail closed with sanitized errors. Results are fresh
detached objects, not a mutable shared cache. Active staff status is checked by the participant
query, but authentication must occur in the future caller. Never accept an owner or staff identity
from an unverified body or query parameter. These helpers are not imported by any route and do
not grant staff access to owner history, enable export, collect answers or apply the schema.

History and selection pages are separate point-in-time reads, not a transactionally consistent
dashboard snapshot. Cursors do not authorize identities. Later integration must prove verified
staff/portal sessions, cross-user refusals, safe rendering of stored text, deployed bindings and
any read-replication consistency policy before enabling a consumer.

## Validation and rollout

Run `node --test tests/wellness-journey-history.test.mjs
tests/wellness-journey-storage.test.mjs tests/wellness-checkin.test.mjs
tests/wellness-reminders.test.mjs` as one command (without the line break). These tests use
synthetic in-memory Node SQLite only. Serial compare-and-append, cross-owner refusal and rollback
cases are not real D1 concurrency, workerd, deployed or authenticated endpoint acceptance.

Before promoting `schema/candidates/0013_wellness_journey.sql` into the active migration catalog,
independently review the exact source, verify the
installed schema sequence and rehearse it on a separately authorized isolated D1 binding. Then
integrate authenticated producers and history/dashboard consumers with cross-user, validation,
same-ID retry, real concurrency and failure tests. Promotion must update backup/restore migration
metadata and integration fixtures together; never report an unapplied candidate as installed.
Calendar, questionnaire and storage foundations are already source-integrated on main. This
read-consumer branch explicitly composes that reviewed main; its helper and tests retain their
original content. Composition does not enable any existing unused foundation or read consumer.

Disable producers to roll back. Preserve new and legacy rows, assignments, questionnaires and
audit history; do not drop tables, rewrite old observations or enable reminders during rollback.
Coming Soon and reminders remain disabled until the separate client go-ahead.

References: [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
and [SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/).
Sequence semantics: [SQLite automatic IDs](https://www.sqlite.org/autoinc.html) and
[BEFORE trigger cautions](https://www.sqlite.org/lang_createtrigger.html#cautions_on_the_use_of_before_triggers).

Authored by [pc2-codex-13].
