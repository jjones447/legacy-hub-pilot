# Server-owned staff confirmation binding

[pc2-codex-41] This source change closes the initiating-actor and exact-preview
binding gap in the existing agent APIs and updates their actual `staff.js` caller.
It uses existing Access identity, staff records, draft columns and original audit
batches. No schema, identity provider, credential, listener or runtime is introduced.
Source integration is separate from installation and five-workflow acceptance.

## Identity and draft ownership

The existing root middleware verifies the Access JWT signature, issuer, audience
and expiry. It now makes a request-local internal symbol available only after an
email-bearing human identity and active `staff_member` lookup. Service identity,
dev bypass, missing staff record and staff lookup error leave this proof absent.
An ordinary JSON/body/context actor property cannot manufacture it. Other console
routes retain their existing availability behavior; confirmation fails closed.

A qualified draft records `access_staff:<verified email>` in existing
`content_item.updated_by` or `agent_change.requested_by`. The marker records
server-owned provenance; it is not a new auth scheme or a credential. Existing
unbound `agent`, literal `staff`, service or anonymous owners remain unqualified.
No historical row is repaired or silently adopted. Drafting without human proof
can still return a draft, but has no usable confirmation version and the caller
offers no confirm control.

Confirmation requires the current middleware-issued human actor to match the
initiating owner. Body `staff_id`, actor text, headers decoded without middleware
proof, service tokens and dev headers cannot substitute. Actual staff confirmation
remains outside all model tools; the adapter from PR203 still has no confirm tool.

## Server preview version and transaction fence

Draft responses add `preview_version`: a SHA256 digest of the persisted proposal,
initiating owner, application origin and target snapshot. Workflow proposals include
the stored before/after/payload; content also returns `confirmation_preview` with
server before/after data. Content's baseline is captured before mapping. Workflow
baselines use existing domain projections; Grant uses its existing five-field
application projection plus the uniquely related award, including absent-award state.

The digest is a **version fence**, not a signature, secret, authentication proof,
human-intent assertion or independently established conversation identity. The
server recomputes it from persisted/current state and refuses missing or changed
versions before applying anything. Workflow re-validation must reproduce the whole
persisted before/after preview; malformed stored metadata cannot fall through.

To close the post-read race, the original confirmation audit is the first statement
of the existing transaction. Its actor is conditionally non-null only when persisted
draft and target snapshots still match. A mismatch violates the existing audit actor
constraint and aborts the batch before domain writes; a Grant also fences its related
award or its absence. No extra audit/receipt row is invented. Existing domain modules
accept trusted server precondition statements, never statements from request JSON.
Mutation, status and original audits still commit together in the source contract.

Pre-read drift returns refusal; a transaction race or other database uncertainty
returns the existing internal-error response. The caller treats that as HOLD, not
proof of rollback. Tests demonstrate the SQL contract with in-memory SQLite only;
installed native D1 behavior remains a separate gate. Original confirmation audit
now precedes its domain audit within the same committed batch; consumers must use
action/entity identity rather than assume an array position.

## Existing staff-console caller

The caller renders server-owned before/after and retains the returned version on
the exact preview control. A click sends the actual draft/change key plus that
version, disables duplicate controls immediately, and reports only app responses.
Missing preview/version offers no confirming control.

An error, timeout or uncertain confirmation latches HOLD before any repeat,
discard or replacement. The tab's session storage retains that latch through a
reload; storage errors keep the in-memory latch closed. Operator reconciliation
must inspect actual app result and original audits before any deliberate recovery.
There is no automatic reset/retry, replacement, undo or invented audit result.
This client latch is not a global server attempt ledger or a guarantee about another
browser session. The hosted assistant still needs its own retained session/HOLD seam.

## Conversation and integration boundaries

Application origin, initiating actor, actual draft ID and exact server preview are
bound here. There is no independently verified Slack user/thread mapping or hosted
conversation capability. Body `thread_id` or `conversation_id` assertions refuse;
they do not activate Slack confirmation. The staff-console path is updated together
with the API; the hosted/model path remains unable to confirm.

Historical drafts without qualified ownership/version cannot be confirmed by this
caller. They remain unchanged for deliberate operator review; no silent fallback,
automatic replacement or database repair is provided.

## Pure verification

`agent-confirmation-binding.test.mjs` exercises all five areas, same-owner success,
duplicate terminal refusal, cross-actor/missing proof/version/origin/context drift,
changed proposal/target, post-read race, competing confirmations, legacy owners and
secondary award drift. Existing JWT tests additionally exercise active human versus
service/dev/missing/error/deactivated staff proof. Updated application/caller fixtures
explicitly model trusted middleware and retained browser receipts; test header decoding
is clearly test support, not authentication or deployed proof.

The focused affected sets pass 393 tests, 0 failures/skips. This includes three
additional caller fixtures identified by the first hosted CI check; they now model
the same initiating staff actor and retain the server version instead of posting
unbound IDs. Production authorization was not relaxed. New pure tests are in the
explicit unit allowlist. No broad old suite was repeated locally, real workerd harness
ran, migration applied, target provisioned, or provider/customer/runtime write made.
Existing native/served/company/Cloudflare holds and integration ownership remain.
