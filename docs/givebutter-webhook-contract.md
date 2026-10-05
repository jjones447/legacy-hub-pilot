# Givebutter webhook authentication and delivery identity

This source correction accepts the documented Givebutter transaction and ticket payloads without adding tables, sending payments, or changing provider accounts. Source and synthetic-test results do not establish that an installed webhook works.

## Authentication modes

The default `GIVEBUTTER_WEBHOOK_SIGNATURE_MODE=secret` compares the `Signature` header with the configured `GIVEBUTTER_WEBHOOK_SECRET`. An absent mode selects this default. Givebutter documents sending its dashboard signing secret directly in this header. This is shared-secret authentication over HTTPS, not a cryptographic signature binding the request body. Do not log the header or secret.

An existing intermediary that really generates a lowercase hexadecimal HMAC-SHA256 of the raw body can explicitly select `hmac_sha256`. That mode preserves the old adapter contract and does not accept a bare secret. The default mode does not accept HMAC signatures. There is no automatic fallback between modes. Unknown modes and missing secrets fail closed with 503; missing or incorrect signatures return 401.

Comparison hashes both values to fixed-size buffers before comparing them. Workers uses its native `crypto.subtle.timingSafeEqual`; Node synthetic tests use a fixed-size fallback. No new package or runtime installation is needed for the source tests.

## Delivery identity and existing records

Validated explicit top-level delivery IDs remain the external reference for compatibility. For documented `transaction.succeeded` and `ticket.created` payloads without that ID, the reference is the event kind plus `data.id`, separated by a colon. This prevents a transaction and ticket with the same resource ID from suppressing one another. IDs must be nonempty strings of at most 200 characters or nonnegative safe integers, normalized to strings. Other event types do not receive a new resource-ID fallback.

Existing rows and audit records are not rewritten. Sequential replay uses the existing registration/followup lookup. This correction does not resolve the historical parallel-delivery race or make the sequential mutation and audit writes atomic.

## Event mapping and installed acceptance

The existing published internal-event lookup is unchanged. A provider ticket without a recognized internal event mapping becomes a `gb_registration` followup, not a claimed event registration. A successful transaction without a recognized mapping becomes a donation followup. No numeric campaign-to-internal-event mapping is invented.

Before integration, obtain a different-author exact-head review of the authentication mode change, fallback identity and legacy compatibility. Before live acceptance, the existing operator must verify the installed source pin, provider destination, selected event subscriptions, matching secret and selected mode without publishing secret values. A sanitized provider delivery receipt and attributable task/audit evidence are still needed. Do not create real payments, customer records or account configuration changes under this source-only correction.

Unbounded body buffering, identity matching, concurrent deduplication and audit atomicity remain separate technical limitations of the existing handler. Passing Node fixtures is not Cloudflare D1/workerd or real-provider acceptance.

## Sources

- [Givebutter webhook events and authentication](https://help.givebutter.com/en/articles/8828428-how-to-automate-workflows-and-data-using-webhooks), checked October 4, 2026.
- [Givebutter webhook creation API](https://docs.givebutter.com/api-reference/webhooks/create-a-webhook), checked October 4, 2026.
- [Cloudflare Web Crypto reference](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), checked October 4, 2026.

Signed: [pc2-codex-13]
