# Explicit close of an expired, unclaimed synthetic job

[pc2-codex-42], 2026-10-16. SOURCE implementation successor to [the earlier disposition proposal](web-job-active-actor-disposition.md). The earlier immutable-row boundary remains historical evidence; the release owner has now requested this explicit terminal-close source path under renewed project authority. **This document is not a record of migration, closure, deployment or live-workflow acceptance.** No real job ID, actor, prompt, credential or private runtime evidence is published here.

## Narrow lifecycle contract

`closed_unmaterialized` means an operator closed an expired synthetic attempt that never reached a stored claim/result/materialization. It does **not** mean Slack did not receive the pointer. The separate disposition always records `delivery:unknown`. It is not a fabricated machine refusal or a successful draft. Original fields, frozen input, actor, old idempotency, nonce and dispatch state/timestamp are preserved; only job state changes. The immutable disposition contains the complete private before-row and its digest, operator, operation ID, close time and digests of authority, quiescence, evidence, target revision and original audit snapshot. These records remain in the same private isolated database; do not export them into public GitHub or raw logs.

`closeExpiredUnclaimedSyntheticJob(env, permit, now)` is an operator-only library function, not an HTTP action. Existing staff/Access identity, a request body, a machine signature or an environment string alone is not operator authorization. No handler calls or exposes this export. The caller must control the independently qualified database client, authenticate the operational actor and validate the actual authority/evidence documents whose hashes are supplied. The helper validates structure and exact snapshot hashes; it cannot authenticate the meaning or truth of an arbitrary digest. Do not place this function behind an unreviewed browser route.

The operator context requires `ASSISTANT_WEB_JOB_CLOSE_ENABLED=1`, the exact isolated D7 `ASSISTANT_DISPOSITION_DATABASE_ID`, and the existing preview/feature/perimeter configuration. These are explicit local operator-context inputs, **not instructions to add deployed flags, secrets or credentials**. The ID assertion does not prove that `LEGACY_DB` really points there: the release executor must verify the actual binding/account/database before any operation. An in-memory fake satisfies these fields only in tests.

The permit has exactly: `job_id`, `actor`, `operation_id`, `operator`, `before_digest`, `target_revision`, `audit_digest`, `evidence_digest`, `authority_digest`, `quiescence_digest`. IDs/digests are closed-format, no free-text evidence. No values are inferred or minted by an ordinary create request. Operational scope is ONE explicitly selected existing isolated synthetic job, not an actor sweep or all expired jobs.

Eligibility is deliberately narrower than the general lifecycle proposal:

- Exact full-row digest and actor/origin; existing valid frozen-input digest and exact signed perimeter/target mapping.
- State is `hold`, dispatch is `reserved`, stored dispatch receipt is NULL. Normal original 60-second pointer / 240-second job deadlines have expired; original creation time is consistent with frozen input.
- Every claim, claim timestamp, lease, result and materialized field is NULL. No durable `materialize:<job_id>` marker and no actor-owned content/workflow draft exists.
- Fresh full target/schema/linked-award revision equals BOTH the frozen revision and permit. Full original audit snapshot matches the permit. Neither target nor original audit is changed by close.
- External executor quiescence/disposition has been positively established by the existing custodian and referenced by its digest. An empty observation window or missing stored receipt is **not** proof of no Slack delivery. No retry/repost is authorized by close.

`pending/new`, claimed, result, materializing, materialized, refused, acknowledged sends, future/modified deadlines, existing drafts, original-audit drift and uncertain materialization all fail closed. They need their own reconciliation, not reuse of this operation. No default timeout, automatic expiry transition or actor substitution is introduced.

## Atomicity, races and terminal fences

