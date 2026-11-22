# Caregiver support journey: proposed implementation plan for approval

Goal: what the caregiver needed → support actually received → whether they report it helped → what they need next. This is a written plan only, not a new feature or launch commitment. It answers the five requester questions below. Customer plan approval precedes major changes; Jacob's existing storage/migration, sending and privacy/operating gates remain separate. No SQL, route, provider call, email, deployment or private-record read accompanies this document.

## 1. What is already built, and what is actually installed?

Source inventory inspected at installed #374 `9c936ed2c2f296093bd19f7b5e613faf6c3364cb`. Publisher receipt records production3973661f with rollbackfa235b19/f7e5923; public page/asset readbacks prove that page package, NOT every table/route's live behavior. Customer-owner inventory describes the following core capabilities as live. That is attributed operational evidence, not fresh authenticated D1/schema/record acceptance by this author. Before building, obtain qualified catalog/runtime evidence without dumping customer data.

| Existing capability | Source evidence and reuse | Maturity/evidence limit |
|---|---|---|
| One caregiver identity + membership | `schema/0001_init.sql`: caregiver ID, sanctuary_member/member_since, caring_for/relationship, tags/status; portal session in `functions/api/portal/[[path]].js` | Built; owner reports live. A new form must not create another person or treat typed email as authentication. Fresh installed catalog/permissions not inspected. |
| Support request and next-step tasks | Generic intake and followup in0001; Staff `functions/api/staff/[[path]].js` reads and resolves tasks | Built; owner reports live. **The due field already EXISTS**. No assignee column or structured barrier/need/service links in0001; do not describe all due tracking as absent. Qualify existing due semantics/UI before extension. |
| Staff history and notes |0001 note; `schema/0006_caregiver_contact_history_outcomes.sql` contact_history; Staff caregiver detail aggregates history | Built; owner reports live. Phone/email/in_person/event/other + direction/occurred_at/recorded_by supported. Free-text summary is not a structured service/outcome record and may contain sensitive data despite old source comments. |
| Participation |0001 registration with event_id/caregiver_id and registered/attended/no_show/cancelled, event starts_at/ends_at | Built; owner reports live. Registered ≠ attended; attendance ≠ actual respite hours or improvement. Event type taxonomy is broader/older than proposed need taxonomy. |
| Existing outcome label |0006 caregiver.outcome_status improving/stable/needs_support/disengaged +notes/time | Built; owner reports live. Coarse Staff label, not a validated clinical measure, service-linked feedback, causal outcome or substitute for caregiver report. Preserve source attribution. |
| Wellness check-in | `schema/0012_wellness_checkin.sql`, `_lib/wellness.js`: stress/sleep/support/self_time1–5, optional note, descriptive score,30-day due logic; portal GET/POST wellness | Built; owner reports live. Optional note and Staff chart have their own consent/access. No journal text auto-fill. New versioned journey questionnaires are separate candidates, not assumed installed. |
| Staff authorization |0011 staff_member, `_lib/staff.js`, Access-verifying middleware | Built; owner reports live. Recheck current active permissions on reads/writes/exports; no role inference from a name/email. |
| Email list |0020 email_subscriber, previously published list/export | Existing list is not authority for automated feedback/newsletters or permission to import/send. |

### Candidate/designed versus missing

- #369 draft `a8594de3582bac23ab1116604f4d7684afbfb624`: owner participant/request schema, reviewed revision/lifecycle writer and verified-session adapter source; collectionOFF/unapplied. Direct inspection of `schema/candidates/respite_owner_lifecycle.sql` and writer finds **NO actual-hours/duration field or delivered-hours writer**. It links a reviewed request to registration/event, but neither event duration nor registration status proves hours received. Request details JSON is not a qualified hours ledger. Preserve owner/review/cancellation/removal invariants; do not bypass its gates.
- #362 My Support `0c7a9596eee4e7f257f5e095059db0d68942dfff` remains OPEN under separate Jacob production decision. It is not a newly live structured needs/service-history screen.
- Profile: designed/pending existing storage decisions, not a live comprehensive editable profile in this plan. #359 is Staff People/Caregiver marker, not authorization for new journey storage.
- `schema/candidates/0013_wellness_journey.sql`: source-only versioned questionnaire/participation/period design; prefix0013 does not reserve a new active migration or prove D1 application. Its real qualified producers/consent/versions must be reconciled, not duplicated.
- #373 saved-resource design `a1a2e3079e706d23cbc80339a62ed11dd96dde44`; no installed bookmarks catalog/routes/table. #376 journal/wall design `d56ad5e6ee76d2924e313b586929210ef53a185f`; no features/storage. A journal is not part of Staff journey data.
- Missing or needs qualification: longitudinal structured needs; recommendation/referral/barrier relationships; service-linked delivered evidence and actual respite hours; task assignee and reliable completion history; optional service-linked feedback/versioned follow-up; privacy-qualified reporting/export. These are additions, not grounds to replace existing records.

