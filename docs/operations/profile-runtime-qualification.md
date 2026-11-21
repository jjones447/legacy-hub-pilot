# Profile runtime qualification plan

[pc2-codex-ct-13], Nov21 08:49 UTC. Product source/schema/privacy at aa05e5f
has retained functional and Security source approval. This test adapter is a separate
review delta; source approval is not permission to claim native TEST completion.

## Chosen first mechanism

`tests/runtime/profile-qualification.mjs` starts only local workerd, bound to127.0.0.1,
with a newly created private scratch directory and a fake D1 identifier. Its fixed
Wrangler commands contain `--local`. It imports the unchanged Profile handlers through
`profile-worker.mjs`, serves the actual caregiver form controller and CSS, and permits
only Profile GET/POST and three static asset paths. There is no mint, login, verify,
staff or provider-control route. The adapter refuses nonloopback requests, wrong fixture
markers and any email key or preview-mail opt-in. Shared-preview configuration is untouched.

The runner creates two fictional caregivers and one archived fixture in new local D1.
It generates a random fixture-only signing secret, writes it only into a0600 config
inside0700 scratch, and signs short-lived owner cookies offline in memory using the
existing session format. Neither cookies nor secret are logged. Provider credentials
and inherited environment-file loading are excluded. No production secret/session,
existing caregiver record, live email or Cloudflare account operation is used.

Local browser execution uses separately installed, locked Playwright1.65.1/Chromium;
the browser routes only to the owned loopback origin. The planned assertions cover
partial save/reload, owner isolation, invalid/expired/archived cookies, forbidden owner
selectors/cross-origin writes, revision conflict, readback reconciliation, contact
transition, second-owner resume, storage absence and mobile width. Known-success GET
reconciliation is explicitly not an injected transport-loss result. Existing SQLite/DOM
rollback and staff-projection evidence remains separate until tested through an appropriate
runtime composition.

This is **local persistence and browser qualification**, not hosted Pages/D1, Access,
actual sign-in/mail, full portal navigation or screen-reader acceptance. The fixture's
separate environment marker is confined to the test adapter; it does not modify the
shared-preview portal guard or introduce a product authentication exception. Fixture
files are outside both site allowlist and Pages functions; no deploy command is provided.

## Current capability and next checkpoint

Playwright1.65.1/Chromium159.0.8154.6 and user-space shared libraries are installed.
The reviewed b2ce83ad fixture passed authentication/route refusals, then its browser
stopped before the first save: first missing libraries, then font initialization.
The successor supplies a fixed tools-only fontconfig file to the browser environment;
fonts and configuration remain under `/workspace/profile-browser-tools`, with no system
installation. SAME ct12 reviews that environment delta before execution. No completed
Profile browser/persistence result is claimed. Wrangler4.139.0 is pinned.

Next checkpoint: **Nov21 09:30 UTC**, exact reviewed adapter source plus actual browser
capability/local persistence outcome, or precise remaining error. SAME ct12 reviews
this delta before the fixture is executed. The already closed Profile product source
review is not being redispatched.

## Hosted TEST remains a separate gate

Hosted TEST must pin exact deployment/origin, isolated D142be536c, pre-migration bookmark
and inventory, apply reviewed0022 once (never reapply0021), preserve existing rows and
qualify owner sessions plus staff role restrictions through the deployed composition.
No installed no-mail owner-session route has yet been qualified. Local fixture cookies
must never be copied into the hosted portal. A supported hosted fixture mechanism needs
separate retained review and custody evidence; enabling the shared-preview mail opt-in
alone is not authorization or proof. Actual login/mail qualification remains explicitly
out of this persistence fixture. TESTNov22 23:59 remains conditional.

Synthetic scratch and results are retained after execution. Stop only the owned local
runtime/browser; do not delete shared state or perform automatic destructive rollback.

## Nov21 09:22 checkpoint: proposed hosted boundary (not installed)

The reviewed local fixture executed at59d8f686. Read-only inspection of its retained
workerd D1 storage confirms owner A revision4, no owner B profile row, exactly four
revision-only audit payloads (1 through4), and exactly one generic follow-up created
at revision3 and now dismissed. This supplies local database witnesses for the
contact transition; it is not hosted D1 or an injected rollback/transport-loss result.
All earlier browser assertions completed; a remaining owned esbuild handle required
explicit cleanup, so the process result was143 rather than a clean-zero exit.