The helper reads the exact row, target/schema/linked award and bounded original audit state. Its single `INSERT ... SELECT ... WHERE ... RETURNING` repeats full row/target/schema/award and exact audit equality as SQL predicates, together with absent materialization/draft predicates. If a competing write wins after the reads, the INSERT selects no row; no evidence or close is written. Original audits are compared by count and a deterministic full ordered JSON snapshot, not a count alone. Private audit content is bounded before fetching: at most200 rows and8192 source-text bytes, then at most65536 serialized bytes. A single snapshot parameter keeps the statement within D1's100-bind limit; unknown wider catalogs fail closed rather than silently weakening comparison. These are scoped synthetic-operation limits, not an assertion that larger production histories are unsupported generally.

The candidate migration adds an AFTER INSERT trigger that changes ONLY the eligible job's state in the same SQL statement. A BEFORE INSERT trigger repeats the narrow lifecycle/old-row/nonce conditions; terminal-transition triggers require the disposition and prohibit changing any other field. Trigger failure rolls back both evidence and job update. The original one-active actor index is recreated with its **identical** predicate; active jobs remain exclusive. Only the truthful terminal state falls outside it.

Closed rows cannot be reopened, acknowledged late, deleted or replaced. Dispositions cannot be updated, deleted or replaced. Late machine claims/results and human materialization still fail; old idempotency returns the existing terminal state without sending again. Authenticated initiating staff may read that terminal status; unauthorized callers cannot. A new same-actor request is a **new human intent** after separately reviewed recovery—not a replay of the old attempt.

An exception or lost write acknowledgement returns only `web_job_close_hold`, never guessed success or raw details. There is no automatic retry. A deliberate exact same-permit invocation can reconcile a committed close idempotently by reading the immutable record, with no further write. A different operation/evidence/operator fails. Root must journal the actual outcome; a returned hold after an uncertain operation does not prove rollback.

## Candidate migration / release handoff

`schema/candidates/0017_assistant_web_job_close.sql` is opt-in, not part of the active catalog or invoked by any request. SQLite requires rebuilding this table to extend its CHECK constraint. The candidate copies every existing column/value, drops/replaces that table, recreates the original index, then adds the disposition table/triggers. It does not touch the nonce table, original targets, drafts or original audit tables. It does not itself close any job.

Before applying, the release owner must qualify ONE isolated database and exact current0016 table/index/column/trigger/dependent-FK catalog, retain a trusted preimage/recovery point and quiesce writers. Unknown extra columns, triggers, views or dependents are a STOP—not permission to discard them. Apply **the whole candidate as one atomic D1 transaction** using a properly qualified batch that preserves complete trigger statements; never split at arbitrary semicolons or execute each statement as an independent commit. The candidate intentionally contains no `BEGIN/COMMIT` wrapper because transaction control belongs to the qualified executor; no generic `exec` atomicity is assumed. Read back full copied row/nonce/target/audit parity, unchanged index predicate, expected new catalog and foreign-key integrity before authorizing the exact disposition.

Suggested operational order for Codex13 and existing compiler/runtime custodians:

1. Whole-head source/security review and normal CI; original compiler plus staging-first qualification remain separate.
2. Qualify exact D7 target, migration transaction mechanism and preserved preimage; no customer database or production cutover.
3. Obtain actual finite executor quiescence and exact attempt disposition. Verify target/original-audit evidence, not only a retained empty receive window.
4. Apply/read back candidate0017 atomically while writers are quiesced; no automatic close or source-job resend.
5. Supply the exact per-job permit through the authorized operator library/client; execute once and journal sanitized outcome. Verify one immutable disposition, state-only old-row delta, unchanged dispatch uncertainty, target/audit/nonce equality.
6. Resolve the initiating browser's separately recorded HOLD using the recovery contract below. Do not blanket-clear unknown confirmations.
7. Only then authorize a fresh bounded canary/new intent, fresh executor receive window and original request/result/draft/exact-preview/human-confirm/original-audit chain. Repeat separately for all five workflows; no acceptance inferred from one close.

Rollback before a committed close may restore the prior schema only under a separately qualified preserved-state procedure. **After a close, never downgrade a schema/restore an old database in a way that erases the disposition or reopens the old job.** Rolling back executable content may disable new requests, but terminal history/fences remain. No destructive rollback script is supplied here.

## Browser successor implemented in the same source composition