## 2. What should be added or improved?

Use the requester's seven initial needs: respite/time away; dementia-related behaviors; stress/emotional support; education/practical guidance; wellness; social/support groups; other resources. Labels and any “other” text require final content review; do not diagnose. Proposed need state: open/in_progress/met/closed_by_choice, with initial/current display and immutable revision/effective date/source (caregiver, Staff phone/in-person, existing intake). “Met” needs an explicit reason/report, never automatic attendance. Keep history of change rather than overwrite initial need; permit decline/not-now without penalty.

A recommendation records proposed service/referral, need link, date and source. A scheduled registration remains scheduled until delivery evidence exists. For event programs reuse registration/event as authoritative participation; expose a service timeline projection instead of copying every registration into a second independent status table. For non-event direct support, propose a minimal delivery record with canonical caregiver/need/recommendation reference, actual occurred_at, service type, delivery evidence source and recording Staff. Unique evidence reference/idempotency prevents a registration and manual entry counting twice. A refusal/cancellation/no_show/unknown is not a completed service.

Respite: after #369 is qualified, link its same registration/request; add reviewed actual start/end or actual minutes received (design choice needed), who recorded/confirmed it, correction reason/revision. Proposed nonnegative bounded integer minutes; unknown stays null, not0. No default from scheduled event length. Define whether hours refer to caregiver relief or loved-one attendance and handle multiple loved ones, partial sessions and overlapping records before summing. Preserve late corrections with audit/revision; no silently rewriting frozen funder totals.

Barrier is a bounded optional category (proposed availability, schedule, transport, cost, contact difficulty, caregiver choice, other/unknown) linked to a need/recommendation/task, not a stigmatizing permanent person label. Separate referral sent, external service confirmed received, declined and unknown; do not claim an outside service was delivered from a referral click. Store only information necessary for follow-up, not external clinical details.

Improve followup by linking existing task to need/recommendation/service, current active Staff assignee, existing due field, next-step text, revision, completed_at/completed_by and disposition reason. Existing open/done/dismissed retained or deliberately mapped with migration review; dismissed ≠ successfully completed. Unassigned is explicit, reassignment audited; deactivated Staff doesn't leave invisible tasks. Contact attempts remain existing contact_history, referenced from follow-up rather than copied into an unrelated ledger.

### Brief optional feedback after actual support

Proposed initial form: (1) Did this support help with the concern you brought to Legacy? not at all/a little/somewhat/a lot/not sure/prefer not to answer; (2) Do you feel better equipped? same bounded scale; (3) Did you feel less overwhelmed or more supported? reviewed plain-language response; (4) optional most helpful/what to change in one short text field; (5) optional next need selection. These are proposed wording/scales for approval, not an adopted instrument or clinical score. Keep it short; no obligation to write a story.

Pin feedback to actual service/registration, instrument version, question wording/scale, date and respondent/source (caregiver direct versus Staff-recorded verbatim phone response). Declined/not_asked/not_due/nonresponse are distinct from negative feedback. Do not convert Staff impressions to caregiver answers. Proposed one response per service/window with versioned correction, idempotent receipt; optional later follow-up may be a distinct timepoint, not overwrite. Confirm requested questions/scales and response window before implementation. Email feedback is later and separately authorized; initial portal or Staff phone/in-person can work without sending.

## 3. How to connect without repeated forms or duplicate data

