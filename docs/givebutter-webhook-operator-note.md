# GiveButter Webhook Endpoint Operator Note

## 1. Overview

The GiveButter webhook endpoint receives incoming HTTP POST events (such as donations or ticket registrations) and records them in the database attached to a caregiver record with append-only audit logging.

- **Primary Route**: `/webhooks/givebutter` (`functions/webhooks/givebutter.js`)
- **Compatibility Route**: `/api/webhooks/givebutter` (`functions/api/webhooks/givebutter.js`)
- **Method**: `POST`
- **Content-Type**: `application/json`

## 2. Configuration

### Environment Variables

The endpoint requires a shared secret for HMAC-SHA256 signature verification:

- `GIVEBUTTER_WEBHOOK_SECRET`: Configured in Cloudflare Pages dashboard under **Settings > Environment variables** (encrypted secret).
- In `wrangler.toml`, the variable binding is declared commented out with an explanatory note to prevent deployment failures before the dashboard variable is provisioned.

### Webhook Setup in GiveButter

1. Navigate to GiveButter Settings > Webhooks.
2. Set Endpoint URL to `https://<domain>/webhooks/givebutter`.
3. Select subscribed events (e.g., `transaction.succeeded`, `ticket.created`).
4. Copy the webhook signing secret and store it in Cloudflare Pages environment variables as `GIVEBUTTER_WEBHOOK_SECRET`.

## 3. Behavior and Guardrails

1. **Signature Verification (Constant-Time)**:
   - The endpoint reads the `Signature` HTTP header.
   - It computes `HMAC-SHA256(raw_body, GIVEBUTTER_WEBHOOK_SECRET)` in hex.
   - Signatures are compared using constant-time equality.
   - If the secret is missing/unset, or the header is missing/invalid, the endpoint immediately returns HTTP 401 Unauthorized before performing any database read or write.

2. **Idempotency & Replay Safety**:
   - The endpoint extracts the GiveButter event ID (`id` or `data.id`).
   - If an event with `(source = 'givebutter', external_ref = event_id)` already exists in `registration` or `followup`, the endpoint returns HTTP 200 with `{"ok": true, "duplicate": true}` without writing any additional record or audit row.

3. **Donor Matching**:
   - Matches existing caregiver records by email (trimmed, case-insensitive).
   - If no match exists, creates a contact-only caregiver record with `source = 'givebutter'` and `donor = 1`.
   - Never merges records on partial matches.

4. **Payload Privacy**:
   - Error responses never echo request payloads back in response bodies.

## 4. Log Signatures for Rejected Webhooks

When an incoming request is rejected, the endpoint returns standard JSON error responses with distinct HTTP status codes:

- **Missing Signature Header**:
  - HTTP Status: `401 Unauthorized`
  - Response: `{"ok": false, "error": "missing signature header"}`
  - Cause: Incoming request lacked the `Signature` header.

- **Invalid Signature / Secret Mismatch**:
  - HTTP Status: `401 Unauthorized`
  - Response: `{"ok": false, "error": "invalid signature"}` or `{"ok": false, "error": "webhook signature verification failed"}`
  - Cause: The shared secret does not match or the payload was altered in transit.

- **Malformed JSON Body**:
  - HTTP Status: `400 Bad Request`
  - Response: `{"ok": false, "error": "invalid JSON body"}`
  - Cause: Payload was unparsable or not a JSON object.

- **Missing Event Identifier**:
  - HTTP Status: `400 Bad Request`
  - Response: `{"ok": false, "error": "missing event id"}`
  - Cause: The payload lacked a top-level `id` or `data.id`.