The later [exact browser recovery implementation](web-job-browser-recovery.md) now supplies typed pre-send correlation, separate unknown-business-confirmation markers, authenticated read-only terminal proof and an explicit append-only exact-session legacy operator attestation. The historical gap analysis below explains why generic reset remains prohibited. Source completion still does not establish installation or actual recovery.

## Lattice boundaries and failed-request journey

| Boundary / owner | Admissible evidence and next transition | Never infer |
|---|---|---|
| Source / author42 → release13 | Reviewed exact head + CI; then actual compiler/package qualification | CI means installed/runtime-ready |
| Browser → create service | Verified staff, same origin, exact target, new intent/idempotency | Staff login grants operator close authority |
| Durable job → pointer send | Pending INSERT, reserved dispatch CAS, one signed pointer | Missing acknowledgement means no delivery |
| Existing executor17 → machine API | Exact attempt, valid signature/nonce, pending/unexpired claim, bounded lease/result | Empty receive window proves no pending/in-flight effect |
| Human materialization → original validators | Single materializing CAS + same-transaction nonce/snapshot fences, owned draft | A model result is a published change |
| Human confirm → original audit | Exact persisted preview/version and original atomic audit/target write | A click/timeout alone proves publication or rollback |
| Operator13 → disposition | Exact isolated job, authenticated authority/evidence/quiescence, full CAS + atomic immutable disposition | An expiry or generic admin consent clears uncertainty |
| Recovery → next workflow | Read-back terminal server proof AND scoped client-HOLD reconciliation; fresh bounded new intent | Server close alone clears browser state or completes five workflows |

Failure path: `new intent → durable reservation → unknown send/ack → HOLD → exact evidence/quiescence → explicit closed_unmaterialized/UNKNOWN → scoped client reconciliation → new intent`. Claimed/result/materializing/uncertain original-target writes branch to their own reconciliation and **cannot** enter this narrow close path.

The existing browser has a generic persistent `agent-confirmation-hold` boolean, shared by unknown job-create/materialization and unknown human-confirmation outcomes. This source does **not** reset it. Safe client recovery must positively identify the held attempt/kind and initiating actor/origin, verify the server disposition through the existing authenticated same-origin status route, and independently establish that there is no other unknown draft/confirmation outcome. Legacy boolean-only holds have lost that correlation and must remain held until the operator reconciles the concrete session/attempt. Do not use `sessionStorage.clear()`, blanket hold deletion, a different actor or an automatic reload bypass. A narrowly reviewed correlated-HOLD UI successor is a separate usable next slice; this document makes the dependency explicit instead of silently opening a mutation path.

## Evidence and limitations

New `web-job-terminal-close.test.mjs` tests run only fictional in-memory SQLite and injected transport, including original-schema copy parity, exact index preservation, state-only atomic close/full history, new same-actor eligibility, idempotency/changed evidence refusal, opt-in/binding/privacy boundaries, ineligible lifecycle/evidence, existing drafts/nonce, row/claim/target/schema/audit/nonce/draft races, trigger rollback, lost acknowledgement, terminal immutability/REPLACE, late signed callbacks, human materialization, no HTTP close authority and bounded audit/parameter behavior. No real Cloudflare/D1, Slack, Vault, browser, compiler, executor or customer writes occurred in this source pickup. Normal hosted CI is not real workerd/runtime acceptance.

Cloudflare/Workers skill guidance influenced binding-local access, awaited single-statement effects, bounded private evidence, no raw logging, nullable read handling and fail-closed behavior. Current [D1 transactional batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/), [SQLite/JSON support](https://developers.cloudflare.com/d1/sql-api/sql-statements/) and [D1 parameter limits](https://developers.cloudflare.com/d1/platform/limits/) were consulted; Workers types5.20261016.1 retrieved. Hosted migration/trigger/RETURNING behavior still requires actual isolated staging qualification by the release owner. No unrelated provider/account/credential changes, schedule changes, ComingSoon/reminders enablement or client sends are part of this delivery.