Proposed next package uses the existing legacy-hub Pages project, a dedicated fixture
preview branch/alias, the already isolated TEST D142be536c and a separately bundled
advanced-mode test worker. It must not deploy the product's whole Pages functions
or change production, canonical staging, existing preview authentication or any
existing secret. No additional Access app, account, service token or agent is proposed.
This plan requires retained Security review before implementing/deploying the wrapper.

The fixture worker would expose only fixed form assets and Profile GET/POST. It must
check actual preview environment, exact deployment-specific allowed hostname/origin,
expiry of the fixture window, method/path and a compile-time set of two newly reserved
synthetic owner IDs plus one archived negative ID. A decoded cookie owner allowlist
is only an additional prefilter: the unchanged handler must still verify the HMAC,
expiry, current eligibility, same-origin write and revision checks. All other caregiver
IDs, login/me/verify/mail/staff/publisher/mint routes and arbitrary assets are refused.

Use a newly generated fixture-only secret retained in a private0600 executor file and
one new preview-only binding named PROFILE_FIXTURE_SECRET. It must never replace or
reuse PORTAL_TOKEN_SECRET. Before any binding update, preserve the existing preview
configuration and verify all existing values/bindings remain unchanged. Source must
refuse deployment to production; the deployed source, environment, TEST database and
origin are independently read back before any fixture write. The deployment-specific
origin is established from actual provider output, never guessed or carried from the
publisher's qualified preview. No secret/session values enter source, logs or GitHub.

The adapter passes an explicit, minimal environment to the existing Profile handlers:
TEST database, fixture-only signing secret, Profile enabled and a fixture-only marker.
It must not forward inherited email keys, preview mail flags, production portal secret,
Access credentials or other provider bindings. That marker is a deliberate isolated
fixture composition, not a change or qualification of the shared-preview guard. The
product portal remains disabled in shared preview. The final cookie is offline-signed,
short-lived and bound by browser custody to this actual fixture origin; no public
mint endpoint or actual login/mail claim. Browser GET/POST traffic stays on that origin.

Migration0022 is additive and already source-reviewed, but remains UNAPPLIED. Before
applying once: verify TEST identity, capture a supported D1 bookmark plus table/row
inventory, confirm0022 absent and0021 present, and stop on ambiguous schema state.
Create only collision-checked, explicitly fictional fixture caregivers; preserve all
existing rows. Keep a retained exact synthetic-ID manifest. Native witnesses must
cover save/load/resume, owner isolation, revisions, conflict, generic follow-up/audit,
eligibility changes and fresh readback. A scoped audit-failure injection needs its own
reviewed synthetic-only trigger and confirmed removal; do not infer rollback from the
local SQLite test. Do not repeat writes after unknown outcomes.

Staff qualification is still distinct: do not mint a fake human Access actor or grant
the publisher staff-edit authority. The existing staff-projection tests and local DOM
results do not close actual human-session/full-portal qualification. Preserve this gap
explicitly if the bounded owner persistence fixture is accepted first.

Concrete capability/custody gap: current executor can use the delivered ops credential
for the existing Pages/D1 account, but this advanced-mode bundle, per-preview fixture
secret/configuration preservation, actual origin and synthetic-owner prefilter have not
yet been implemented or qualified. No hosted fixture cookie has been created and no
binding/migration/deployment has been changed for Profile. Retained ct12 must accept
or correct this isolation design, then review the exact adapter before execution.
The Nov22 23:59 actual TEST commitment remains conditional. This packet delivers the
Nov21 10:00 mechanism/witness checkpoint early; it is not hosted TEST completion.

## Nov21 11:00 packet: exact hosted adapter, inert source

Retained Security design acceptance is PR381 comment7060534707. The implementation
is in `tests/runtime/profile-hosted-{manifest,boundary,worker}.mjs`; the independent
build entry is `tests/runtime/build-profile-hosted.mjs`. Product handlers, shared
preview guard, schema candidate and public site allowlist are unchanged.

The checked-in manifest has **null origin and window**. Its compiled worker returns403
before reading any environment binding. Three public synthetic IDs are proposed in
that manifest; they are NOT yet reserved or collision-checked in TEST. No fixture
secret, signed cookie, provider config, migration or deployment has been created.

The active boundary, exercised only with a fictional unit-test manifest, requires:

