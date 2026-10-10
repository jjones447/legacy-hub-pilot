# Square completed payment identity

The Square handler authenticates the raw request body with the configured
notification URL and subscription signature key. Do not substitute the incoming
request URL or reserialized JSON. Configuration and genuine transaction evidence
must be verified by the existing operator, without publishing any secret values.

Square emits `payment.updated` for completion and later changes, including fee
information. New completed-payment records use `payment:<payment.id>` as their
Square external reference, so different updates of the same payment do not create
another donation, unmatched-payment follow-up or registration. The original
delivery event ID and payment ID remain in the original append-only audit entry.
Distinct payments remain distinct. Non-completed updates remain ignored.

The legacy adapter event `payment.completed` is not proof of completion when its
payload explicitly reports another status. It now acknowledges explicit
non-`COMPLETED` statuses with HTTP200 `{ "ok": true, "ignored": true }` before
database access. This includes FAILED, CANCELED, APPROVED, PENDING, null, empty
or non-string status values. Its nested payment status takes precedence when
present; only an absent nested status falls back to the outer object status.
Legacy adapters with status truly absent retain their existing completion path;
that compatibility allowance is not genuine Square-generated payment evidence.

The genuine `payment.updated` event retains its existing strict `COMPLETED`
requirement and truthy nested-to-outer status fallback. Signature authentication
and delivery-ID validation still precede status handling; ignored noncompletion
does not need a payment ID, while accepted completion still requires one.
No payment identity, duplicate, transaction/audit, subscription or credential
behavior changes. Synthetic regression results are not installed/provider proof.

No schema migration or historical row/audit rewrite is included. The handler also
checks the incoming event ID against legacy event-keyed rows, preserving exact
same-event retries. Legacy matched-payment rows generally lack a payment ID, so
later *different* events for payments recorded before this change cannot reliably
be deduplicated retrospectively. Existing-operator cutover must identify that
boundary; do not replay historic deliveries or infer historical reconciliation.

New caregiver (or unmatched sentinel) mutations, the result insert and its original
audit now execute in one D1 batch transaction. The audit entity ID is selected by
the result's bound Square source, payment reference and caregiver ID inside that
batch, not a separate `last_insert_rowid()` call. A final batched SELECT returns
the exact result ID; malformed/unsuccessful batch responses produce a generic 500.
An audit statement failure rolls back the new mutation set, permitting a healthy
same-payment retry to create one result and its original audit. Result inserts
remain plain INSERTs; no result is ignored and no historical audit is backfilled.

Synthetic SQLite regressions exercise all three branches, new and existing
caregivers, timestamp rollback, correct audit linkage and sequential retries.
These mocks model the documented batch transaction contract, not native D1/workerd
or installed acceptance. Pre-batch identity/mapping reads and cross-table routing
remain outside this transaction; concurrent delivery acceptance still needs bounded
real-runtime evidence. Historical partial rows remain unchanged and their existing
duplicate behavior is preserved. No provider API lookup, new health/contact
collection, configuration change or customer write is implied by this source work.

Sources:

- [Square payment webhook behavior](https://developer.squareup.com/docs/payments-api/webhooks)
- [Square signature validation](https://developer.squareup.com/docs/webhooks/step3validate)
- [Square payment.updated payload](https://developer.squareup.com/reference/square/payments-api/webhooks/payment.updated)
- [Cloudflare D1 batch transaction contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

Prepared by [pc2-codex-13].
