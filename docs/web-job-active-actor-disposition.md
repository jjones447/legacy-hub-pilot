# Active-actor refusal and unresolved-job disposition

[pc2-codex-42], 2026-10-16. SOURCE-only successor to create diagnostics. No deployment, live database read, provider send, old-job write, schema application or workflow acceptance is claimed here.

## Exact counterexample and bounded correction

The actual candidate `0016_assistant_web_job.sql` defines a unique index on **actor**, covering `pending`, `claimed`, `result`, `materializing` and `hold`. It has no expiry or origin predicate. A new idempotency key does not release the actor. Expiration is not proof of non-delivery or non-materialization.

The new regression executes that exact DDL and the actual literal INSERT extracted from `createWebJob`, using fictional in-memory SQLite only. An expired `hold/reserved` row deterministically prevents the second same-actor INSERT with SQLite extended error2067 / UNIQUE constraint on `assistant_web_job.actor`. The existing row, target, audit table and total-change counter remain unchanged. This is a source-level counterexample, **not** a current hosted-D1 diagnosis or proof about any real Slack delivery.

After the existing actor/idempotency lookup, create now reads only an active row's ID with the exact same actor-global state predicate as the index. It does not inspect expiry, clear state, select another actor, reconstruct a provider error or return the stored ID. A found row produces compatible HTTP409 / `web_job_hold` / `state:hold`, fixed `diagnostic_stage:actor_busy`, and this fixed refusal:

> A previous assistant request is unresolved. This request was not created or sent. Do not retry; ask the operator to resolve the existing hold.

The statement refers to the **new request**, not delivery of the previous one. The existing staff UI escapes and displays `refusal` and retains its persistent safety HOLD; no UI code/storage reset is added. An exception during the lookup returns the closed stage without the stronger not-created/not-sent explanation. Only existing ON/configured, verified active-staff, same-origin, valid create requests reach this read; anonymous/inactive/wrong-origin/OFF responses disclose no occupancy.

The prelookup is advisory, not a lock. The unchanged unique index still rejects a competitor that appears after the read, before reservation/send. That case remains a `persist` HOLD, not a guessed actor-busy cause. The unchanged pending-insert → reservation CAS → single send → acknowledgement order remains authoritative. Same idempotency still returns the old state first, with no second send.

## What this does not unblock

No possible second same-actor INSERT can satisfy all three conditions simultaneously:

1. the old row remains in an indexed active state;
2. the actor-global one-active index is unchanged;
3. a new active row uses the same actor.

This correction stops an avoidable failed INSERT and provides an accurate operator message. It is **not** recovery, operational release or completion of five live workflows. Automatic expiry, treating missing acknowledgement as no send, weakening the index, changing actor identity, deleting a row, reusing a new idempotency key or resubmitting cannot legitimately resolve the incompatibility.

## Smallest prospective lifecycle successor — proposal, NOT implemented

The release owner needs a separately reviewed, explicit terminal-disposition mechanism before releasing an actor whose job remains active. Do not repurpose `refused` (a machine result) or `materialized` (a real saved draft) to mean operator cancellation. The present CHECK constraint has no truthful terminal cancellation state. A successor would need a distinctly named terminal state such as `closed_unmaterialized`, an explicit migration, a separately recorded operator disposition, and narrow atomic compare-and-swap conditions. The active-state index need not be weakened, but the old row would have to transition truthfully out of its active set. **That necessarily changes the old record and is incompatible with the current no-old-record-mutation boundary. None of it is shipped here.**

Required source/security review before implementing such a successor:

| Observed lifecycle | Minimum evidence/conditions; not permission to perform a transition |
|---|---|
| Expired pending/new, never dispatch-reserved | Authoritative exact-row comparison; expired signed pointer; no claim/result/lease/materialization; same atomic predicate must reject any concurrent reservation. A positive never-dispatched invariant is needed, not just an absent receipt. |
| Reserved or HOLD with unknown external delivery | Preserve uncertainty: no retry and no assertion that no post occurred. Existing executor must quiesce the exact attempt and dispose pending/in-flight calls; independently verify the lifecycle and prohibit any late claim/result/materialization. Missing stored acknowledgement alone is insufficient. |
| Claimed or result | Establish the exact executor/lease/result disposition and prevent late work; do not turn a valid proposal or unresolved execution into a fabricated refusal. An expired lease alone does not establish no external effect. |
| Materializing or uncertain target-write acknowledgement | Reconcile exact draft/target and original audit equality first. No actor release while a target/draft transaction or its acknowledgement remains uncertain. Never fabricate, delete or replace original audit evidence. |
| Materialized/refused | Already outside the active index. Preserve existing idempotency, real preview and confirmation semantics; no lifecycle rewrite needed for a distinct new request. |

The proposed operator action must be authenticated and separately authorized for the exact job, record the observed disposition/evidence reference without prompts or secrets, and CAS every reviewed precondition in the same transaction as its separate disposition record. Late old pointers/claims/results must remain permanently fenced. Preserve original frozen input, idempotency, signatures/nonces, original target audit history and an explicit unknown-delivery outcome where applicable. Rollback must never reopen an expired/closed attempt or resend it. No generic cleanup endpoint, automatic timeout release or mass sweep is appropriate.

If an immutable old row is a continuing requirement, this proposal is not applicable: the release owner must explicitly choose a different reviewed lifecycle design. There is no safe implementation trick within the current constraints that makes the existing actor slot free. An operator's fresh lifecycle decision/evidence, not another ordinary consent request, is the dependency.

## Verification and cloud handoff

Eight new focused tests cover: actual DDL/INSERT conflict; all five active states despite expiry; actor-global origin handling and field privacy; unchanged same-idempotency response; real terminal/other-actor eligibility; fail-closed lookup failure; post-read race backstopped by the original index; and anonymous/inactive/wrong-origin/OFF privacy. SQLite and injected transport only. No real provider, customer data, real runtime, compiler, SQL apply or existing-job action. Each relevant case checks original fictional row/target/audit preservation. The file is explicitly included in the reviewed unit allowlist.

Latest Workers types5.20261016.1 and [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) were retrieved; `.first()` is awaited and nullable. The Cloudflare/Workers skills informed binding-local access, awaited effects, no raw error logging, closed privacy and race-safe fail-closed handling. Config, credentials and existing technical holds are unchanged. Node-only tests do not qualify Workers runtime, production, deployed workflows or client acceptance.

The source author publishes the branch/PR and this documentation to GitHub, then hands the exact head and observed checks to Codex13 for whole-head review and release disposition. Normal hosted CI is separate from full compiler/staging and runtime verification; no self-merge or deployment is performed by this source author. The existing sole runtime owner retains executor custody and the canonical tracker remains with the existing writer.
