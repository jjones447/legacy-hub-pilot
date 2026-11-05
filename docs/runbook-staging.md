# Staging surface — historical preview runbook

## Internal test-account exclusion guards and normal sign-in custody — November 5, 2026

[pc2-gemini-ct-5] Built on installed production baseline `#335` (`5e5565376070fdad727ac4f51d122846a1f91466`)
for [legacy-caregiver-hub#54](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-6661689963)
(`c6660164573`, `c6661314002`, `c6661689963`, `c6662974621`). Author/publisher: `pc2-gemini-ct-5`; independent
reviewer/support capacity: `pc2-codex-41`. Existing publisher (`pc2-gemini-ct-5`) and customer route (`pc2-claude-ct-2`)
own their authorized delivery routes without a `41` GO gate.

- **Existing internal QA caregiver records**: Both staging (`legacy-hub-db-staging` `42be536c-e354-44c7-b246-2dcac18d8ac6`,
  `source = 'qa_account_staging'`, `id_sha256_16: bd1f773d365d00b7`) and production (`legacy-hub-db`
  `3c06c3cb-e1a6-426c-ad85-0b8c94616ed2`, `source = 'qa_account_prod'`, `id_sha256_16: ccf784fe73941c36`) already
  carry dedicated non-person internal test rows (`first_name` prefixed `TEST - Legacy - ...`, `last_name = 'Caregiver - Portal QA'`,
  `status = 'inactive'`, `segment_tags` containing `qa_test`, `do_not_contact`, and `exclude_reporting`). No new
  D1 rows or backdoor login paths are introduced.
- **Source exclusion guards & internal Staff filter**: `functions/_lib/domain/caregivers.js` defines `isInternalTestCaregiverSql`,
  `notInternalTestCaregiverSql`, and `notDoNotContactCaregiverSql` matching the literal prefix
  `substr(LOWER(TRIM(COALESCE(source, ''))), 1, 3) = 'qa_'` or `segment_tags` JSON array entries `qa_test` /
  `exclude_reporting` (plus `do_not_contact` for outbound reminders), without matching ordinary `qa...` sources such as
  `qatar_referral`. Default customer counts and caregiver lists (`GET /api/staff/caregivers` unless explicitly filtered
  by an internal QA segment tag or the Staff Console `#caregiverSearchSegment` `Internal QA` (`qa_test`) option in `staff.html`),
  staff and public event registration counts (`GET /api/events`, `GET /api/staff/events`, `GET /api/registrations`),
  open follow-up queues (`GET /api/staff/queue`, `GET /api/followups`), grant application lists (`GET /api/grants`),
  staff wellness selectors and series (`caregiversWithCheckins`, `staffSeries`, `GET /api/staff/wellness`), staff recent
  changes (`GET /api/staff/recent-changes`), and daily wellness reminder selection (`dueCaregivers` in `workers/reminders/src/index.mjs`)
  exclude internal QA test accounts while preserving normal portal sign-in (`/api/portal/login` -> `/api/portal/verify` -> `/api/portal/me`),
  direct staff profile lookup (`GET /api/staff/caregiver/:id`), and existing `xcentric-test` sample tuples.
- **Normal sign-in mailbox custody**: Internal QA verification uses only the normal caregiver magic-link flow without
  any skip-login or token-minting backdoor. Inbound verification-link custody reuses the existing fleet
  `legacy-mailsource-graph` (`GraphMailSource`, Entra/Exchange `ApplicationAccessPolicy`-scoped read access to a
  dedicated internal QA mailbox or approved alias) with credentials stored only in Vault by name (`secret/agent/legacy-qa-portal-Staging`,
  `secret/agent/legacy-qa-portal-Prod`) and never printed in source, logs, or shared threads. Do not deploy a parallel
  Cloudflare Email Routing Worker broker. Mailbox provisioning, inbox-read grant, and email-policy decisions remain
  Jacob's specific decisions; source review does not establish live mailbox wiring or inbox-read permission.

## Production Staff usability and People Add join — November 4, 2026

[pc2-codex-42] Root41 selected a source-only compatible join of accepted production
Staff311 `db1b3d5a239e689589e956e251e020a404f1a52b` and standalone People Add314
`fb419b435ff35cbd08e5fa679a16b22976cf8cf4`. Both descend from cloud-main
`d810ef9c45b429214fe874ef09a23cb04d7dfbd1` (treeaaa493af), production-equivalent
to the recorded2099d83e source. This is not a new installed-state readback; the
existing publisher must requalify the actual package and rollback before a future
release. No equivalent combined production candidate or competing owner was found.

Design/reuse homes remain the existing Staff disclosures and People search/record
UI, caregiver domain create and Staff API.42 remains author,41 independent reviewer
and release owner. Preserve both accepted runbook sections below as their original
scope/history. Runtime joins are only Staff HTML/JS; native summary preferences
retain311's person/origin and activation guards, while Add retains314's four-field,
active-Staff, duplicate-read/write, atomic-audit and no-enrollment/no-send contract.
All original311 panel assertions remain. Its sliced fixture additionally loads
the accepted Add role-visibility helper now called by the joined team loader;
the initial missing-helper fixture failures were corrected without a no-op stub
or production change. A focused additional Add DOM case exercises both panel
choices and actual fake-handler caregiver creation together.

Production caregiver authentication, mail, AI behavior, schema/bindings, app.js and
public content remain the baseline. Public HTML changes only the stylesheet cache
query required by311 CSS. No QA-login configuration, MySupport, sample data, B1
registration/private projection, Help or322 provider-off is included. Do not infer
an AI availability decision from this separate usability package.

Progressive stage: reuse already-tested UI/domain operations and runbooks; this
increment proves their compatible source composition. Stop at source qualification
because Root41's packet expressly excludes deployment and real-person operations.
Next increment is independent exact-head review, then a separately selected current
package/target/rollback installation and authorized live acceptance. Existing unit
and isolated local DOM jobs qualify source only, not workerd, hosted pixels, Staff
sessions, production installation or client acceptance. No new service/module,
configuration, credentials, migration or runtime dependency is introduced.

Recovery preserves the prior production package. Any future UI/API rollback must
not delete valid people/original audits or clear peer sessions/preferences. Earlier
installed baseline claims in historical sections are not fresh release permission.

## Canonical user-facing addresses — October 30

[pc2-codex-41] Use `https://caregiversanctuary.org` for production and
`https://staging.caregiversanctuary.org` for staging, with `/staff` for staff and
`/portal` for caregivers on the matching environment. Staff Access and caregiver
email sign-in remain separate on these normal domains.

The provider alias `legacy-hub-5qo.pages.dev` belongs to the same Pages project.
The October30 source redirects ordinary GET/HEAD page visits on that alias and
`staging.legacy-hub-5qo.pages.dev` to their matching canonical domains, preserving
path and query. API/webhook traffic, asset requests, deployment-specific preview
hosts and origin-bound protected draft previews retain their existing routes.
No DNS, Access policy, binding or credential changes are part of that redirect.
See the existing delivery ledger for installed/browser verification.

`staging.legacy-hub.pages.dev` and `legacy-hub.pages.dev` are historical addresses,
not current entry points. The former was observed to stop at Cloudflare Access
before the app. An application redirect does not claim to remove that upstream
Access screen. Replace saved walkthrough links with the canonical domains; do
not remove protection or infer staging identity from an old hostname.

## Historical Current-use guard — October 13, 2026

[pc2-codex-41] This remains a historical preview runbook. The current private
caregiver guide names `https://legacy-hub-5qo.pages.dev/portal` as the production
email sign-in entry. `legacy-hub.pages.dev` and its preview examples below are the
old pilot, not current login instructions. A failure to receive email on that old
address does not establish a failure on the current entry.

The October6 private DNS/binding inspection superseded the October5 alias
interpretation below: `staging.caregiversanctuary.org` was identified as preview,
with `ENVIRONMENT=preview`. Preview email is intentionally disabled; it is not the
real-person email route. No current installed routing, mailbox delivery or staff
authentication is proved by this source correction. The existing admin/operator
owns today's diagnosis; do not enable preview email, seed users or repeat login
requests from this document.

Use the SAME private setup record and current caregiver guide for the actual
environment and permitted identity. Public site portal links are relative; they
retain the origin of the page being visited. Legacy helper defaults and the dated
commands below are not current release targets or permission to execute them.
Full Functions/native/served/Pages holds and original release custody remain.

## Historical October5 guard — alias interpretation superseded

This document preserves the August preview design and examples; it is not the current
release runbook. The September 29 Legacy account move is already recorded in the SAME
private customer setup records. The old pilot URLs below and the future-account-move
section are historical; no recreation or repointing is authorized by this history.

The observed `staging.caregiversanctuary.org` is a production alias, not proof of an isolated preview.
Qualify the exact account, project, source revision, deployment, environment and D1 name plus UUID
through the SAME private customer `Legacy Internal/Management/Legacy_Delivery_Tracker.md`
and `docs/operations/legacy-account-setup-record.md` before any write, deployment or practice.
Source configuration that names different databases is not installed-binding or isolation evidence.
The canonical private runbook and queue govern current release work; this public history does
not replace them or reproduce private Intake.

Deployment is manual in the recorded setup. Branch pushes and merges are not deployment evidence.
Jacob authorizes this seat or its designees to push and deploy through configured authorized
accounts; no additional Lead publishing approval is required. Target qualification is a technical
safety check, not another publishing-permission hold.

All command samples below are historical, non-executable examples for this correction scope.
Do not run the historical seed, restore, installation, workerd-download or broad test commands
as current instructions. There are no customer, production or shared-staging writes and no production restore
authorized by this document. Existing rejected runtime preparation remains STOP: no bypass, alternate retry or installation.
Any later isolated synthetic work needs its own current target and fixture qualification;
an old seed shortcut, alias or scratch label does not grant it.

Missing or skipped real-workerd evidence is UNVERIFIED, not accepted. Record
source, review, CI, runtime, deployed and client-accepted states separately.
Coming Soon and reminders remain disabled until Shanelle's go through Jacob is recorded for the respective action;
source integration or a deploy authorization does not imply client-send or health-data permission.

## Source test boundary — October 8, 2026

`npm test` and `npm run test:unit` select the non-workerd Node tests through
`scripts/run-tests.mjs`. They print **runtime NOT RUN**. The existing CI check
name is preserved, but its job summary explicitly excludes runtime acceptance.
This is a test-entrypoint correction, not clearance to execute previously held work.

October 12 source hardening: `scripts/unit-test-files.mjs` explicitly lists the
accepted unit inventory. Unknown test files and missing allowlisted files fail
before launch, rather than silently entering the unit suite through discovery.
Review additions for effects before changing that list; a filename or allowlist
entry is not runtime authorization or proof that a test is side-effect-free.

The separate `npm run test:runtime` selects only the required real-workerd harness.
Do not execute it until the recorded runtime-preparation rejection and incident
receive explicit disposition. Its opt-in environment marker is a mode selector,
not authorization. Direct broad-glob use without that marker fails before loading
Wrangler. The harness requires project-local Wrangler exactly matching the package
pin, never installs tools or discovers npm-cache copies, and cannot turn missing
tooling/startup failure into a skip. No dependencies were installed for this repair.

Prepared runtime source uses an explicit synthetic local D1 configuration (no
production IDs, AI or remote binding), and the existing site allowlist for assets.
It stops only the worker handle it obtained. Stop failures propagate; the owned
temporary directory is retained for diagnosis rather than deleted after an unknown
outcome. Unreturned startup handles still require operator disposition; this source
change does not establish lifecycle acceptance. No process-wide handle cleanup is
allowed. The installed dependency graph still needs qualification before execution;
an exact Wrangler version alone is not a fully locked dependency graph.

The encoded-link security assertion remains unchanged. Pure sanitizer evidence is
not evidence of real HTMLRewriter serialization. Required page roundtrip, row edit,
security and shutdown behavior remain **runtime UNVERIFIED** until actually tested.
Wrangler option review used the [pinned upstream dev API source](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.139.0/packages/wrangler/src/api/dev.ts)
and [official API documentation](https://developers.cloudflare.com/workers/wrangler/api/).

## Restore verification source — October 10, 2026

The restore script now compares every restored `audit_log` row and field against
the cached input snapshot, in ordered pages, before returning success. Audit IDs
must be unique safe integers before any target SQL. Changed fields, missing/extra
rows, truncated queries and failed or unavailable query results fail closed.
`auditVerification.verified` and `spotChecks.auditLogPreserved` mean equality to
the supplied audit snapshot only. If that table is omitted, both remain false;
historical partial snapshots retain row-count verification, not audit acceptance.

This does not authenticate a backup that was already modified, verify other-table
contents, provide a transaction across the restore or clear existing execution
holds. Use a trusted snapshot/manifest and an authorized isolated target; retain
separate installed-build, restore, monitoring and rollback evidence. Unit tests
exercise virtual fixtures/in-memory SQLite and captured transport only, not D1
or an installed remote restore. Existing STOPs and protected targets still apply.

## Historical August surface and URLs

**Staging:** https://staging.legacy-hub.pages.dev
**Production:** https://legacy-hub.pages.dev

Jacob promised Legacy a non-production site at the 2026-08-21 walkthrough — somewhere Shanelle
can try a change (a seasonal logo, new copy) and see it before anything reaches the live site.
The August design proposed that surface. Approach chosen by Jacob 2026-08-27: a named preview branch on the existing
Cloudflare Pages project.

## Historical example — deploy to staging

Non-executable history, not a current target selection or deployment instruction:

```
python build.py --verify
npm run build:site
npx wrangler pages deploy dist --project-name=legacy-hub --branch=staging
```
When the signed-in Wrangler session can see more than one Cloudflare account, export
`CLOUDFLARE_ACCOUNT_ID` matching the `account_id` in `wrangler.toml` before deploying, or Wrangler
may target the wrong account.
To seed or refresh page sections on staging: `node scripts/seed-page-sections.mjs --staging --remote`.
To restore a backup into a scratch drill database: `node scripts/restore-from-backup.mjs <dump-dir> <scratch-db-name> --remote`.


## Historical example — promote the same build to production

Non-executable history, not permission to deploy to production:

```
npx wrangler pages deploy dist --project-name=legacy-hub --branch=main
```

Deploy the **same `dist/`** to both. Do not rebuild between the two commands — that is how
staging and production drift apart while appearing to match.

## Historical verification example

The old alias and command below are historical, not current installed-release evidence:

A 200 proves nothing here: unknown paths catch-all to the homepage, and an unfollowed 308 looks
like an empty page. Always cache-bust and follow redirects, then check content-type and size:

```
curl -sL -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' \
  "https://staging.legacy-hub.pages.dev/?cb=$(date +%s%N)"
```

## Historical August rules

These rules describe the old pilot surface. Current URLs and client delivery must come
from the SAME private release records, not the two pilot URLs or branch names above.

1. **Never send the client a branch alias other than `staging`.** `v3-brown` and `v2-nav` are
   URLs of *retired mockups*. Both Jacob and Shanelle lost time to exactly that confusion during
   the 08-21 walkthrough. Only two URLs go to Legacy: production and staging.
2. **Deploying is manual.** Merging a PR ships nothing. There is no Git integration on this Pages
   project (`Git Provider: No`), so a merged change sits unpublished until someone runs the deploy
   command.
3. **Staging is public.** Cloudflare preview aliases are not password protected. Nothing
   confidential goes on it — this repo is public too.
4. **Every deployment keeps a permanent `<hash>.legacy-hub.pages.dev` URL** frozen at its content.
   They cannot be refreshed, only deleted. Unlinked and unguessable, but real.

## Historical broad-test and tooling examples

Do not execute these examples as this correction's test scope or as a runtime-preparation retry.

```
node --test "tests/*.test.mjs"
```
The old procedure for the workerd round-trip test (`tests/edge-rewrite-roundtrip-workerd.test.mjs`) said to ensure `wrangler` was available (`npm install` or global `wrangler`) and allowed a skip when the binary was absent. This is historical tooling guidance only, not installation authority or runtime acceptance; the current STOP and UNVERIFIED rules above govern.

## Historical future-account-move note — superseded by September 29 records

The move has already been recorded. The original note below is retained as history,
not a new account move, alias recreation, repointing or client-message instruction:

Recreate this branch alias in the new account and re-point anything referencing it. The staging
URL will change with the account; tell Shanelle before it does, not after.


## Production-based Staff panel candidate — November 3, 2026

[pc2-codex-42] This bounded presentation change reuses reviewed Staff306/310
panel markup, preference isolation and names on cloud main `d810ef9c` (tree
`aaa493af885cf9a45d5b3784c3d42f5d164c93c4`), identical to recorded production
source `f8d7361e`. The current deployment pin is from the existing November3
publisher receipt in private Legacy54 comment6606227728; this source work does
not make a fresh Cloudflare installation or drift claim. The release owner must
compare the actual current package before an authorized installation.

The existing Staff UI is the designated home. Alerts and Events replace the
old Needs attention and Upcoming events headings. The four main workflow panels
and conditional Attendance use native disclosures. Existing People, Change log
and Site content disclosures remain. The existing controls/IDs and all server
operations are preserved; no Help panel is added because production has none.

Open/closed booleans alone are stored per origin and hashed verified Staff email.
The saved personal choice wins, including closed Alerts with open requests. With
no saved choice, the first successful empty Alerts read closes it; a failed read
stays visibly unavailable. Failed/unknown identity cancels preference writes and
pending hashes without deleting another person's saved choices. Attendance opens
when an event is selected and is not persisted. The Legacy Assistant's independent
recording, drafts, HOLD and session state are excluded.

Local acceptance uses actual committed HTML in jsdom: clicking the actual summary
heading triggers its DOM default activation, and a reconstructed page restores
the same fixture person's choices. Tests cover person/origin separation, controls,
unknown identities, storage errors and list failures. Cold DOMContentLoaded tests
do not flush parser toggle events before initialization: preferences are saved
only after actual summary activation, in a post-dispatch task. Pending intent
fences automatic defaults; parser/programmatic/canceled toggles are excluded,
rapid activations retain the final choice and identity revocation cancels pending
writes. A forced pre-activation microtask checkpoint test covers the event-loop
schedule that ordinary scripted Element.click() does not model. jsdom is a locked **test-only**
dependency, installed with lifecycle scripts disabled only in the separately named
Staff DOM controls workflow. These tests live under tests/dom and are directly
selected outside the ordinary unit inventory. The main unit job, original no-install
guard and runtime dispatcher remain unchanged. jsdom is not imported or
included by the served application. No external page, browser process, layout,
customer session or login gate is involved. A 390px DOM context is not phone visual
QA, and `details.open` transitions are not proof of deployed pixel visibility.

Source test command:

```text
node --test tests/dom/staff-production-panels.test.mjs
node --test tests/events-d7-s2a.test.mjs tests/staff-assistant-disclosure.test.mjs tests/staff-team.test.mjs tests/test-boundary.test.mjs
python build.py --verify
```

Current stage: a focused source candidate and local control tests, with independent
review/hosted checks/installed acceptance separate. Next increment is the exact
reviewed package followed by an authorized own-Staff browser check: click Alerts
and Events, confirm actual rows hide/reappear at desktop/phone widths, reload with
the same Staff identity and confirm the choice. The prior Work-settings browser
denial remains NOT RUN; local DOM tests are not a bypass or a substitute for that
installed evidence. No deployment, merge, provider/mail, customer record, schema,
portal behavior or production approval follows from this candidate.

For rollback retain the prior package and original staff/session state. This change
adds no database state. Preference booleans can remain inert when rolling back code;
never clear unrelated storage, customer records or another person's session.
Root41 owns release and joined acceptance;42 authors this bounded source slice and
retains independent reviewer separation from the other author's My Support work.


## People & access Add action — November 3, 2026

Owner/author: pc2-codex-42; independent review and release acceptance: pc2-codex-41.
Canonical acceptance: [Legacy54 request6610139845](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-6610139845).
Stage: built source candidate with deterministic fixture evidence; not installed/live/client accepted.

Discovery/reuse: People search and the focused caregiver view already live in staff.html/staff.js.
The existing admin-only `createStaffMember` in functions/_lib/staff.js remains the staff writer.
The caregiver domain module supported updates but no record-only create. Public intake is unsuitable
because it enrolls or creates follow-up work. The new `create` operation therefore belongs in the
existing functions/_lib/domain/caregivers.js, reached only through POST /api/staff/caregivers.
This extends the proven UI/domain/runbook foundation; it adds no service or orchestration layer.

Add person sits beside Search people. Staff can choose Add caregiver record; active admins also
get a shortcut that opens the existing Add staff member form. The server retains its admin guard.
Caregiver fields are first/last name and email/phone only, requiring first name and one contact.
The server checks normalized email or common phone formatting against ALL record statuses before
creation and again inside the atomic insert. A match returns existing records for review, never
merging, updating or restoring their history. Shared family contacts can therefore need staff review;
this increment deliberately offers no duplicate override or automatic merge.

Creation writes one caregiver with default nonmember state and one original audit atomically.
It does not capture consent, enroll, grant staff access, send invitations or create follow-up work.
Current active staff authorization gates the insert, both duplicate reads and saved-profile read.
The browser-only endpoint requires exact origin, bounds JSON at4096 bytes and rejects extra fields.
Confirmed saves show the normal person view/list; refusals and unknown results preserve entries.
An unknown saved response can be recovered by contact search or duplicate readback without a second
record. Existing staff creation/role rules remain separate from caregiver identity.

Verification commands:

```text
npm run test:unit
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/dom/staff-people-add.test.mjs
python build.py --verify
```

Normal unit inventory explicitly includes people-add.test.mjs. The original main unit workflow,
no-install guard and runtime dispatcher remain unchanged. DOM checks reuse exactly the pinned
jsdom30.1.3 dependency/lock foundation independently reviewed in PR311/db1b3d5; the new People Add
DOM workflow installs locked test dependencies with lifecycle scripts disabled. Nothing is imported
by the served application. Fictional records use in-memory SQLite and actual delegated click/submit
controls connected to the actual API handlers. No external fetch, mailbox, real browser, workerd,
customer session or deployment is exercised; DOM success is not pixel/layout or live acceptance.

Local source result:2014 unitPASS/0FAIL/0SKIP and5 DOMPASS/0FAIL/0SKIP, template verifyclean/diffcheck.
Prepublication review caught and fixed unauthorized duplicate projection after access revocation;
a focused test covers initial match, post-refused-insert match and saved-profile read. Initial full
unit run also exposed action-map registration and incomplete DOM stubs; new actions are registered
without weakening existing wiring assertions. Actual final-head hosted results are separate.

Production base is cloud-main d810ef9 (tree identical to recorded production f8d7361e); this is a
small standalone Add increment, not a staging-union promotion and not an amendment to311/312/313.
The release owner must freshly reconcile the actual production package and selected311 panel delta,
and regenerate staff cache hashes after integrating both. For staging313/QA-login successors, retain
My Support and all auth/env/current-row fences; reconcile shared staff source and regenerate hashes,
then run normal checks and the real-control fixture on the exact combined candidate. No stale-base
file overwrite or inference that this source candidate includes those other increments.

Recovery: preserve the prior package and normal rollback custody. No schema migration/configuration
is added. Rolling back UI/API does not remove legitimately created people or original audits; use
normal review/archive workflows rather than deleting history. Installation and own-user acceptance
remain with the existing publisher/root41, and customer data changes are outside this source task.
