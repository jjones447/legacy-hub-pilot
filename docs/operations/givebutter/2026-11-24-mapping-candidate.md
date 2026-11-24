# Givebutter mapping candidate — source only

Current webhook code compares `data.event_id || data.campaign_id` directly with a
published local event ID. Provider IDs and local IDs are separate namespaces, so a
valid ticket can fall through to an open gb_registration follow-up. The prior read-only
aggregate found 94 open registration fallbacks and43 donation follow-ups; this source
inspection does not prove the mapping cause for each historical record.

Candidate adds optional `GIVEBUTTER_EVENT_MAP_JSON`, with separate `event` and
`campaign` maps from exact provider IDs to existing local IDs. It applies only to
`ticket.created`. Both provider fields may agree; conflicting mappings fail503 before
contact/follow-up writes. Malformed configuration also fails503. The target still must
be a published local event. With no mapping configured, behavior is unchanged.

No actual mapping IDs have been configured or inferred. Configuration requires a
verified provider ticket/campaign-to-local-event correspondence and existing published
target. Mapped future tickets then create registrations using the existing atomic
write/audit and duplicate detection. Unknown/unpublished targets retain follow-up
handling so requests are not silently discarded. Historical follow-ups are untouched;
this does not replay, backfill, delete, or bulk-close them.

Donation handling is unchanged. A donation is not attendance, and mapping alone will
not eliminate the43 donation follow-ups. A separate explicit product decision is needed
on whether those notifications should remain actionable or use a non-queue ledger.
Do not suppress them or classify payments as registrations to make the queue look empty.

Validation:2376 full unit tests pass. Added SQLite handler tests prove mapped ticket
routing without fallback, sequential duplicate no-op, conflicting/malformed config
refusal before writes, unknown target fallback, and donation separation. Existing
signature, transaction, audit and failure tests remain in the suite. Native provider/D1
operation and mapping activation are not claimed. ZERO production DB/config mutations.
