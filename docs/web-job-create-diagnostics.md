# Closed diagnostics for a staff web-job create HOLD

[pc2-codex-42]. Source-only successor to the default-OFF web-job implementation. This change identifies a **future request's observed failure boundary**, not the cause of any earlier held job. It does not recover provider bodies, change credentials/scopes, repair/retry a job, or qualify deployed/runtime/client acceptance.

## Response contract

The existing HTTP409 `{ok:false,state:"hold",error:"web_job_hold"}` remains compatible. Only the create route may add:

- `diagnostic_stage`: one fixed source-defined stage below;
- `diagnostic_http_status`: an actual integer100–599 observed from the bounded Slack response, if available;
- `diagnostic_slack_error`: an exact allowlisted Slack error string, only from a parsed bounded response with `ok === false`.

These fields are available only after existing configuration has required web jobs ON and the request has a private verified Access staff identity, an actual active staff record, the same origin, POST and no query string. Anonymous/inactive/wrong-origin/OFF responses, machine errors and human status/materialization errors do not gain diagnostics. Invalid target/body checks retain their existing refusal behavior. No browser/body/context identity can turn diagnostics on.

| Stage | Operation being attempted; not a delivery guarantee |
|---|---|
| request | bounded create request parsing |
| lookup | actor/idempotency lookup |
| actor_busy | actor-global active-job lookup; a found row also returns a fixed operator-facing refusal |
| transport | approved backend transport construction |
| snapshot | existing key validation and exact target/schema snapshot |
| freeze | canonical frozen input, digest and pointer construction |
| persist | initial durable pending/new job insert |
| reserve | pending/new to reserved dispatch CAS |
| send | one pointer post; timeout/unknown exceptions have no raw detail |
| response_body | bounded4096-byte response reading or JSON parsing |
| response_rejected | HTTP or parsed API refusal |
| response_receipt | parsed response lacks the exact channel/valid message timestamp |
| send_receipt | injected approved transport returned an invalid receipt shape |
| ack | durable send-receipt CAS or its acknowledgement |
| final_read | final persisted job read |

`diagnostic_http_status` is the upstream response status, **not** a replacement for the application's409. An API refusal may therefore report upstream200. Stage/HTTP/API code do not independently prove delivery or non-delivery. In particular, response parsing/receipt/acknowledgement failures can occur after an external post took effect; they remain unknown/HOLD and never repost.

The closed Slack error allowlist is: `not_in_channel`, `channel_not_found`, `invalid_auth`, `not_authed`, `token_revoked`, `token_expired`, `account_inactive`, `missing_scope`, `no_permission`, `is_archived`, `restricted_action`, `ratelimited`, `rate_limited`, `service_unavailable`. Unknown codes are omitted, never reflected, shortened or mapped to a guessed cause. The method's [official error reference](https://docs.slack.dev/reference/methods/chat.postMessage/) was consulted; a listed code is not evidence it occurred in a real request and does not authorize credential/scope changes.

## Privacy and effect boundaries

A private internal error type carries only closed stage/status/code values, and the create response rechecks their types and membership. Ordinary exceptions, forged error-shaped objects and injected transport errors cannot supply diagnostic fields. No exception message/stack, raw provider JSON/headers, token, actor, prompt, frozen input, job nonce/signature or Slack message text is serialized. There is no console log, new sink, telemetry query, migration, stored diagnostic column, global debug switch or new endpoint. Responses retain no-store/referrer headers.

The existing4096-byte body limit now also bounds parsing of a non-2xx provider response to obtain an optional known enum. Fetch remains the same exact Slack method, redirect=error and ten-second AbortSignal, one call only. A thrown timeout/network exception is deliberately classified only as unknown `send`, not as proven absence or a retryable error. Numeric status is omitted if not an actual valid HTTP integer. Tests inject a timeout exception; they do not claim to exercise a real ten-second network deadline.

The original durable pending insert precedes reservation, which precedes the one pointer post. Reservation/CAS/HMAC/replay/lease/one-actor guards, uncertainty HOLD and original target/preview confirmation/audits are unchanged. Known idempotency reuse still returns the existing state without another post; diagnostics are not persisted or reconstructed for old jobs. No recovery write, held-row cleanup, alternative actor/transport, model fallback or human confirmation is added. Staff widget collapse, mic, keyboard/layout and UI error rendering are untouched.

## Verification and handoff

`web-job-create-diagnostics.test.mjs`: **7 new focused tests PASS**, covering a known bounded Slack refusal; unknown error/malformed/oversized/wrong-receipt responses; injected timeout and forged exceptions; acknowledgement uncertainty before and after fake commit; direct transport diagnostic forgery/nonnumeric status; persist/reserve failures before post; and anonymous/inactive/wrong-origin/OFF/machine privacy boundaries. Fictional in-memory SQLite and injected fetch only: each test asserts one-post or no-post behavior and unchanged target/original audit state. No real D1, Slack, Access, model or browser action occurred.

The new test is explicitly added to the existing reviewed unit allowlist. A pure unit-plan check verifies inclusion without executing the old suite. Existing1630/R36/R37/five-workflow suites were not replayed locally. Normal PR CI runs independently and is not release/workerd/runtime evidence. Latest Workers types5.20261016.1 and current best-practices documentation were retrieved without installing dependencies or invoking a compiler. Cloudflare/Workers skill guidance influenced the bounded parsing, awaited effects, request-local diagnostics and fail-closed privacy boundary; existing deployed config/authentication is not relaxed to match general examples.

After whole-source review and normal integration, the existing release owner must perform a fresh original full build and staging-first qualification as separately authorized. The source author does not compile, deploy, send a new real request or mutate the earlier held job. A later controlled canary must be separately disposed by its runtime owner; this PR alone supplies neither that authorization nor Phase One/customer-production acceptance.
