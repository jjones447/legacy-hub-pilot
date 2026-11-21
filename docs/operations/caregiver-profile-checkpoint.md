# Caregiver Profile implementation checkpoint

Author: [pc2-codex-ct-13]. Nov21 06:00 UTC checkpoint, prepared early.
Updated after the controlling Nov12 requester specification was recovered Nov21 05:43 UTC.
Source base: `9c936ed2c2f296093bd19f7b5e613faf6c3364cb`.
Scope authority: [Legacy54 author handoff](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-7057254580)
and [temporary lead acceptance](https://github.com/jjones447/legacy-caregiver-hub/issues/54#issuecomment-7057587254).

## Built in this checkpoint

This is the initial storage/authentication slice, **not completed LP-01 or functional TEST**.
No migration has been applied and no provider deployment or browser qualification is claimed.
The own author branch preserves ct5's unknown private work for reconciliation.

| Surface | Current implementation | Remaining work |
| --- | --- | --- |
| Storage | Candidate `schema/candidates/0022_caregiver_profile.sql`: one row per caregiver, JSON answers, monotonic revision, update time | Final field schema review, explicit isolated TEST migration/bookmark/readback |
| Authentication | Existing signed portal session and current nonarchived owner; joined reads and write predicates repeat eligibility | Native TEST qualification; no claim of a new logout-revocation mechanism |
| API | Exact `GET/POST /api/portal/profile`, no owner selector/query, `no-store`; strict same-origin JSON POST; streamed 8 KiB limit | Full field catalog and completion calculation |
| Initial draft fields | First/last name, phone, ZIP and optional mailing address; email read-only from account; caregiver-record prefill, partial merge, explicit empty/null retained | Exact source labels/requirements; contact preference and all choice fields |
| Writes | Additive profile only; revision compare-and-swap; transaction with revision-only audit; current owner eligibility inside write | Native D1 transactional/runtime checks |
| Conflicts | Stale revision returns409 without overwrite; ambiguous acknowledgement returns generic500, then owner GET readback before retry | Accessible conflict/recovery UI and tests |
| UI | Existing `portal.html#portalProfileCard` and portal `me` projection unchanged | Editable mobile/keyboard/screen-reader form, prefill/resume, progress, accessible field errors and confirmation |

Initial feature switch `PORTAL_PROFILE_ENABLED` must equal `1`; no deployment
configuration enables it. This allows synthetic handler tests without exposing the
incomplete form/catalog. The ordinary preview containment applies first; the switch
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
This slice has no staff Profile read endpoint and does not yet collect DOB/demographics.
Before adding them, separate restricted fields from ordinary staff projections and
cover admin/nonadmin denials in tests. Never expose raw answers through existing People
or exports. Privacy wording remains requester review on actual TEST.

Remaining implementation: full typed catalog, sectioned accessible UI, conditional
fields, completion, save/load/resume/conflict recovery, optional declines/other-text,
restricted staff projections/aggregate behavior and reviewable follow-up flag. A request
for support must not enroll the caregiver or automatically send contact. Respite
information is part of this Profile; it does not activate respite services. No household
income, detailed medical history/medications, Wellness Passport questions or wellness
activity preferences. Do not carry older summary-only top-three/engagement fields into
this controlling form without a later source requirement.

Next checkpoint08:00 now concerns catalog/UI progress and the remaining source estimate,
not packet recovery. SAME Devin4 review window retained; no duplicate publisher1a0 review.

## Verification and runtime handoff

`tests/caregiver-profile.test.mjs` invokes the actual handlers and SQL against synthetic
in-memory SQLite, including two owners, session expiry, owner archive before read/write,
same-revision saves, audit failure rollback and lost acknowledgement readback. It does
not call provider APIs, send mail or establish native D1 behavior. New test is explicitly
included in `scripts/unit-test-files.mjs`.

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
until the full form/privacy implementation is completed and an executor accepts runtime custody. Ct5's unpublished state
remains unknown; reconcile rather than overwrite on return. Publisher setup and its
existing owner permission request remain separate from this source work.