One caregiver ID is the join key throughout; no journal/profile/Passport-specific new person. An owner-confirmed identity merge/correction path is required for duplicate records; do not auto-merge by unverified email. Show already-collected caring_for/contact/preference fields for confirmation only when relevant; don't silently infer needs from segment tags or old free text. Mark imported needs as proposed/unconfirmed, preserve provenance and let caregiver/authorized Staff correct them. A registration reuses contact/profile; ask only the changed need or service-specific minimum.

Logical reuse map (proposed, no schema delivered):

`caregiver → need history → recommendation/referral → existing registration/#369 request OR non-event delivery evidence → optional feedback → existing followup + assignee/due/completion`.

`contact_history` references the follow-up/service where useful; Staff notes remain notes, not counted services. Wellness check-ins may be displayed beside that timeline with their own versions/consent; neither score change nor chronological proximity proves service effect. Passport may receive a separately authorized content-free activity receipt, not a duplicate attendance truth. Journal text/reflections/sharing are excluded entirely from journey and reports, even if a member separately shares an entry with a restricted team. A journaled count/date, if approved, is usage only, never a needs/outcomes extractor.

All writes authenticate verified portal owner or current active Staff role, validate strict bounded fields, bind owner from server context, enforce same-origin/CSRF and recheck revocation within transaction/conditional witness. Revision/CAS plus unique operation/evidence keys make retries/concurrent Staff actions predictable; unknown write outcome reconciled rather than blindly repeated. Missing/old schema fails closed, no implicit migration or browser fallback. Future storage design must specify actual D1 transactions/constraints and migration order; this diagram alone is not an implementation contract.

## 4. Proposed caregiver and authorized Staff views

Caregiver portal: retain current membership/sign-in. One concise My Support/Journey view, contingent on #362/Profile integration, with “What I'd like help with” (current needs, update only changes), “Support planned/received” (clear recommended/scheduled/attended states, actual hours only if recorded), “How did it go?” (optional brief feedback after service), and “What's next?” (next action, date, contact). Read-only history can precede editable personal detail expansion. Empty/unknown/not-yet-measured states remain clear; no progress score implying improvement. Accessible/mobile layout, no new long form, no exposure of internal Staff-only notes/reporter identities or another caregiver's data.

Staff caregiver page: extend existing detail aggregate with a permission-scoped timeline and summary, not another disconnected console. Initial/current needs with provenance; recommendations/referrals vs received evidence and recorded hours; contact attempts/phone/in-person history; optional feedback marked caregiver-reported; existing wellness trend labeled descriptive; outstanding need/task assignee/due/status. Distinguish Staff observation and caregiver account. Authorized edit/correct/close actions need reason/revision; show stale-source warning rather than overwrite another Staff update. Staff workload queue surfaces due/unassigned/overdue without private journal content.

Reporting: begin with explicit cohort/window filters, data coverage and drill-through only for authorized roles. Small-number suppression/access controls and approved aggregate export minimize reidentification. No raw free text/notes, email/contact details or journal text in funder reports. Pseudonyms alone don't make exports anonymous. Funder definitions, recipients, consent purpose and secure delivery require approval; default no export until qualified.

### Metric definitions proposed for approval

Choose one documented timezone and half-open `[start,end)` windows; store instants consistently, display operational local time. Don't select a timezone/retention-period policy merely from a server default. Track data cutoff and metric version; count unique caregiver IDs after qualified identity reconciliation.

| Metric | Proposed numerator/denominator and missing-data rule |
|---|---|
| Requested vs received | Cohort = unique caregivers with explicit support request/need opened in window; received = those with qualified delivered evidence by cutoff. Report waiting/declined/unknown and follow-up length; don't divide all historical attendance by this month's requests. |
| Most-needed services | Count distinct caregivers per confirmed need type in cohort; multi-select totals may exceed people. Separate initial/current needs and unknown/unconfirmed history. |
| Time to service | First need/request timestamp to first matching actual delivered support; show sample size/median/range and still-waiting censored cases/coverage. Exclude missing/invalid timestamps from calculation but report their count; scheduled date is not delivery. |
| Barriers | Distinct needs/recommendations with recorded barrier divided by eligible assessed records; multiple barriers allowed, unknown/not-assessed shown. No-contact isn't inferred as a caregiver's choice. |
| Reported help | Approved positive response categories / valid respondents to that version/question/service-window. Also show invited/eligible/declined/nonresponders; don't put all served caregivers in the response denominator or count no answer as no benefit. |
| Continued engagement | Cohort with a second qualified service/contact in an approved follow-up interval / cohort with enough observation time. Define what counts; webpage clicks/newsletter opens not support receipt. |
| Unresolved needs | Confirmed needs still open/in_progress at cutoff, both people and need counts, age of need and missing status. Attendance alone cannot close them. |
| Respite hours | Sum validated actual non-overlapping delivered minutes/60, with coverage/missing count and correction cutoff. Do not multiply planned event length by registered attendees; avoid double-counting caregivers/loved ones. |

