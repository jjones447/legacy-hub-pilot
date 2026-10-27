# Staff chat source correction

[pc2-codex-13] October 4, 2026. This is a Phase 1 D7 frontend correction candidate, not installed or client acceptance evidence.

The previous Content branch returned a canned preview without calling an API or obtaining a draft ID. Event requests sent a null target even when an event was selected. The shell had no Forms choice. Existing API tests did not execute these browser functions.

## Using the corrected candidate

The existing shell gains a Forms choice and a labeled published-item selector when JavaScript initializes. Content and Forms list only published items loaded from `/api/staff/content`. Forms is limited to existing `page_section` items whose IDs start with `ps_form.`; it edits form copy and existing options, not submission schemas or participant data. Content excludes those forms. Select a target explicitly; no target is guessed and no new content item is created by this correction.

Content and Forms request `/api/agent/draft`, show the returned full draft and retain its `draft_id` for `/api/agent/confirm` or `/api/agent/discard`. Before is explicitly labeled as last-loaded published copy, not a server-verified concurrency snapshot. A refusal, failed response or missing durable ID offers no confirmation. The existing APIs continue to enforce validation, authentication and audit behavior; this frontend change adds none of those guarantees.

Caregiver and Grant retain their selected-record workflow. Event now supplies the selected event ID and renders an Event preview. With no selection it asks staff to select an event; new-event creation remains in the existing New Event form. These three areas retain `/api/agent/change/*` and `change_id`. Both discard routes require successful HTTP and JSON results before claiming success.

`staff.html`, generated templates, CSS, backend functions, schema, credentials and provider settings are unchanged. Dynamic controls avoid the HTML/CSS paths retained by the original PR161 author. The source correction does not take over the existing runtime operator's custody.

## Verification and remaining acceptance

`node --test tests/staff-chat-wiring-d7.test.mjs` executes the actual browser functions with a synthetic DOM and mocked fetch. The original main source fails 15 of 19 tests; the correction passes all 19. The seven-file selected D7 suite passes 88 tests on local Node26.2, with no failures or skips. This is not Node24 parity, actual browser layout, signed login, Cloudflare D1/workerd or provider acceptance.

The existing operator must verify the exact installed source and bindings, readable controls at desktop/mobile widths, available published items and mapper, and a representative draft → preview → confirm → publish → audit operation in each of the five areas using an approved isolated synthetic fixture. Include discard/refusal cases, current authentication, before/after target correlation and the recorded audit actor. Content concurrency/rollback semantics and installed backend behavior still require their own evidence; the cached Before label does not prove drift protection. Do not run customer-data writes, send client messages, activate reminders or bypass the held runtime-preparation command for this check.

Independent exact-head source review, integration, hosted CI evidence and installed runtime acceptance must be recorded separately. Until those steps and staff/client acceptance are evidenced, D7 and Phase 1 remain open.

## Workers AI Event mapper correction

[pc2-codex-13] October 5: the Workers AI workflow mapper previously refused Event while the gateway mapper supported it. The correction extends the existing mapper with create/update/publish/archive envelopes and reuses the canonical event field/type lists. It does not change bindings, event schemas, authentication, API routes or audit/application code. Content, Forms, Grant, Caregiver and gateway backend precedence are retained.

Existing Event requests must correlate the selected ID with the loaded record. Creation is only permitted for the explicit API target `new` with no current record and requires title, event type and valid start date; no mapper date or ID default is added. Optional IDs must occur in the request. Browser new-event creation remains the existing New Event form. The mapper refuses unsupported fields, malformed values and attempts to create over a selected existing event. Shared server event validation still governs dates/order, transitions, collisions and registrations before any durable draft is stored.

Publish/archive proposals require the respective explicit word in the request and reject common negated release instructions; a registration override also requires explicit `confirm_with_registrations=true` consent. These are deliberately conservative, reversible language defaults, not new access grants. Model instructions require refusal rather than invented missing dates, IDs or consent. Natural-language factual fidelity still requires staff preview; prompts, language checks and mock tests cannot prove model comprehension.

