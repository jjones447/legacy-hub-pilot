# Caregiver Profile implementation checkpoint

Author: [pc2-codex-ct-13]. Nov21 08:20 UTC source checkpoint.
Updated after the controlling Nov12 requester specification was recovered Nov21 05:43 UTC.
The same PR implements its catalog, backend validation, follow-up flag, staff projections and caregiver/staff views.
Source base: `9c936ed2c2f296093bd19f7b5e613faf6c3364cb`.
Scope authority: [Legacy54 author handoff](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-7057254580)
and [temporary lead acceptance](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-7057587254).

## Built in this checkpoint

This is the catalog/storage/API and caregiver-form slice, **not completed LP-01 or functional TEST**.
No migration has been applied and no provider deployment or browser qualification is claimed.
The own author branch preserves ct5's unknown private work for reconciliation.

| Surface | Current implementation | Remaining work |
| --- | --- | --- |
| Storage | Candidate `schema/candidates/0022_caregiver_profile.sql`: one row per caregiver, separate ordinary/restricted JSON answers, revision and update time | Independent schema review and isolated TEST migration/bookmark/readback |
| Authentication | Existing signed portal session and current nonarchived owner; joined reads and write predicates repeat eligibility | Native TEST qualification; no claim of a new logout-revocation mechanism |
| API | Exact `GET/POST /api/portal/profile`, no owner selector/query, `no-store`; strict same-origin JSON POST; streamed 8 KiB limit; full catalog and required-field completion | Native owner-isolated form/API qualification |
| Catalog | All five sections and 33 writable fields; exact options, conditional rules, optional declines, read-only account email, every-field round-trip | Browser and assistive-technology qualification |
| Writes | Additive profile only; revision compare-and-swap; transaction with revision-only audit; current owner eligibility inside write | Native D1 transactional/runtime checks |
| Conflicts | Stale revision returns409 without overwrite; ambiguous acknowledgement returns generic500, then owner GET readback before retry | Native conflict/recovery qualification |
| Caregiver UI | Five catalog-driven sections, read-only email, conditional inputs, completion progress, partial save/resume, explicit conflict/unknown-save reconciliation, status announcements; owner/session changes clear all answers and reject stale responses | Actual browser/mobile/keyboard/screen-reader checks |
| Staff UI | Read-only individual answers and whole-cohort aggregate tables; current-role-filtered labels/values; no cached answers/exports; clears on record change, back, access refresh, page hide or denied reload | Actual browser/runtime staff qualification |

Initial feature switch `PORTAL_PROFILE_ENABLED` must equal `1`; no deployment
configuration enables it. This allows synthetic handler tests without enabling the
incomplete user flow. The ordinary preview containment applies first; the switch
does not bypass preview identity/mail gates. Do not enable merely because unit tests pass.

Email is rejected in writes and is never persisted as a draft answer. Reads always
project the current account email. Profile phone/name answers do **not** mutate `caregiver`, login address,
membership, consent, staff permissions or other existing records. Contact preference
must never imply SMS consent. Draft saves do not require all completion fields; the
final required-field completion logic must not prevent interruption/resume or access
to the rest of the portal.

## Exact source and remaining LP-01 work

The source gap is CLOSED: the controlling specification is the requester's Nov12
Slack message, recovered in [private Legacy54 source receipt](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-7058110336).
It supersedes the earlier Oct2 PDF dependency and older summary assumptions. Do not
copy the private verbatim message into the public pilot repository; only field labels
belong in the implementation. No new customer question is required.

The five sections are Personal Information, About Your Caregiving Journey, Your
Support Needs, Respite Care Information, and Optional Demographic Information.
Implement their exact recovered option labels and conditional behavior. Email is
read-only. Full name, account email and ZIP determine required-field completion;
partial saves remain possible. Previously caring caregivers can skip current-care
questions. Dementia type is shown only for diagnosed or suspected dementia.

DOB and demographic answers are visible to **admin staff only**; other staff receive
aggregate totals, never individual values. The caregiver can access their own answers.
DOB/demographics are stored in `restricted_json`, separate from ordinary answers.
`/api/staff/caregiver-profile/:id` requires middleware-verified human staff proof and
checks the current active staff role inside the same SQL read. Nonadmin SQL results
never contain restricted JSON. Admin sees individual restricted answers; tests cover
current role downgrade, missing/deactivated staff, service/dev/spoofed identity and
corrupt storage. `/api/staff/profile-summary` returns fixed whole-cohort counts only,
with no individual filters, DOB values or other-identity free text. Internal QA records
are excluded. Cohorts below10 and groups with cells/complements below5 are suppressed.
Suppression is a conservative implementation choice, not an anonymity guarantee. Never expose raw answers through existing People
or exports. Privacy wording remains requester review on actual TEST.

