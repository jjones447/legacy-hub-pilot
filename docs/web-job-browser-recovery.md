# Exact browser web-job recovery

[pc2-codex-42], 2026-10-16. SOURCE successor on the same terminal-close PR. Implements the missing browser half of S1/S4; no actual migration, disposition, browser recovery, send or deployment is recorded by this document. Read alongside [terminal-close and lattice contract](web-job-terminal-close.md).

## Separate the two uncertainty kinds

The former `agent-confirmation-hold=1` had no correlation and could mean either a failed web job or an uncertain business confirm/discard. It is not reinterpreted as web-job authority.

New web-job attempts persist `agent-web-job-record-v1` **before the first create await** with exactly `v`, `kind:web_job`, verified initiating `actor`, exact `origin`, per-tab random `session_id`, `idempotency_key`, `job_id` (NULL until a valid receipt) and `phase:create|waiting|materialize`. No request text, proposal, target data, token, signature or preview is stored there. The session nonce is an opaque correlation reference, not an authorization credential. It is retained under `agent-web-job-session-v1`. The server-proven identity comes only from the existing authenticated feature bootstrap; saved actor/origin fields are not trusted as authority.

An interrupted record on reload blocks new sends. A known machine refusal or successfully presented governed preview removes only that attempt record. A failed/unknown create, status, materialization or preview retains a web-job HOLD. Create-ack loss can later be correlated by the exact pre-send idempotency key, not by guessing a job ID. Old idempotency is never resent by recovery.

Business confirmation/discard uses independent `agent-business-confirmation-pending-v1` **persisted before its fetch**. A successful known acknowledgement clears only that pending marker. Failure also sets `agent-business-confirmation-hold-v1` and the original generic hold. A reload with a pending marker treats it as uncertain business confirmation. No web-job recovery branch clears either independent business marker, in-memory business HOLD or a competing pending action. These conservative markers do not implement business-confirmation recovery; that remains governed reconciliation of the actual original result/audit.

## Authenticated read-only recovery wire

The existing verified-active-staff, same-origin `POST /api/agent/web-jobs` accepts a **read-only** action with exactly:

```json
{"action":"recover","kind":"web_job","job_id":null,"idempotency_key":"<32 lowercase hex>","session_id":"<32 lowercase hex>"}
```

A known `job_id` may replace NULL, but must match the same actor/idempotency. For legacy reconciliation, `kind` is `legacy`, job ID is required, and idempotency must be NULL. The server independently derives the authenticated actor/origin. It requires the owned job's immutable `closed_unmaterialized` state and matching immutable disposition with `delivery:unknown`; active jobs or actor-owned content/workflow drafts refuse recovery. It returns only the initiating actor/origin, exact job/idempotency/session, disposition operation ID and closed/unknown result. It does not return frozen inputs, evidence documents, authority hashes, provider details or another actor's metadata. It performs no writes and exposes no close/grant/cleanup action.

The browser manually checks this proof with a ten-second deadline, no redirects and same-origin credentials. Every identity/correlation field, terminal state, disposition ID, delivery enum and expected legacy authorization must match. A response may supply the job ID missing from a create acknowledgement only when the exact stored idempotency matches. Wrong status, malformed JSON, lookup error, timeout/hidden-page abort, changed actor, changed correlation/session, unknown business confirmation, or storage failure leaves input held. There is no standing poller or automatic retry.

The recovery action reserves synchronously against duplicate clicks/new input. Before any release it rechecks the hold generation and all relevant storage values after the await. It writes an exact local `agent-web-job-recovery-receipt-v1` first, then releases only the matching typed record. A subsequent input is a new human intent with a new request idempotency; no old create/materialize/confirm is issued by recovery.

## Legacy boolean-only exact-session reconciliation

No retained correlation is invented. The existing held tab displays a fresh per-tab recovery reference plus a closed-job-ID field and **Check exact-session reconciliation** button. Merely entering an owned closed job is insufficient. An authenticated legacy recovery read refuses unless a separate immutable operator attestation exists for that exact session reference, job, actor and origin.