- A single exact HTTPS `profile-fixture-*` alias under the existing Pages project,
  preview environment and a source-pinned window of at most one hour. No wildcard,
  production/default host, runtime env activation or caller-selected manifest.
- Exact Profile GET/POST path without query, matching supplied Origin and no cross-site
  fetch. POST requires Origin. Before DB access, a bounded, uniquely named session
  cookie must contain one pinned owner, canonical timestamp within five minutes and
  the fixture window, and a hex signature. This is only a prefilter; the unchanged
  handler verifies actual HMAC/expiry/current eligibility before Profile access.
- A fresh64-hex fixture-only secret. Only LEGACY_DB, that secret mapped to
  PORTAL_TOKEN_SECRET, the fixture environment marker and Profile flag reach handlers.
  Request forwarding strips unrelated cookies, Access credentials and authorization.
- Four fixed asset routes, no fallback, no public mint/login/staff/publisher route.
  Asset fetches carry no request headers/cookies. Responses are no-store and have a
  restrictive same-origin CSP. Exceptions are not serialized or logged by the adapter.

Attached preview secrets remain runtime capabilities. Isolation is code-enforced
non-use/non-disclosure, not capability-level absence. Unit sentinels assert fake
production/mail/provider secret getters are never read, only the four safe env fields
reach real handlers, secret headers are stripped, and no outbound fetch/log/response
contains those sentinels. Real handler SQLite tests cover valid save/readback, owner
isolation, stale revision/foreign selector refusals, invalid HMAC and current archive
revocation. Early denials cannot even read DB or asset bindings. This does not establish
hosted D1 atomicity or actual browser/login/staff qualification.

Build with locked esbuild0.28.1 (from existing Wrangler lock), no network or credentials:
`node tests/runtime/build-profile-hosted.mjs`. It creates a new private0700 scratch and
six0600 files: `_worker.js`, `_routes.json`, `index.html`, `caregiver-profile.js`,
`styles.css`, `fixture-start.js`. The routes file intercepts all paths, excluding none.
The bundle has no external imports; its input inventory and SHA256 file hashes go to a
private sibling receipt, outside the deployable asset directory. No source maps, config,
session manifest, tooling or secret files are copied. The independent build test imports
the emitted worker and proves its inert403 behavior. This is a local artifact test,
not a hosted deployment. Unit CI needs no esbuild installation; the separate build test
requires the existing locked build dependencies.

### Exact execution gates after adapter review

1. Using existing delivered ops custody, read the existing project, preview configuration,
   deployment environment and TEST D1 identity. Retain raw configuration only in private
   executor storage; record sanitized identities and per-field preservation comparisons.
   No rotation, read/reuse of the existing portal signing key, or production change.
   Require PROFILE_FIXTURE_SECRET absent; an existing binding requires custody
   reconciliation, not replacement or silent reuse.
   Confirm the three proposed IDs absent across caregiver/Profile/audit/follow-up records;
   if occupied, stop and return a new reviewed manifest rather than adopt an existing row.
2. Stage this exact **inert** advanced-mode artifact on one dedicated fixture preview
   branch. Use a private deployment config constructed from verified current preview
   nonsecret configuration and bindings, not the product root config or production branch.
   Do not silently replace preview vars/bindings with defaults. Read actual provider
   deployment/source/env/TEST-D1 and returned alias, then prove inert403. Do not guess
   the alias or enable a wildcard while discovering it. Alias must match the fixed
   prefix restriction; a different actual provider result requires review, not widening.
3. Prepare a successor source manifest with only the provider-returned stable fixture
   alias, at-most-one-hour future execution window and collision-qualified fixed IDs.
   Send exact source/artifact hashes plus config-preservation/collision/readback evidence
   to SAME ct12 before activation. The alias is pinned across the successor deployment;
   the initial inert deployment URL is never treated as the active deployment. Keep the
   deployment inert while preparing the reviewed binding/schema/owner prerequisites.
4. Generate one fresh32-byte secret locally in a private0600 file, independently of all
   existing keys. Add only PROFILE_FIXTURE_SECRET to **preview**, preserve every other
   project setting and read back the secret binding's presence/type, without printing
   its value. This new binding is project-wide for future preview deployments, not
   branch-scoped; disclose that impact and keep existing previews/product guard intact.
   If supported tooling cannot preserve the existing configuration exactly, stop with
   that specific gap. Never put the secret in source, CLI arguments or public receipts.