The existing draft → preview → confirm/apply → domain audit plus agent-change audit pipeline is unchanged. Named mock tests exercise existing/new Event mapping, refusal, validation, selected-record correlation, no domain writes during draft, confirmation audits, discard and pre-confirm drift refusal. This is source evidence only, not real inference, SQL atomicity, signed login, D1/workerd, installed five-area or client acceptance. The runtime-preparation STOP and existing operator custody remain intact.

Current primary references: [Workers AI binding/run](https://developers.cloudflare.com/workers-ai/configuration/bindings/) and [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/). They inform the existing binding/envelope approach; no provider request, dependency installation or binding change was made.

## Content/Form mutation and original audit transaction

[pc2-codex-13] October 5: the four existing content-item write paths now batch their mutations with the original append-only audit. Targeted publication includes both the target update and draft archival in that transaction; new publication, direct editing and discard each include their existing mutation and audit. If an archive or audit statement fails, the entire mutation set rolls back, so a healthy retry retains the original before/after provenance. Existing validation, HTML rules, actor attribution, statuses, error payloads and cache behavior are preserved. Direct editing resets its content cache only after successful batch completion; publication/discard cache semantics are unchanged.

The existing `agent-editing-v0` regression fixture models D1 batch transactions with synthetic in-memory SQLite. Eighteen page/Form scenarios reproduced eight healthy controls and ten old-source rollback failures before the handler change. Regression coverage checks full content/audit snapshots (including actor, timestamp and draft state), untouched historical audits, generic errors without fault details, healthy retries, cache behavior and refusal to repair historical archived drafts. This is Node26 source evidence, not workerd, installed D1, concurrency or client acceptance. Pre-batch reads are not a concurrency/CAS guarantee; domain workflow confirmation is not made atomic by this correction. Identity/security design and historical records are not changed; no audit backfill or repair is performed. Discard retains its legacy literal `staff` attribution. Decoded-JWT fixtures test actor extraction only, not middleware signature verification or real authentication.

Primary contract: [Cloudflare D1 batch transaction rollback](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Governed domain mutation and original audits transaction

[pc2-codex-13] October 5: a separate stacked correction extends the existing shared domain `apply` functions, not the Content/Form correction above. Caregiver update; Event create/update/publish/archive; and Grant review/decision/course-complete/close now commit all operation mutations and their original domain audit in one ordered D1 batch. Grant award creation, delivery followup and close-time award outcome updates join the same transaction. Standalone REST callers use the existing default API; trusted server-side agent confirmation appends its original published-status/confirming-actor update and original confirm audit to that same batch. The fourth optional statement array is constructed by server code, not accepted from request payloads. Agent-change discard batches its existing status update and original audit together.

Existing validation, pre-confirm drift checks, registration refusals/explicit overrides, normalization, actors, transitions, response shapes and historical rows are retained. No schema, component, retry/backfill or historical repair is added. A failed statement within the write batch rolls back all of its mutations and audits; a healthy retry then uses the original draft and before/after provenance. Pre-read validation is still outside the transaction, so this does not establish concurrency/CAS safety. Caregiver/Event result SELECTs remain after the successful write batch: a post-commit read or response failure can still produce HTTP500 after a fully committed, correctly audited operation. Therefore HTTP500 alone is not proof of no commit; this change does not redesign uncertain-ack retry semantics.

The existing `agent-data-changes-d7` synthetic fixture exercises all nine apply branches through governed confirmation, standalone apply and REST, including awarded/declined decisions, close with/without an award, each write-stage fault, complete domain/change/audit snapshot rollback, healthy retry, original audit provenance, historical refusal, outcome timestamps and registration preservation. Existing consumer assertions remain. Tests use installed Node26/in-memory SQLite, not real workerd/D1, provider inference, verified authentication, installed five-area or client acceptance. PR176 Content/Form regions and fixtures remain preserved; runtime-preparation STOP and existing operator custody remain unchanged.
# Compact staff assistant presentation · October 15

[pc2-codex-42] The browser assistant is now an optional, collapsed-by-default
panel near the top of the staff console. Its open/close button announces state
with aria-expanded/aria-controls; opening focuses the composer, closing or
Escape returns focus, and loading the page does not steal focus. Closing keeps
the current input, selected target, draft preview and confirmation HOLD state.
It does not submit, discard, confirm, reset or invoke an API. The main staff
workspace has no reserved right chat column. On phones the composer, area/target
controls and preview actions wrap, with visible focus and 44px controls; tables
can scroll within their existing panels instead of widening the page.

The existing microphone button and transcription path remain. Recording cannot
be hidden by closing the panel; stop it with the microphone button first. A
delayed microphone permission response makes the panel visible before recording
starts. The content selector is labeled “Existing content to change”. Browser
edits retain the existing selected-area/target → draft → exact preview → human
confirm/discard flow. Slack is a separate entry point, not this panel's transport
or shared conversation. The separate human assistant-handoff panel is mounted
outside the collapsible browser chat so pairing/preview controls remain visible.
No staff agent receives new API, code, security, infrastructure or Cloudflare
administration permissions from this presentation change.

Source verification: 7 new disclosure/layout synthetic tests plus the existing
chat, human handoff and microphone tests pass (92 focused tests); all 1,593 unit
tests pass, zero failures/skips. Template parity via python build.py --verify
passes: staff.html is hand-authored by the existing build contract, and generated
public templates/HTML remain untouched. Tests cover keyboard/focus, responsive
CSS rules, preserving input/draft/HOLD, recording visibility and the independent
handoff mount. They are not visual browser, real microphone, workerd, live
workflow, deployed or client-acceptance evidence. This source-only change is
submitted for normal independent review/hosted CI, not author self-merge or
production deployment. Existing API/auth/schema, signing keys, Docker/runtime
custody, schedules and disabled Coming Soon/reminders are unchanged.

## Staff change-log coverage · October 27

[pc2-codex-1] The former recent-changes query intentionally selected only
content/caregiver actions and undo history. It therefore omitted existing event
create/update/publish/unpublish/archive and staff created/updated/first-sign-in
audits, even after a successful refresh. An unchanged staff Save also writes an
existing `staff.updated` audit; this correction does not create that audit.

The query now includes those exact event/team action-and-entity pairs. It keeps
the last 50 matching rows in descending audit insertion-ID order and returns the
original actor, time and before/after data. Unrelated authentication, provider
and diagnostic streams are not newly exposed. Event/team entries are read-only:
no Undo button is advertised for entities unsupported by the existing undo API.
Existing content/caregiver undo rules and audit writers remain unchanged.

Three new in-memory handler regressions cover real event create/publish and
unchanged staff Save, all eight supported added actions, provenance/preservation,
unsupported undo refusal, exclusions and the ordering/50-row bound. They fail on
the former query and pass after correction; all 1,830 unit tests pass. This is
source evidence, not a live-database diagnosis, deployed refresh or client
acceptance. No audit is invented, backdated, rewritten or repaired, and no
production request, fixture or provider operation is performed.

## Assistant request feedback October 27

[pc2-codex-42] A bootstrap fetch/body exception or the existing unavailable
identity guard now displays one plain status message in the Assistant panel.
It asks the administrator to check sign-in and the connection, and warns against
resending an earlier request whose result is unclear. Send preserves the input
and existing holds. No identity, authentication, bootstrap response classification,
backend selection, storage, retry or recovery rule changes.

The ordinary draft request now shows a pending message while its existing fetch
and JSON parsing are unresolved. That same message becomes the preview, refusal,
missing-preview warning or error. A lost response/body explicitly warns that a
draft may already exist and needs administrator review. No timeout, abort,
automatic retry, new submission lock, auto-confirmation or no-draft claim is
introduced. Explicit preview validation and confirm/discard remain unchanged;
the separately enabled isolated job lifecycle retains its existing deadline and
uncertainty protections.

Mocked UI regressions cover bootstrap transport/body failures, unavailable
actor/origin/redirect metadata, input/hold preservation, notice deduplication,
ordinary deferred fetch/body completion and success/refusal/malformed/error
outcomes. This is feedback source work, not proof of the live backend cause,
provider availability, deployment or five-workflow acceptance.
