# Legacy free-only inference — default-denied source boundary

[pc2-codex-42] November 3, 2026. Designated home: the existing Legacy Pages
agent routes and `functions/_lib` helpers. Root41 owns joined release acceptance;
the existing CT5 custodian owns provider plan/binding/billing metadata and changes.
This reuses current authenticated routes, pure mappers, proposal validators and
confirmation pipeline. It adds no gateway, billing oracle, subscription, service,
model dependency, counter, scheduler or runtime custodian.

The requirement and source assessment are indexed in the existing private
[Legacy54 entry](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-6612542611).
Current production baseline: `d810ef9c45b429214fe874ef09a23cb04d7dfbd1`.

## Environment-specific source packages

Production retains #322 on the production baseline above. The preceding
shared-staging-only #323 candidate starts from installed-source #315
`5d70122f1f518805adb73c2279398b667a0d5dac` and applies only that accepted
provider-off boundary. Within #323, caregiver login/My Support/preview code,
application assets and configuration were preserved from #315.

This **isolated Respite preview** candidate combines the independently approved
latest #320 header `34f9b68f897c628c5961b474182f3a966accb604` with accepted #323
`e12b29983824371d935e5c76ca830c6e37c3a90c`, per Legacy54 c6614111696.
No existing combined successor was found before this branch was created. The
merge has no source conflicts; the unit inventory retains People Add, Respite
and the AI guard. Guard application/test/fixture blobs are exact #323; all
HTML/template/styles/app.js/staff.js/portal/config/package/workflow blobs remain
exact latest #320. That page candidate already contains #315 QA/My Support and
#319 People Add. This guide is the only adaptation beyond combining accepted
source. No B1 collection/migration/source is added.

Only CT5 may publish this reviewed candidate to the EXISTING isolated preview,
after verifying its prior deployment and exact settings under root41's release
disposition. Do not move shared-staging #323 or production aliases. Verify the
header has no pills and only How it works, Program Details/four dates remain,
and mocked/provider-off denial still holds without a real inference request.
Source tests and publication are not installed/readback/client acceptance.

## Behavior in this revision

There is **no admitted provider-backed inference route**. Authenticated chat,
provider-backed Content/Form/Caregiver/Event/Grant drafts, direct/router ASR, and
new external website-job dispatch return503 `free_ai_unavailable`, `no-store`.
No plan flag, model override, gateway credential, fresh receipt or expiry timer
enables inference. Unknown/paid/prepaid/shared routes cannot issue even the first
request, so no malformed-response retry, alternate model, queued job or gateway
fallback can incur provider cost through these HTTP entry points.

No verified provider-side free-only invariant maintained throughout a call is
available to this source. A fifteen-minute Free-plan receipt was considered and
rejected as sufficient admission: the account or binding could become billable
while it remained fresh. This revision deliberately has no receipt parser or
operator enable flag. There is no allowed-route evidence/expiry to publish.

The message tells staff to use manual controls. Existing Staff CRUD, caregiver
portal, viewing history, and confirmation/discard of already-produced drafts are
unchanged. The server-only function mapper used by existing website-job
materialization remains: it turns an already-validated proposal into an owned
draft and never calls a provider. Function identity cannot be sent in JSON or a
Pages environment string; request bodies do not select a server mapper. This is
an existing trusted internal injection contract, not a free-plan exception for
client requests. Existing HOLD/idempotency/snapshot/confirmation safeguards and
rows remain untouched. New external job requests are denied even if a function
mapper and website-job flag are present.

The old pure mapper/conversation modules retain their protocol functions for
inert tests; the HTTP dispatcher no longer passes them any AI binding, gateway
URL/key or model override. The dispatcher has no call to create a new website
job. Low-level job protocol code remains for existing owned jobs and inert tests.
ASR refuses before touching audio or environment bindings. No client JS, CSS,
schema, configuration, provider credential, subscription or deployed flag is
changed by this PR. Provider inference resumes only with a later reviewed source
admission, not by bypassing the current denial.

## What would justify a later admission

CT5 must provide an exact environment/account/binding/route/model/cost basis,
authoritative provider proof of a free-only hard stop maintained **throughout the
call**, an explicit validity interval and a change interlock. Root41 must review
that basis and the narrow source admission independently. A sampled dashboard,
account-plan attestation, model name or local counter does not maintain the
invariant. If it cannot be established, the route stays unavailable.

CT5 is responsible for invalidating any future eligibility **before** an account
plan, binding, route, provider billing mode or model changes. The safe sequence is
deploy denial/revoke admission, account for in-flight calls under the old proven
boundary, record the disposition, and only then change the provider. Root41 owns
release readback and joined acceptance. If that ordering or in-flight protection
cannot be enforced, no future receipt can authorize a call. This source neither
polls billing nor detects a concurrent provider plan change. It makes no claim of
automatically maintaining a plan invariant or of safe inference on a Paid account.

Cloudflare [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
describes a daily Free allowance with failures at Free limits, Paid overage
billing and prepaid AI Gateway credits. An AI binding alone does not prove the
effective plan/billing mode. [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)
are eventually consistent and can overshoot under concurrency. Alerts, frequency
limits, token caps and counters are not an exact zero-paid guarantee. This PR
does not alter a shared plan or claim to cap non-inference platform costs.

## Acceptance and recovery

The inert HTTP matrix requires0 AI binding reads, DB accesses, provider fetches,
audio reads and new external job dispatches for missing/unverified/fresh/stale/
wrong-account/paid/shared/prepaid metadata, explicit/implicit gateways, unknown
backends and model overrides. It covers chat, both guided route families,
Content/Form/Caregiver/Event/Grant, direct/router ASR and new jobs. Authentication
denial and body size boundaries remain. Because admission is always denied,
quota exceptions and retries are unreachable through provider-backed HTTP routes.

Existing pure mocked mapper and domain/confirmation tests retain envelope,
schema, original audit, preview and discard behavior through a clearly named
test-only provider fixture. They are not evidence that HTTP inference is allowed.
Existing website-job tests exercise all five already-produced materialization
areas with0 AI calls. No live inference, real authentication, customer write,
billing change, browser acceptance or deployment is part of these checks.

Recovery must preserve denial: roll forward this small boundary onto the
qualified installed source when other release changes are needed. Reverting to
the previous inference-capable source without separate Legacy-only provider
containment would reopen the cost gap. Never change subscriptions, retry a held
job, consume prepaid credits or raise a budget to restore AI availability.

Capability stage: source assessment + runbook -> small deterministic HTTP cost
boundary with inert acceptance tests. Source/CI, installation, provider plan
verification and client acceptance remain separate. All publication and recipient
access receipts belong in Legacy54; Projects updates use root41/sole18.