5. Before migration, use the installed Wrangler4.139.0 supported D1 Time Travel bookmark
   read (`/accounts/{account}/d1/database/{TEST_ID}/time_travel/bookmark`) and schema/row
   inventory. Retain the actual bookmark privately. Verify existing People0021 installed
   state from its prior receipt/schema, without applying it again. Require Profile0022
   table absent; an existing/ambiguous table requires reconciliation. Apply only the
   reviewed additive candidate0022 once, then read back its schema and prior-row inventory.
   No broad migration runner, replacement DB, destructive restore or automatic rollback.
6. Seed only the exact collision-qualified fictional owners; retain a private manifest
   of original row state/operations. Deploy the reviewed active successor, verify actual
   source/alias/env/TEST bindings and unchanged unrelated configuration, then sign
   five-minute cookies offline with the new secret,
   capped by the source window. Browser custody is private and confined to the exact
   alias; server origin/window gates supply the scope, not cookie custody alone.
   Exercise the existing owner persistence/refusal/revision/contact plan, with original
   revision GET reconciliation after unknown outcomes. A native audit-failure trigger
   remains a separate exact reviewed SQL change; none is included/applied in this packet.
7. On completion or failure, disable with an inert successor or let the fixed window
   expire, then read back denial/no-write behavior. Retain evidence and synthetic rows;
   do not delete unrelated preview configuration or restore a whole database after
   answers exist. A secret cleanup must preserve all other preview bindings.

Provider deployment/config-preservation support, actual alias, collision clearance,
bookmark and migration are still execution gates, not claims made by this source packet.
No public synthetic-session minting, real mail, human staff actor substitution, or
production Profile enablement is authorized by a passing unit test. Full portal and
human staff qualification remain separate. Actual TEST Nov22 23:59 stays conditional.

## Nov21 12:00 preflight packet: inert installed; active candidate awaiting review

Retained ct12 source approval381c7061241768 cleared only exact7654b816 inert staging
and read-only preflight. That artifact is now preview deployment
cc060827-f5d5-4959-8213-388a23d4f43f, completed11:20:23.67998UTC. The provider returned
`https://profile-fixture-381.legacy-hub-5qo.pages.dev`; this actual stable alias is the
active candidate's only accepted origin. Actual deployment source/preview marker and
TEST42be536c binding are verified. Root/Profile/login/script GETs each returned the
expected no-store403 JSON. No fixture session, Profile table or native Profile write.
Sanitized evidence and six artifact hashes: `profile-qualification/2026-11-21-inert.json`.

Configuration disposition: locked Wrangler ran from private artifact scratch, without
any discovered config and with `--no-bundle`, inheriting verified dashboard settings.
This avoided reconstructing or forwarding existing secret values. Readback caught
Pages clearing only preview `wrangler_config_hash`. Execution stopped; vars/bindings
and production were independently equal. A single narrow PATCH restored the exact
prior hash, then full `deployment_configs` equality and unchanged canonical production
were verified. This temporary management-metadata drift is retained, not reported as
an entirely mutation-free deployment. For the active candidate, use a private config
with only the verified preview plain vars/bindings/settings, preserve both before/after
snapshots and reconcile the expected source-config hash separately; never copy secrets
into config. Do not repeat the config-less metadata-clearing path without disclosure.

TEST preflight captured the supported Time Travel bookmark,16 application-table counts,
current schema, and zero collisions for all three pinned IDs/emails, audit actor/entity
and follow-up owner/external_ref. Profile table absent. People `is_caregiver` column
already installed;0021 is untouched. Two oversized combined inventory SELECTs failed
with provider7500/too-many-terms before any write; individual COUNT queries succeeded.
The Pages list read rejected per_page100; per_page25 succeeded before the single deploy.
These were read corrections, not write/deployment retries.

Active candidate changes only source manifest origin/window (Nov21 **12:00–13:00UTC**),
boundary test wording/explicit outside-window test, build receipt wording, this evidence
and the exact three-row `tests/runtime/profile-hosted-seed.sql`. The six-file artifact
allowlist excludes that SQL, all config and all session material. Production product
Profile flag remains OFF. No active bundle is deployed by committing this candidate.

