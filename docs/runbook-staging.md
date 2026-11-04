# Staging surface — historical preview runbook

## Shared323 People Add source successor — November 3, 2026

[pc2-codex-42] Source-only packaging adds the already-reviewed319 People Add delta
(`0e43c4894a71aad134936dd9de780914c0a5f2b9`) to installed shared323
(`e12b29983824371d935e5c76ca830c6e37c3a90c`). Existing design/home is the Staff
People search area, `functions/_lib/domain/caregivers.js` create contract and the
existing Staff caregivers POST route, as documented in the People Add sections
below. The existing author42 packages this increment; Root41 independently reviews
and selects any release. No replacement component or new operator is introduced.

People Add code, locked DOM tests and dependency files are reused from319. The
provider-off implementation/tests remain323; QA login, My Support and the portal
remain323. The unit inventory is323 plus the existing People Add test. The package
excludes isolated Respite/public-page325/326 changes and unaccepted327 dashboard
samples. Compare this successor against323 rather than treating the public-main
PR diff as its release scope.

Retained controls: active Staff authorization at insertion/readback, strict
first/last/email/phone input allowlist, atomic original audit, contact-duplicate
refusal including archived matches, no overwrite/enrollment/invitation/email or
consent side effects, and truthful idempotent retry after an uncertain response.
Validation is Node unit/in-memory SQLite plus local JSDOM only; no real workerd,
installed/browser/client acceptance, database migration, email or deployment is
claimed. The next increment is independent exact-head review, followed by Root41's
existing release selection and applicable installed acceptance. Do not deploy or
merge this package to production from this source receipt.

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


### Staging integration of People Add over approved313

Separate source candidate authored by42 for41 independent delta review; original314 stays frozen.
Inputs: approved31397f0779 (Staff306, Alerts/Events310, MySupport309a722) plus accepted314fb419b4.
This is source assembly, not a claim of current installation. No installed313 successor was present
in the inspected cloud receipts; publisher must requalify actual installed baseline before selecting it.

Keep both customer-activity and People Add entries in the explicit unit inventory; regenerate the
Staff script hash. The merged submit dispatcher uses `action`, including the My Support triage arm;
leaving its older `formAction` reference would break that real form. The helper-driven preference
identity regression retains its isolated function fixture via the optional leaf UI hook. No MySupport
core, portal/shared app, auth or mail/config/schema logic is changed by this integration.

The inert test adapter now supplies SELECT results within db.batch, matching the existing MySupport
canonical readback contract. An additional actual-HTML delegated control test creates a fictional
support request through the existing core, clicks Mark in progress, submits the existing triage form,
and verifies completed state, private note and original audits alongside Add and both labels. Its
fictional JWT is a handler-only fixture, not evidence of verified Cloudflare Access or a live session.
No provider or network is used.

Release handoff: review this delta/normal checks, then original publisher/root41 select tester route
and installed package. The separate QA-only login source/integration/walkthrough must proceed without
waiting for this candidate, and is not merged or activated here. If the installed successor already
includes QA auth, carry forward its exact env/current-row guards and selected source rather than
replacing it with this older source base. Stop on drift and return the combined source for review.

Integrated local result:2106unitPASS/0FAIL/0SKIP plus6DOMPASS/0FAIL/0SKIP, verifyclean/diffcheck.
Tester handoff after review and separately selected installation: at the exact Staff staging URL,
use the authorized Staff identity and fictional records to check Add beside Search, caregiver save
and normal record, contact duplicate Open/history, retained entries on refusal, admin staff shortcut
and nonadmin denial. Recheck the existing synthetic support queue/triage/history and both labels.
Do not request a real sign-in link or use a customer identity from this Add-source task; QA-only
login walkthrough stays with its current owner and exact package. Return installed ID/asset hashes,
actual result and precise limitations separately from these source/fixture passes.


### QA-enabled People Add successor on315

Current source assembly starts exact reviewed3155d70122f1f518805adb73c2279398b667a0d5dac
and layers reviewed3179b0e75ac27465ef1680b7f4b7fb13e3c4a9da4e5. This supersedes only the
older313-based Add integration as the candidate to consider after the QA login release; originals
remain frozen. Discovery found no existing successor branch/PR before this bounded authoring pass.
Git merged these exact parents without a content conflict. No manual auth or MySupport source
resolution was needed, and no selected source is silently replaced by its older parent.

Exact315 parity: shared app/QA portal handler/policy reader/sender/support core/QA source guide/
wrangler config. Exact317 parity: Staff JS/caregiver domain and Staff API route/Add unit and actual
DOM tests/inert adapter/test dependency foundation. Shared Staff HTML preserves315 app hash and317
Staff hash; explicit unit inventory keeps both QA suites and People Add. Generated build must verify.

Qualification combines actual QA+production support allowed/denied handler tests with Add controls
and existing Staff triage in the same source package. Source pass does not activate QA, send a link,
create live records or qualify installed Access. The independent315 staging release and walkthrough
continues without waiting for this successor. Review/checks first, then existing publisher/root41
revalidate the actual installed315-or-successor target, bindings, in-flight publication and rollback;
return a fresh combined source if drift exists. No deployment/settings/mail/customer action by42.

Current QA-enabled successor local verification:2142 unitPASS/0FAIL/0SKIP and6actualDOMcontrols
PASS/0FAIL/0SKIP; templateverifyclean/diffcheck. Both18-case QA suites and14-case originalSupport
suite remain in the explicit unit run, alongside7record-only Add cases. The6DOMcases retain the
real Staff queue/triage flow and caregiver/admin Add controls. Normal hosted checks and independent
review on this exact new candidate remain separate; no source/CI result means installed acceptance.