The same opt-in candidate0017 now includes `assistant_web_job_browser_reconciliation`, keyed by `session_id`, with job/actor/origin, operator, authority/evidence digests and timestamp. Its guard requires an already-closed job/disposition; updates, deletes and replacement are refused. New operator-only export `authorizeLegacyWebJobBrowserRecovery(env, permit, now)` requires exactly `job_id`, `actor`, `session_id`, `operator`, `evidence_digest`, `authority_digest`, the same isolated-D7/explicit-close opt-in/perimeter context, and no other active job or owned draft at insertion. It is idempotent only for the exact same attestation. It is **not** an HTTP route; existing staff login, a pasted session reference or arbitrary evidence hash cannot authorize it. The executor authenticates the actual authority/evidence and actual D1 client as for terminal close.

Concrete Root/operator sequence under already-granted recovery authority:

1. Preserve the exact held browser tab, current initiating identity/origin, retained request observations and original audit/target evidence. Obtain its displayed recovery reference after installing the reviewed composition; do not manufacture a historical session/job correlation.
2. Verify the exact synthetic job's terminal close and reconcile this tab's legacy latch against the original draft/confirm/discard outcomes and current saved state/original audits. Establish positively that no unrelated business confirmation remains uncertain. A missing log or empty runtime receive window does not establish this.
3. If evidence is genuinely ambiguous, **do not attest or clear**. Record precisely which original outcome/session linkage is missing and continue unrelated work. This is an evidence dependency, not another request for Jacob's generic permission.
4. Only after that exact-session reconciliation, the authorized operator invokes `authorizeLegacyWebJobBrowserRecovery` once with the displayed session reference, exact closed job/initiating actor, and authenticated authority/evidence references. Keep the attestation/journal private. Read back exact immutable row/parity; no schema replay or old-job resend.
5. In that same tab, enter the exact operator-reconciled closed job ID and click the legacy check. The authenticated read must match the grant and terminal disposition. The browser will not release if an independent business HOLD/pending marker, changed storage or in-flight action exists.
6. Release is staged: persist the local proof, retain a typed closed-job marker while clearing **only this positively reconciled legacy boolean**, then remove that marker. A crash/storage failure at any intermediate point keeps either the original or typed hold across reload. No `sessionStorage.clear()`, blanket deletion, other actor or hidden script reset is used.
7. Enter a fresh intentional request only after the release message. That is separate from running the next actual workflow/canary and does not assert any deployment/client acceptance.

If both a typed record and a generic unknown hold exist, or either independent business marker exists, this implementation refuses to reinterpret them. Invalid storage/correlation is surfaced as held. The operator must reconcile the actual ambiguity rather than use the legacy attestation as a universal bypass. A successful operator attestation is not a grant to reset all browser state.

## Tests / composition requirements

`web-job-browser-recovery.test.mjs` adds full actual `agentSend`, confirmation/recovery source in fake DOM/advancing clock/storage plus fictional SQLite server-wire cases. It covers matched proof/new distinct intent, pre-receipt key lookup, wrong identity/job/key/session/state/delivery/disposition, redirect/HTTP/JSON/timeout errors, malformed/mixed storage, independent business pending/HOLD, concurrent recovery and in-flight changes, staged legacy failure/reload, exact operator grant/idempotency/immutability/no HTTP grant, active-job/draft/ineligible-state refusal, authenticated feature bootstrap and no saved-state authority. No live browser/provider/database or old request is exercised. Existing backend candidate regressions qualify the changed candidate composition separately; normal hosted CI remains distinct from workerd/build/runtime/deployed acceptance.

The candidate schema hash and full module closure have changed: do not freeze the earlier backend-only PR head or execute its incomplete statement list. Codex41 owns the operational migration/close/grant packet; Codex13 whole-head review and original compiler/staging qualification must use the final selected composition. UI recovery cannot operate safely against an old function bundle missing the read-only proof or a partially applied schema. No new account/credential/provider/schedule changes or client sends are part of this source slice.
