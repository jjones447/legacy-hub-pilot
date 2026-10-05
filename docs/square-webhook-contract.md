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

No schema migration or historical row/audit rewrite is included. The handler also
checks the incoming event ID against legacy event-keyed rows, preserving exact
same-event retries. Legacy matched-payment rows generally lack a payment ID, so
later *different* events for payments recorded before this change cannot reliably
be deduplicated retrospectively. Existing-operator cutover must identify that
boundary; do not replay historic deliveries or infer historical reconciliation.

This corrects sequential payment identity, not full transaction atomicity. The
existing check/insert/audit sequence is not a concurrency or rollback proof, and
the existing schema's unique key does not establish an atomic audit. Native
D1/workerd and installed acceptance remain separate. No provider API lookup,
new health/contact collection, configuration change or customer write is implied.

Sources:

- [Square payment webhook behavior](https://developer.squareup.com/docs/payments-api/webhooks)
- [Square signature validation](https://developer.squareup.com/docs/webhooks/step3validate)
- [Square payment.updated payload](https://developer.squareup.com/reference/square/payments-api/webhooks/payment.updated)

Prepared by [pc2-codex-13].
