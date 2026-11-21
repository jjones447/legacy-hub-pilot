# Caregiver Profile implementation checkpoint

Author: [pc2-codex-ct-13]. Nov21 06:00 UTC checkpoint, prepared early.
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
| Initial draft fields | First/last name, email, phone, ZIP and optional mailing address; caregiver-record prefill, partial merge, explicit empty/null retained | Exact source labels/requirements; contact preference and all choice fields |
| Writes | Additive profile only; revision compare-and-swap; transaction with revision-only audit; current owner eligibility inside write | Native D1 transactional/runtime checks |
| Conflicts | Stale revision returns409 without overwrite; ambiguous acknowledgement returns generic500, then owner GET readback before retry | Accessible conflict/recovery UI and tests |
| UI | Existing `portal.html#portalProfileCard` and portal `me` projection unchanged | Editable mobile/keyboard/screen-reader form, prefill/resume, progress, accessible field errors and confirmation |

Initial feature switch `PORTAL_PROFILE_ENABLED` must equal `1`; no deployment
configuration enables it. This allows synthetic handler tests without exposing the
incomplete form/catalog. The ordinary preview containment applies first; the switch
does not bypass preview identity/mail gates. Do not enable merely because unit tests pass.

Profile email/phone/name answers do **not** mutate `caregiver`, login address,
membership, consent, staff permissions or other existing records. Contact preference
must never imply SMS consent. Draft saves do not require all completion fields; the
final required-field completion logic must not prevent interruption/resume or access
to the rest of the portal.

## Exact source and remaining LP-01 work

Issue54 provides the field/acceptance summary, not the complete approved labels and
options. The existing private Oct2 packet or extracted LP-01/LP-09 register is required;
lead2 has routed its recovery through the existing material custodian. Do not put the
private client source into this public repository or invent choice values.

Pending catalog groups: contact preference; optional age/race/gender/language;
care relationship/duration/journey stage including no diagnosis, not currently caring
and bereavement; referral source/reason; support needs and at most three priorities
that are a subset of selected needs; existing support/unmet access; barriers including
inability to leave the care recipient; engagement/availability. Exact optional decline
representations, required minimum and privacy copy must be reconciled with that source.
No journal text, respite activation, clinical scoring, real email or production release.

Next implementation: add the recovered versioned field catalog and validators,
server-derived completion, UI save/load/resume states, every-field synthetic round-trip,
top-three subset/optional-decline negatives and DOM accessibility/owner-isolation tests.
Use the same retained Devin4 review window; no duplicate publisher1a0 review.

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
owner-isolated TEST. At risk until exact source options/copy are recovered (planning
cutoff Nov21 08:00) and an executor accepts runtime custody. Ct5's unpublished state
remains unknown; reconcile rather than overwrite on return. Publisher setup and its
existing owner permission request remain separate from this source work.
