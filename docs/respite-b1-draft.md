# Drop-In Respite B1 — source-only qualification draft

Author: pc1-codex-5. Sole-author packet Legacy54 c6611440535; pre-code map c6611845232;
Lead41 source-only disposition in C5 inbox 2026-11-03 12:24:51 CST, recorded in c6612305895.
Base: installed/reviewed #315 `5d70122f1f518805adb73c2279398b667a0d5dac`.
This is a draft, not an installed system, approved privacy policy, clinical assessment or live collection.

## What exists in this candidate

- `/respite-application.html` is a separate, unlinked, clearly fictional qualification page.
  It never submits to ordinary intake, pre-fills from caregiver contact, or creates a profile.
  Its disabled fieldset stays hidden until the dedicated configuration API returns eligible sessions.
  Neither the #320 Drop-In Respite page nor its links/events are changed here.
- `GET /api/respite` lists at most 40 explicitly marked, published future sessions and the exact
  **draft** acknowledgment version/copy. `POST` has a 12,000-byte streaming bound, strict field/boolean
  whitelist, exact-origin and Fetch-Site checks, and the existing hashed-IP audit limiter.
  Two independent unchecked strict-true acknowledgments are required. The server selects the version
  and records timestamp; old copy/version must remain reproducible if later versions are introduced.
- Every public submission is an unlinked pending application, regardless of supplied email/phone,
  caregiver cookie, membership, duplicate/archived matches or claimed caregiver ID. A claimed ID is rejected.
  No public history, identity lookup, detail endpoint, email, AI call or automatic confirmation exists.
  Portal-authenticated identity support is intentionally deferred; it is not claimed as tested here.
- A hashed UUID request key plus canonical validated snapshot digest deduplicates exact retries.
  The private snapshot is immutable. Changed retries refuse without replacement. A generic receipt says
  pending/not confirmed and reveals neither application ID nor caregiver match, even after review.
  The browser keeps the same request key only in memory for retries; no health/contact data enters storage.
- The existing Attendance panel requests the restricted pending list separately. Unlisted staff see no
  B1 panel. Explicit detail clicks fetch sensitive answers; summaries contain IDs/status/first-time flag,
  not names/contact/clinical answers. Private text is inserted with `textContent`, not parsed HTML.
- Reviewer access requires the existing middleware's Symbol-backed verified active human Access actor,
  an explicit reviewer list, and a fresh active staff row. Dev bypass, service credentials, body/header
  claims, all-staff membership, missing schema or malformed settings do not grant it.
  Private snapshots also require that **same actor be active in the actual private projection SQL**;
  the earlier eligibility check is not cached authority. Protected summaries use one current-active-staff
  `LEFT JOIN` projection, retaining a server-only authorization witness even when no applications exist.
  Revoked/missing authorization returns403 with no application/details fields, not a successful empty
  or stale protected response; the witness itself is never returned. This authorizes at the data-read
  statement snapshot, not by a post-response check or a claim of perpetual authorization afterward.
- Staff independently verifies/selects an existing caregiver ID, recording actor/time without updating
  a real profile. Unknown/ambiguous identity stays pending; there is no automatic search/merge/restore.
  Any genuine new caregiver creation uses the separately reviewed #319 explicit record-only workflow.
- First-time requests require a separately recorded completed staff follow-up. Confirm is one D1 batch:
  original audit guarded by pending revision/current staff/current caregiver; CAS application state;
  registration insertion guarded by current marked published future event/capacity; exact registration link.
  Decline creates no registration. Unknown/failed writes never reset state or report success; refresh/retry
  the same revision/reference to reconcile. Confirmed ordinary registrations use existing Attendance controls.
  No staff decision sends an external message.

## Schema and activation boundary

`schema/candidates/0019_respite_pending_review.sql` is **not** an active migration. It adds
`event.respite_review_required` (default 0), `respite_application`, and the immutable per-application
`respite_application_private` snapshot. This is one session's application, **not B2 saved profiles**.
It neither inserts nor marks any live event. Existing event types remain unchanged.

Candidate triggers fence all registration writers, not just the new form. Intake reserves the B1 source
namespace before duplicate lookup/profile matching. A marked session cannot receive a registration from
ordinary intake, Givebutter, Square or another source. Their existing batch transactions roll back profile,
registration/follow-up and audit together on refusal. Existing non-respite routes stay unchanged.
The marker cannot be flipped on a session with existing applications/registrations without separate
reconciliation. Linked registrations cannot be reparented/deleted or revived beyond current capacity.
The API checks all nine candidate triggers are present before collecting/reviewing.

No Wrangler configuration, binding, secret, migration catalog or deployed setting is changed.
Default is OFF with an empty reviewer set. The draft additionally refuses production even if configured.
Fictional in-memory tests alone supply `ENVIRONMENT=preview`, `RESPITE_B1_COLLECTION=b1-fictional-v1`
and a JSON `RESPITE_B1_REVIEWERS` list of fictional verified active staff addresses. These names are not
an activation instruction. Do not apply SQL or set real environment flags from this document.
Existing #315 QA tuple/login fence and all existing mail flags are untouched.

## Privacy/storage holds before any real use