Implemented: full typed catalog, server completion and conditional validation, optional
declines/other-text, restricted staff projections/aggregates and a generic support-review
flag. A transition into requested contact creates one existing staff-queue follow-up in
the original Profile/audit transaction; further edits do not duplicate it, withdrawal
dismisses only open Profile flags, and a later new request creates a new flag. No
questionnaire answers or contact method are copied into that flag or audit.

The caregiver form now uses the returned catalog and preserves partial answers. It submits
only changed visible writable fields, preserves stored hidden answers, and never stores
answers in browser storage. Successful saves reload normalized owner data; stale revisions
and unknown acknowledgements require an explicit read before another write. Owner changes,
sign-out and session resets clear the form and invalidate in-flight responses.

Implemented since the first form checkpoint: staff individual and aggregate views,
server-filtered field labels, linked field validation guidance and staff DOM no-disclosure
tests. Remaining: browser qualification, migration/runtime handoff, independent exact-head
review and any corrections those checks identify. A request
for support must not enroll the caregiver or automatically send contact. Respite
information is part of this Profile; it does not activate respite services. No household
income, detailed medical history/medications, Wellness Passport questions or wellness
activity preferences. Do not carry older summary-only top-three/engagement fields into
this controlling form without a later source requirement.

The08:00 implementation checkpoint was delivered early. This successor is ready for
retained source/schema review; browser/native acceptance is still open. SAME Devin4
and ct12 routes are retained; publisher activation review remains separate.

## Verification and runtime handoff

`tests/caregiver-profile.test.mjs` and `tests/caregiver-profile-catalog.test.mjs` invoke the actual handlers and SQL against synthetic
in-memory SQLite, including two owners, session expiry, owner archive before read/write,
same-revision saves, audit failure rollback and lost acknowledgement readback. It does
not call provider APIs, send mail or establish native D1 behavior. The handler tests are explicitly included in `scripts/unit-test-files.mjs`.
`tests/dom/caregiver-profile-ui.test.mjs` runs with the existing Staff DOM workflow,
which installs the locked JSDOM dependencies. Ten caregiver UI cases use the actual controller in JSDOM
for partial saves, conditional preservation, read-only email, stale-owner responses,
sign-out during save, conflict and ambiguous acknowledgement recovery, and denial clearing.
The portal dashboard integration test covers new-owner reload, same-owner edit preservation
and session reset. Eight staff DOM cases combine the actual API projections with the renderer and
exercise current role downgrade, stale person/identity responses, denial clearing,
actual navigation/access refresh hooks and aggregate suppression. These are synthetic
DOM checks, not installed browser acceptance.

Candidate0022 must remain separate from People0021, which is already applied to TEST
and must not be reapplied. A supported executor must verify the deployment-specific
isolated TEST origin and D1 binding, bookmark before migration, apply reviewed0022 once,
verify existing rows unchanged, then install the reviewed source and qualify synthetic
owner-specific save/load/resume and denial cases. Canonical staging aliases production;
the alias alone cannot establish TEST. No credentials are transferred through source/chat.

Rollback before any stored answers may remove the isolated candidate table only after
operator verification; after writes, disable the feature and preserve stored answers
for the approved retention/recovery disposition. Do not run an automatic destructive rollback.

Working dates remain Nov22 10:00 UTC exact source/green checks and Nov22 23:59 actual
owner-isolated TEST. Source options/copy are now recovered. Delivery remains at risk
until the full form/privacy implementation and runtime qualification are completed. Publisher
execution custody is now qualified for this seat; Profile still needs its own reviewed
schema/source, isolated migration and runtime evidence. Ct5's unpublished state
remains unknown; reconcile rather than overwrite on return. Publisher release remains separately gated on a different valid service identity refusal
receipt and explicit retained Security activation closure; its permission/custody wait is closed.

## Remaining implementation estimate

The planned caregiver/staff source integration and synthetic no-disclosure checks are
implemented. Allow approximately2–4 focused author hours for browser qualification,
review corrections and runtime packaging; this estimate is not an activation promise.
This seat has no installed browser executable or browser connector at this checkpoint.
Native TEST also needs a reviewed synthetic owner-session route: shared preview portal
access is disabled unless the existing preview identity/mail containment opt-in qualifies.
The Profile feature switch alone cannot bypass that containment. Do not enable real
mail, reuse production sessions, or alter that boundary merely to obtain a passing TEST.

Working source target Nov22 10:00 remains feasible with capacity; SAME Devin4 initial4–6h
and successor2–3h review windows are retained. Actual TESTNov22 23:59 remains conditional
on review closure, isolated migration/provider readback, qualified synthetic owner access
and browser/runtime checks. Profile source/schema review does not waive publisher gates.