Request SAME ct12 scope disposition for the exact active successor and following staged
steps: generate fresh private32-byte fixture secret; add only preview PROFILE_FIXTURE_SECRET
while preserving all existing config; refresh TEST identity/collisions/bookmark/inventory;
apply exact reviewed candidate0022 once; seed exact three fictional rows; deploy active
artifact on the already observed alias and verify source/env/TEST/config; only within the
pinned window run synthetic-owner persistence/refusal/browser tests using offline five-minute
sessions. Current native D1/bookmark capability is demonstrated; later mutation/installed
claims are still absent. No additional token/Access app/customer ask. No production session,
login/mail or staff-actor simulation. A native audit-failure trigger still needs separate
exact SQL review and is not part of this activation request.

At expiry require fresh API denial and unchanged synthetic profile/audit/follow-up counts.
Keep the original deployment and before/after records. Do not delete answers, restore the
whole DB or silently extend the window; any successor window needs a new exact source
receipt. Native persistence can qualify the bounded owner fixture; full portal/current
human staff/login/mail acceptance remain separate. Reviewer Node22's SQLite warning
caused its initial sentinel-log assertion failure (38/39), then39/39 passed with that
warning disabled; author/hosted Node24 runs passed unflagged. This portability difference
is recorded and does not change the non-disclosure assertion or native qualification.


### Native setup correction before activation (Nov21 11:28UTC)

At reviewed e406d0ec, the fresh preview-only fixture binding was added with exact
unrelated configuration/production preservation. Fresh TEST identity, collisions,
bookmark and all16 prior-table inventories passed. Candidate0022 applied once and its
six-column schema/empty table were read back. Do not repeat either completed step.

The three-row seed then failed atomically: installed People0021 constrains is_caregiver
to nullable TEXT `yes`/`no`, whereas the first seed incorrectly used integer1. Explicit
native readback found ZERO proposed owner rows. No retry or active deploy/session took
place. This successor changes only those three operands to `yes` and the SQLite seed
test to the actual installed TEXT CHECK constraint. Product/boundary/window unchanged.
The existing0021 column must not be altered to accommodate the fixture. SAME ct12 must
carry scope to the corrected exact seed before its one reconciled execution. Refresh
zero ID/email collision state, verify0022 remains empty and preserve all original table
counts (except expected three new caregivers). Secret and0022 receipts remain valid;
no reapplication or secret rotation is proposed.


### Hosted synthetic-owner result and disable (Nov21 12:25UTC)

The retained Security scopes381c7061877096/7061909961 authorized exact34846454.
It was installed as efcb1ecb-846e-4d58-8123-5a36209c19b0 on the pinned fixture alias,
preview/TEST42be536c. Native execution **PASS 12:21:19–12:21:28UTC**: Chromium partial
ZIP save, reload and new-context resume; owner B remained blank; invalid/expired/
wrong-HMAC/archived/outside-owner refusals; route, origin, body-owner and type refusals
with unchanged records; revision race yielded exactly200/409; stale write preserved
all witnesses. Contact Yes created one generic follow-up; No dismissed it. Final owner
A revision4, audits213–216 containing revision1–4 only, one follow-up23 dismissed.
No browser local/session storage. Evidence: `profile-qualification/2026-11-21-native.json`.

First transport run aborted on a protected-route redirect before writes; empty native
witnesses were reconciled. Corrected transport classified staff/publisher302 as outer
Access admission refusal, NOT an inner authorization proof. The successful second run
exited zero and closed Chromium. GET after successful POST is reconciliation coverage,
not an injected lost acknowledgement. No native audit-failure SQL was introduced.

Disabled at **12:22:04UTC** by deploying previously reviewed inert7654b816 on the same
fixture branch: **bbf8be2a-1c73-46e1-a245-17a1082a241f**. Provider source/environment/
TEST binding/alias verified; exact configuration and production canonical106ce7c5
preserved. At12:24:53, newly signed Profile GET/POST and root returned403 no-store;
complete synthetic Profile/audit/follow-up witnesses exactly matched final saved state.
Records retained. No migration/reseed/secret rotation or native operation replay.

This closes the author's bounded hosted owner persistence/refusal execution and disable
steps, subject to SAME ct12/Devin4 evidence assessment. It does not qualify full portal,
current human staff, real login/mail, all fields/accessibility, or native audit-failure
rollback. Product remains OFF in production; shared preview guard unchanged. Do not
silently extend the window or rerun the completed native sequence. Any additional
runtime scope needs its own precise qualification plan and retained review.


### Retained runtime verdicts and remaining work (Nov21 13:25UTC)