The words marked DRAFT are not approved consent or clinical/legal advice. Program/privacy owners must
decide exact two acknowledgment texts, authority to supply loved-one information, authorized reviewers,
withdrawal/correction/retention policy, and appropriate accommodations/capacity/follow-up procedure.

Separate tables are **not** a backup/export perimeter. Existing `workers/backup/src/index.mjs` and
`scripts/export-all.mjs` enumerate all tables and would include these snapshots in R2/local JSON if the
candidate were applied. No exemption, encryption/access-control or installed retention qualification is
claimed. Owners must qualify storage/account/bucket access, exports, restore, retention and any encryption
requirement **before collection**, not after. No audit, note, follow-up, caregiver/agent field or prompt
receives submitted sensitive answers. This candidate does not inspect or change any live backup.

## Reproducible source evidence

Use Node 24 and the existing Python/Jinja build environment in an owned source checkout:

```sh
node --import ./tests/helpers/no-network.mjs --test tests/respite-b1.test.mjs tests/respite-b1-ui.test.mjs
python build.py --verify
node --check respite-b1.js
node --check functions/_lib/respite-b1.mjs
git diff --check
```

The new tests use real handler exports, in-memory SQLite/candidate triggers and the complete browser script
in a synthetic DOM. They cover identity non-linking, strict acknowledgments, default/missing-schema/reviewer
denial, no service/dev/JSON capability, retry/changed-payload/lost acknowledgment, first-time gate,
Confirm/Decline/Attendance, capacity competition, stale revision/reviewer/caregiver/event drift,
failed-audit rollback, reserved-source and provider-shaped transactional bypass refusal, immutable snapshots,
restricted summary/detail interaction and text-only rendering. Existing provider-handler and QA/My Support
tests are regression evidence; provider-shaped candidate tests are not real provider delivery proof.

Real Cloudflare D1, workerd, hosted browser pixels, deployment, live login/mail, actual caregiver records,
profile creation, provider calls and runtime settings are **NOT RUN**. Hosted source CI is reported on the
exact PR head separately, never substituted for those acceptance gates. Private full logs stay outside source.

Initial PC1 Node 24.15 source qualification: 27 new tests PASS; 165 combined focused tests PASS.
Full candidate 2,159 PASS / 3 FAIL / 0 SKIP versus the exact frozen #315 baseline 2,132 PASS /
the same 3 FAIL / 0 SKIP. The three reproduced baseline failures are NUL-bearing text round trips in
backup restore, caregiver contact and staff note tests; they were not suppressed or changed.
The added generated page required extending the explicit public-header coverage count from 23 to 24;
every page still undergoes the same hierarchy/accessibility assertions.

### Independent-review correction: current authorization at projection

Review42 `5758143486` / Legacy54 `6613215004` found two private-read revocation interleavings in
initial `b40616e`: staff deactivation after the initial reviewer read or after application metadata read
still returned200/private fields. Lead41 assigned the same-PR source correction in `6613230050`.
The original verdict is **SOURCE NEEDS CHANGES via COMMENT**, not formal GitHub REQUEST_CHANGES;
source acceptance remains for the independent reviewer, not this author.

Regression-first reproduction:31 tests,28PASS/3FAIL; both reported detail races and a protected-summary
analogue incorrectly returned200 versus expected403. The confined SQL correction above yields31PASS/
0FAIL/0SKIP, preserving all original27 cases plus an authorized-empty-summary control. It adds no role,
storage, schema, configuration, policy, runtime or provider changes. Both drift cases explicitly prove
the same current actor was deactivated before sensitive projection and that response contains zero
private/application fields. Same consent, producer/CAS/atomic-audit, OFF and pre-live holds remain.
Correction qualification also passes169 combined focused tests. Full PC1 Node24.15 run:2163PASS /
the same3 baseline NUL-handling failures /0SKIP (2166 total), with no suppression or test-boundary changes.

## Integration custody

Original #315 remains frozen. #319 People Add remains with pc2-codex-42, #320 page integration with
pc2-claude-ct-2, and publishing with pc2-gemini-ct-5. The B1 branch is not their release branch.
Shared source intersections are small: Staff Attendance call + script tag, build metadata/asset hash map,
and explicit unit inventory. Do not overwrite their staff forms, generated assets or package lock.
Reconcile exact selected successors and regenerate assets from committed LF bytes before release review.
No merge, publisher GO, schema application or live collection follows from this draft PR.

Local-only compatibility witness: merged this B1 candidate with exact #319
`0e43c4894a71aad134936dd9de780914c0a5f2b9` in a separate C5-owned qualification worktree.
The only merge conflict was the generated `staff.js` version tag; kept the B1 script reference,
preserved merged People Add/Attendance source, regenerated assets and committed local-only
`b9813937cb6119501c0e4bb494fa9cceae5de35a` / tree `2d058143deb3199726bd818b83f8c5c00171f10c`.
Actual combined B1 + People Add + QA/My Support + dispatch source tests: 89 PASS / 0 FAIL / 0 SKIP;
template verification clean. This is not a selected or published combined release, independent review,
or #319 rendered DOM acceptance. No #319 branch, owner worktree or #320 source was amended.

Cloudflare API references retrieved November 3: [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[Pages Function context](https://developers.cloudflare.com/pages/functions/api-reference/),
[Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
Latest retrieved Workers types `5.20261103.1` confirm the D1 `batch` and Pages handler shapes.