“Services delivered,” “caregiver-reported improvement” and “not yet measured” appear as separate reporting layers. Existing coarse outcome_status and wellness scores may be contextual, never substituted for service-linked feedback or proof Legacy caused a change. No clinical composite or fabricated outcome targets.

## 5. Proposed initial priorities versus later phases

### Phase0: approve plan and qualify dependencies

Requester approves terminology, short feedback and proposed views/phase split. Jacob/qualified owner resolves exact staging D1/additive migration authority, installed catalog/operating access, retention/export/backup/restore and required permissions. Inventory existing data completeness with authorized aggregate/synthetic evidence, no private dump. Reconcile #369/#362/Profile/0013/Passport source heads and real installation; no parallel migration number reservations. Define metric windows, evidence and consent rules with operating owner. This phase is a gate, not a launch date.

### Initial launch proposal, delivered in reviewed bounded increments

1. Extend existing Staff caregiver view/task/contact reuse with confirmed minimal needs and next-step assignment using existing due. Keep intake/profile prefilling to verified facts; no repeated long questionnaires.
2. Service timeline projection from current registrations + manual non-event evidence, with recommendation vs scheduled vs received distinction. Actual respite hours only after #369 lifecycle/storage is qualified and hours extension reviewed; if not ready, show unknown/unavailable and exclude hours report rather than invent results.
3. Optional small service-linked portal/Staff-recorded feedback, with consent/version/source and next-need option; no email dependency. Show delivered/reported/unmeasured distinctions.
4. One-page Staff journey/work queue and basic counts with coverage/missing-data labels. Pilot synthetic owner/Staff permissions and reconciliation before customer acceptance. Existing caregiver portal additions depend on its real gates, not an assumed installed profile.

Each increment needs exact-head independent review, meaningful auth/owner/idempotency/consent tests and authorized synthetic staging/D1 qualification, then requester approval and explicit release authority. Initial launch can be cut to ready surfaces; this proposed sequence doesn't silently change scope or assert all candidates must ship together.

### Later, only after evidence and decisions

Automated email feedback/reminders after sender/consent/suppression/retry authority; longer-term comparable follow-ups after stable instrument versions; fuller cohort reporting and qualified funder exports; integrated versioned wellness/Passport views after their own acceptance. Journal/wall stay separate protection-gated designs. No new AI/provider inference of needs, sentiment or outcomes; none is required to follow this journey.

## Decisions and proposed acceptance — no feature tests executed

Requester approval needed: plan arrangement, need labels/states, feedback wording/scale/optional flow, proposed view/initial scope and what “helped” means in reports. Existing customer goals stand; these are plan approvals, not another intake interview.

Jacob/qualified owners: exact installed schema/target and additive migration order; Staff assignment/role/record-correction policy; actual respite duration/evidence definition; reporting timezone/cohort/follow-up windows; consent/retention/removal/audit/backup/restore/export scope; separate sending/provider decisions. No change to #371 content publishing or journaling privacy gates.

Proposed acceptance cases: same caregiver reused across intake/contact/registration; foreign-owner/archived/revoked/Staff-role denial; duplicate registration/manual evidence counted once; scheduled/cancelled/no_show never “received”; partial/unknown/overlapping hours handled honestly; concurrent assignee/need corrections CAS/audited; phone/in-person contacts keep source; optional declined/no-feedback not negative; question-version comparisons refuse incompatible scales; new needs don't erase initial history; journal text absent from every projection/export/log; report denominators/censoring/missing values reproduced against synthetic fixtures; restore cannot resurrect removed records/permissions; email OFF does not block core journey. Actual supported D1/runtime qualification and requester acceptance would follow implementation, not this design checklist.