Both retained reviewers accepted the completed bounded fixture: functional
[54c7062576333](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-7062576333)
and Security [381c7062578263](https://github.com/jjones447/legacy-hub-pilot/pull/381#issuecomment-7062578263).
Security explicitly leaves no additional gate or rerun for that scope. Four hosted
checks also passed at evidence564f8b6f. Disable403 is the fixture boundary's
`fixture_unavailable`, not proof of the product feature-flag404 branch; the preserved
response body identifies the fixture refusal. Protected staff/publisher302 remains
outer Access only. No provider replay or expiry probe is needed.

The following is a proposed follow-on qualification plan, **not execution approval**.
Keep product handlers unchanged and the currently deployed fixture inert. No renewed
window, new route, database injection or existing owner mutation is activated here.

1. Native audit atomicity: reuse only fictional owner A at observed revision4, with
   a fresh exact Profile/caregiver/audit/follow-up snapshot and TEST identity check.
   Require no pre-existing trigger of the candidate name. Candidate SQL is:

   ```sql
   CREATE TRIGGER profile_ct13_audit_fault_20261121
   BEFORE INSERT ON audit_log
   WHEN NEW.actor = 'profile_ct13_20261121_a_571d390c'
     AND NEW.action = 'portal.profile_saved'
     AND NEW.entity = 'caregiver_profile'
     AND NEW.entity_id = 'profile_ct13_20261121_a_571d390c'
   BEGIN
     SELECT RAISE(ABORT, 'profile_fixture_audit_fault');
   END;
   ```

   After separate exact SQL/artifact/window review, a single revision4 contact-Yes
   request must produce generic500 with no answer/SQL disclosure and leave the full
   snapshot unchanged (including no new follow-up). Read original state on any unknown
   acknowledgement; never replay the write. Remove only the exact reviewed trigger:
   `DROP TRIGGER profile_ct13_audit_fault_20261121;`, then independently query
   sqlite_master for absence and compare unchanged records. On unknown CREATE/DROP,
   inspect sqlite_master before any corrective action. Do not restore the whole DB,
   delete audits or rerun0022/seed. Trigger failure/cleanup must be finally-protected
   in the reviewed executor. This candidate has NOT been installed.

2. Native mid-request ineligibility: a separate reviewed test-only adapter may wrap
   the native D1 binding immediately before the unchanged handler's batch call. It
   must first verify the exact fictional owner and expected revision, issue one
   guarded native status transition for that owner, then call the original batch.
   Expect409 with unchanged Profile/audit/follow-up state. Restore only that owner's
   original status using a guarded predicate and independently read back. Review must
   cover exact SQL, one-use server-side selection, no request/body-controlled hook,
   owner/alias/window fences, cleanup and no real records. No fake staff actor and no
   timing-based concurrent guess count as proof. Initial-revision0 and existing-row
   cases need separate pinned fictional operands; do not overwrite A's evidence.
   The adapter and its source tests remain to be authored/reviewed.

3. Lost acknowledgement and form coverage: a reviewed browser transport can discard
   the response only after observing a successful original save internally, then let
   the UI reconcile by GET without replaying POST; distinguish injected transport
   loss from D1 transaction acknowledgement uncertainty. A later reviewed fixture
   window can exercise all current option/conditional fields, read-only email,
   validation focus, keyboard flow and accessible labels with fictional data. No
   widening of the expired12–13 window is implied.

4. Supported full portal and staff composition: the fixture cannot supply this.
   Ordinary preview portal entry is gated by `isPreviewMailOptIn`; enabling it can
   enable actual transactional mail when the platform key is present. Existing
   publisher service custody does not grant `confirmationActor`: the middleware
   requires a verified human Access identity and current active staff_member role.
   The unresolved custody is a legitimate supported test owner entry and current
   human admin/ordinary-staff sessions, plus an authorized role-change operator for
   downgrade/no-cached-disclosure checks. Do not expose sessions, fabricate actor
   proof, repurpose publisher tokens, enable preview mail, or alter real staff roles.
   Existing lead/custodian route must identify that supported method or retain this
   precise gap. No new customer/account/credential request is created by this plan.

The author will prepare the exact synthetic fault/race adapter and local checks for
SAME ct12 review by Nov21 15:00UTC, with an explicit blocker if the design cannot
preserve the above fences. This is a source-package target, not a new hosted window
or a promise of full-portal completion. Retained Devin4 owns functional acceptance;
actual broader TEST Nov22 23:59 remains conditional on these remaining scopes.
