# Respite pending requests

## Nov 28 composition handoff

PR #390 supplies the synthetic pending-request module and panel for the Support
composition branch. Use the interfaces here in place of the earlier checkpoint
signatures below.

| Surface | Contract |
| --- | --- |
| Owner view | `readOwnerRespiteView(db, ownerId)` loads the same owner's Profile, Support break indication and Staff grant. The five signals are independent. It returns `{ok:true,visible:false}` when none qualify. A visible view has available dates, owner receipts, participant selection summaries, current caregiver contact, question descriptors and the exact fictional acknowledgment text and versions. |
| Create participant | `createRespiteParticipant(db, ownerId, {request_id, details})` accepts the 15 reusable participant fields listed by `respiteParticipantQuestions()`. It returns the participant ID and revision. Repeating the same owner/key/details returns the same row and audit receipt. |
| Create pending request | `createPendingRespiteRequest(db, ownerId, body)` accepts exactly `request_id`, `participant_id`, `participant_revision`, `event_id`, `first_time`, `caregiver_onsite`, `privacy_ack`, `nonmedical_ack` and `acknowledgment_versions`. Both answers are booleans and both acknowledgments must be true. `acknowledgment_versions` echoes `{privacy, nonmedical}` from the rendered view. A mismatch requires showing the current wording again. The server chooses the stored versions from the pinned artifact. |
| Staff pending list | `readStaffPendingRespiteRequests(db, verifiedHumanStaffEmail)` returns up to 50 current pending receipt summaries after checking the active Staff/admin row before, during and after projection. The summaries contain event/date and request metadata for triage. |
| Staff eligibility | `setRespiteStaffEligibility(db, verifiedHumanStaffEmail, {caregiver_id, revision, enabled})` is the dedicated current-Staff CAS writer. First grant starts with expected revision zero. |
| Browser panel | `mountRespitePanel(root, transport, {onVisibilityChange})` takes verified-session `read()`, `createParticipant(body)` and `createPendingRequest(body)` transport methods. The tab shell uses the visibility callback. Call `reset()` whenever its owning session is invalidated, including page lifecycle transitions with restored DOM. |

The pending store reloads current Profile contact and the same owner's participant.
The snapshot has three objects: `participant`, `caregiver` and `session`.
First time and acknowledgment versions have dedicated request columns. The digest
includes date, participant identity/revision, all three snapshot objects, first
time and both pinned versions. The guarded INSERT detects concurrent contact or
Profile revision changes, rechecks nested participant details, and applies the
persisted eligibility, publication, future date and capacity predicates. The
pending row and metadata audit commit together. Each selected date uses its own
stable key and receipt. The panel retries unresolved writes on explicit action
using the original keys during the active attempt. A pending request uses zero
registration slots.

The Staff confirmation and first-time follow-up helpers remain source candidates;
the first pending-request composition exposes the read-only Staff list. If
confirmation is evaluated separately, its three-argument store resolves the same
pinned policy internally. Participant edit, withdrawal/removal, Staff booking,
reconfirmation, Attendance, notifications and export/restore belong to later
qualified lifecycle work.

### Selected schema and local fixture

The ordered source fixture is `tests/helpers/respite-fixture.mjs`. It runs the
actual selected Profile, Support and Respite DDL with foreign keys enabled and
runs only the Staff table DDL from `0011_staff_member.sql`. It seeds fictional
owners, a Staff row and marked future sessions. Schema order is:

1. `0001_init.sql` and `0011_staff_member.sql` table DDL.
2. `candidates/0022_caregiver_profile.sql` and `candidates/portal_support_request.sql`.
3. `candidates/respite_owner_lifecycle.sql` and `candidates/respite_pending_create_guards.sql`.
4. `candidates/respite_staff_eligibility.sql` and `candidates/respite_pending_eligibility_guard.sql`.
5. `candidates/respite_registration_insert_gate.sql`, `candidates/respite_registration_update_gate.sql` and `candidates/respite_followup_invalidation.sql`.

`respiteSchemaIsReady(db)` pins SHA-256 of ordered `sqlite_master` name/SQL
pairs for the selected Respite objects and checks the dependent read columns
and non-null audit actor constraint. The local fixture fingerprint is
`2425b87d17793f1575e3993732cb701f5b26a478a642a68573610d2e8f1a1181`.
The native qualification run must verify representation and batch semantics on
its selected binding. The old B1 DDL and the flat request snapshot are incompatible
with this fixture. Seed independently with the selected version artifact and the
nested snapshot, or drive the new stores.

### Ct13 integration seam

Ct13 owns shared portal/Staff dispatch, identity admission, body bounds,
CSRF/Origin, cache policy, tab shell, session teardown and packaging of
`portal-respite-ui.mjs`. Where an action is enabled, derive owner or Staff
identity on the server, admit only the qualified fictional test context, and
check the selected schema before reaching a store. A changed acknowledgment
requires a fresh form and explicit agreement. The checked-in panel accepts only
the transport supplied by that composition and ignores late results after reset.
Review evidence in this PR is local SQLite and DOM plus hosted source CI.
Authenticated HTTP, native D1, browser/device and installed TEST qualification
remain with the scheduled composition.

## Earlier source checkpoints

Source author ct5; donor369a8594de and321 history remain intact. This branch does
not merge the stale inherited backend stack or apply either candidate schema.

## Visual increment

The four-file static preview retains all21 exact read-only question labels and
privacy/acknowledgment draft wording from369a8594de. It removes the hidden live
form and all scripts; there are no inputs, API calls or submission. CSP denies
connections/form actions. Cream/terracotta layout uses existing site styles and
wordmark. Build outside the checkout with scripts/build-respite-visual-preview.mjs.
It is a question/layout preview, NOT a working registration form, confirmed
place, authorized policy implementation or a new request for customer wording.
No physical browser/mobile rendering proof is claimed by source tests.

## Reconciled model choice for the next source increment

- Reuse B1 field bounds/question wording and proven review/CAS/audit patterns;
  do NOT run its public email/identity-resolution producer alongside the new model.
- New-model participant/request is the selective target. Existing verified
  caregiver identity/contact/Profile remain the caregiver surface; participant
  details describe the loved one. No new caregiver upsert or copied identity proof.
  Split the old B1 combined snapshot validator before reuse: its caregiver contact
  fields cannot become browser authority or a duplicate editable caregiver profile.
- Create must derive caregiver_id from the verified session; verify participant
  ownership/revision and eligible published session; persist a pending request,
  current privacy/nonmedical acknowledgment versions and metadata-only audit with
  stable key/digest. It must NOT create a confirmed registration or reserve a seat.
- Read queries by verified owner and uses a bounded projection; Staff details
  require verified current Staff role at projection/write time. Never reuse a
  generic registration list as private respite intake.
- Staff follow-up/review/confirm must target the SAME participant/request model,
  exact revisions, first-time follow-up, current participant snapshot and explicit
  acknowledgment versions. Material changes invalidate prior review and cancel an
  active reservation before returning to pending; reconfirmation must recheck all
  predicates, not reuse a stale Staff decision.

## Exact missing capacity prerequisite

Old0019 adds event.respite_review_required; its eligible session query requires
that marker=1, published and future. Capacity is event.capacity and counts
registered/attended registrations. The newer lifecycle SQL alone does NOT port
that event marker or the old registration capacity/producer protection. Therefore
it is not a complete replacement migration/registration producer. The next source
must selectively carry the marker/eligibility/capacity protections into a reviewed
unnumbered new-model schema proposal, not apply both table models together.

Atomic confirmation must recheck current Staff/nonarchived owner, eligible event,
capacity and exact fresh request/participant revisions, then create/link the
registration + status + audit all-or-none. Generic registration and Attendance
writers must not bypass that gate, revive a removed request or change its
owner/event. Withdrawal/removal must cancel first; invalidate/unlink EVERY
referencing request with revision+1 before participant deletion, including pending.
Restricted audit and backup retention are distinct from active detail removal;
removal ledger/restore suppression remains unfinished, not an erasure promise.

## Ownership and next bounded checkpoint

Ct5 owns dedicated selective producer/read/lifecycle source and visual preview.
Ct13 owns shared portal/Staff server dispatch, verified identity and session
teardown; coordinate exact imports/routes against the then-selected composition.
Ct41 owns donor321–362/366–367 lineage triage. No branch deletion or donor closure.

Accepted next bounded source checkpoint: Nov25 06:00 UTC for a new-model create/
owner-read candidate and exact Staff confirmation/capacity proposal/tests or the
specific remaining implementation gap. This advances the previous Nov25 noon
reconciliation checkpoint; it is not a complete collection-enabled TEST date.
SatNov28 review-only look remains separate. Collection OFF; no SQL/migration,
runtime, live recipient, mail, operator or customer action follows from this branch.

## Pending create/read source increment — Nov24 evening

functions/_lib/respite-pending-store.mjs now supplies strict create-body validation,
createPendingRespiteRequest(db,serverOwnerId,body,serverAckVersions), and bounded
readOwnerRespiteRequests(db,serverOwnerId). The existing participant must already
belong to that verified caregiver and match the submitted revision. Snapshot is
copied from the server participant row, not a browser caregiver/email/medical
payload. Stable owner-scoped key/digest reconciles replay and lost acknowledgment;
changed payload conflicts. Creation records pending/needs_review and a metadata
only audit together. It NEVER creates registration or reserves capacity.

The retained lifecycle SQL from369a8594de is copied byte-for-byte, plus a separate
UNAPPLIED prerequisite/supplement adding the explicit event marker and pending
insert guards. Those guards recheck owner, participant revision/snapshot and future
published marked event at write time; audit failure rolls back the request. No
marker is populated and no table is applied externally. Local SQLite tests are
not native D1 batch proof. Actual server dispatcher must verify the exact reviewed
schema/trigger preflight before calling the store; a flag or table name alone is
not schema qualification. No route or activation is supplied by this increment.

Six synthetic SQLite tests pass for typed/acknowledgment rejection, pending/no-seat
creation, owner isolation, replay/conflict, stale/foreign participant, owner/
participant/session races, audit rollback and lost acknowledgment. No real data,
HTTP, mail or customer action.

Still unbuilt: participant creation/field split validation, full private detail
read/edit UI, complete same-model Staff follow-up/reconfirmation/capacity workflow, generic registration/Attendance protection, removal ledger/restore and
native D1/schema/authenticated composition qualification. The oldB1 producer is
not activated as a substitute. This delivers the bounded Nov25 06 create/read
candidate early; it is not a complete registration candidate or TEST launch date.

## Registration insert/capacity guard increment

A separate UNAPPLIED SQL candidate now blocks generic registration INSERT for
marked respite sessions, requires a current same-owner/event/participant reviewed
new-model request and current eligible Staff row, rechecks published/future session
and registered/attended capacity inside the insert, and locks event marker removal
while requests exist. It does not prove the initiating actor: authenticated Staff
identity must still come from the owning server adapter. Four synthetic SQLite
cases cover generic bypass/pending-no-seat, duplicate reference/full-capacity
rollback, reviewer/owner/event/participant drift and marker bypass. This is NOT a
complete Staff confirmation writer: the first-confirmation store below now composes review/link/CAS/audit, while
cancellation/reconfirmation/Attendance/update guard paths and native D1
qualification remain unbuilt. No migration is numbered/applied or marker populated.

## First-confirmation store increment

confirmPendingRespiteRequest(db,verifiedStaffEmail,{id,revision},serverAckVersions)
is now an unmounted candidate. It checks current Staff, pending exact revision,
fresh acknowledgment versions and first-time follow-up before composing review,
capacity-guarded reservation, request link/revision and metadata audit in one batch.
A forced NOT NULL audit guard aborts stale/zero-row/intermediate eligibility
failures rather than committing an unaudited or unlinked reservation. Lost
acknowledgment returns outcome_unknown; the caller must refresh/reconcile, never
automatically repeat confirmation. Identity still belongs to the verified shared
server adapter, not this email argument. No participant fields enter audit.

Six synthetic SQLite tests cover successful/stale confirmation, Staff/ack/follow-up
gates, full capacity and eligibility races, audit rollback, lost acknowledgment,
and mid-batch Staff revocation. This does not supply the Staff follow-up writer,
reconfirmation/cancellation/Attendance UI or HTTP routes, native D1 batch/results
qualification, schema preflight or activation. All schema candidates remain
unapplied and collection OFF. Existing static previews are unchanged.

## Per-session detail / participant revision distinction

Donor369's owner update changes a request's session-specific details and clears
Staff review/follow-up without necessarily rewriting the base participant record.
The reservation guard therefore checks the participant revision is current and
request details are present, NOT that request JSON equals base participant JSON.
Initial creation still snapshots exact participant JSON. Confirmation requires
fresh reviewed_revision equal to the current request revision. A local regression
proves a changed session snapshot cannot reserve under the stale decision, then
can reserve after fresh review while the participant base remains unchanged. No
registration/Attendance/update bypass or runtime activation is inferred.

## First-time follow-up attestation store

completeRespiteFirstTimeFollowup(db,verifiedStaffEmail,{id,revision}) now records
one current Staff attestation on a pending first-time request, with exact revision,
current participant/owner predicates and metadata-only audit in one batch. It
creates no registration and is not evidence a phone call/email was delivered.
Duplicate/stale commands conflict; unknown acknowledgment requires refresh rather
than automatic replay. A separate unapplied trigger requires material session/
participant/first-time changes to clear old follow-up metadata, matching the donor
owner writer's existing invalidation behavior. Five additional SQLite cases prove
record→later confirm, refusal/revocation, audit rollback, fresh-follow-up after
changed needs and lost-ack handling. Actual UI/HTTP/action authorization, linked
reservation cancellation/reconfirmation, Attendance/update protection and native
D1/restore/removal qualification remain unfinished; collection stays OFF.

## Registration update integrity increment

An unapplied UPDATE guard now pins registration identity/source/request reference
and refuses generic cancelled/no-show→registered/attended revival until a dedicated
audited reconfirmation/correction protocol is implemented. Cancellation remains
possible so review invalidation/removal can cancel first. An already reserved,
freshly reviewed linked request may become attended after the session date without
adding a seat or treating the historical reviewer's later deactivation as erasing
that decision. Current acting Staff authorization remains the server adapter's
responsibility; SQL guards do not identify the actor. Four local cases cover
attendance, cancellation/revival, identity relabeling and invalidated review. The
confirmation/follow-up suite also loads the combined new guard set. This is not an
Attendance HTTP writer or an accepted historical correction workflow. The latter
must be implemented/qualified before collection activation; no runtime policy is
changed by this unapplied candidate.

### Available-date read increment (Nov 25)

`readAvailableRespiteDates(db, serverOwnerId)` is an **unmounted read helper**,
not the conditional-tab authorization boundary. Its caller must derive and
qualify the current owner and the approved respite eligibility signals. It
returns at most 50 marked, published, future sessions with known positive
capacity and fewer registered/attended registrations than capacity. Null/zero
capacity and invalid dates fail closed. Pending requests do not reserve seats;
no private participant details, registration roster, or remaining-seat count is
returned. The owner is checked before and after the query. This read is only a
snapshot: the eventual pending writer still requires atomic current-session and
capacity checks; this increment does not add them or authorize a booking.

Four inert SQLite regressions cover date/marker/publication/capacity exclusion,
registration status accounting, owner revocation during the read, projection,
stable bounded ordering and zero writes. Native hosted D1, mounted routes,
eligibility mapping, participant creation and browser tests remain separate.
No schema, configuration, runtime flag, fixture or provider action was taken.

### Pending-write capacity race guard (Nov 26)

The unapplied pending-create guard now rechecks positive known capacity and
registered/attended occupancy at INSERT time, matching the available-date read.
A session becoming full between selection and creation aborts the request and
its audit batch. Pending requests still consume no seats and may exceed the
number of eventual places; Staff confirmation must independently recheck seats.
Two added inert cases cover zero/null/full capacity races with atomic refusal,
and multiple pending requests/cancelled registrations without seat consumption.
The confirmation-fullness regression creates both pending requests before the
first confirmation consumes the last seat, preserving the separate confirmation
race test. Candidate SQL only; no migration or runtime application occurred.

### Persisted eligibility mapping (Nov 26)

The pure, unmounted `projectRespiteEligibility` maps the five approved signals:
Profile `fields_json.respite_interest` exact `Yes` / `Maybe`; Profile
`fields_json.support_needs` containing exact `Respite care`; verified-owner
Support receipt `needs` containing `break`; and a server-qualified Staff enable
boolean. The reviewed static preview used lowercase illustrative interest values;
those are not the persisted Profile contract. The projection returns only reason
labels and visibility, never private answers/messages. Missing/malformed required
server inputs return unavailable, not an invented negative answer.

The existing Profile loader binds current caregiver identity; Support owner reads
must be composed for the same identity. No request-body booleans can substitute
for either. **Concrete remaining dependency:** there is no qualified persisted
Staff-enable source/writer in this selected candidate. The boolean is an explicit
server-composition input, not a new capability, client field, schema column or
assumed default. Ct13 composition must either qualify that source with reviewed
storage/Staff authorization or keep the corresponding capability unavailable.
The projector is not authentication, authorization to collect, or an atomic
write-time eligibility guard. Participant producer/field split and current
acknowledgment-version composition remain unfinished; no complete Nov26
prerequisite milestone is claimed by this increment.

### Staff-enable proposal fence (Nov 26)

Ct13 independently found no authoritative existing field in main/Profile/Support/
Respite and accepted ct5 ownership of the inert proposal, retaining authenticated
Staff routes and server composition. Proposed `respite_staff_eligibility` has one
row per caregiver, explicit enabled/revoked state and monotonically increasing
revision. Current active Staff/admin and current owner integrity predicates guard
both create and update. Revocation updates the row rather than deleting history.
No agent-editable segment tag or `is_caregiver` classification substitutes.

Four SQLite tests cover grant/revoke, revoked and incorrect-role Staff, archived
owner, identity lock, stale CAS and transactional rollback on audit failure.
These test DDL and a synthetic batch, **not a completed production writer**. The
remaining writer must accept only server-verified Staff, validate typed body,
CAS exact expected revision and atomically append metadata-only audit; no audit
is enforced solely by this table. Pending INSERT must re-evaluate independent
Profile/Support/grant signals so revoking a grant prevents new requests when no
other signal qualifies. That eligibility guard, persisted-grant loader, route,
and native D1 proof are still missing. SQL stays unapplied and unnumbered.

### Staff grant writer increment (Nov 26)

`setRespiteStaffEligibility(db, verifiedHumanStaffEmail, command)` now proposes
the dedicated typed CAS writer. Revision zero creates, positive expected revision
updates; enabled is a strict boolean and actor keys are rejected. Current Staff
and caregiver predicates precede the write; candidate triggers check again at
write time. Metadata audit is in the same batch and refuses zero-row writes or
mid-batch Staff revocation. Stale preflight is conflict; transaction/acknowledgment
uncertainty is outcome_unknown, never automatic replay. Five inert SQLite-backed
writer tests pass, including concurrent CAS, revoked Staff, audit rollback and
lost acknowledgment. This supersedes only the prior “writer missing” note.
Authenticated dispatcher/current-human admission, grant loader, eligibility
recheck at pending INSERT and native D1 qualification remain unfinished.

### Atomic pending eligibility fence (Nov 26)

The separate unapplied `respite_pending_eligibility_guard.sql` re-evaluates the
five independent persisted owner signals at request INSERT. Staff revocation
therefore prevents a new pending request when no Profile/Support signal remains;
a separate qualifying signal still works. Missing prerequisite schemas fail
closed. Five inert SQL tests cover all signals, cross-owner negatives, grant
revocation, Profile/Support changes before INSERT and absent schema. These tests
use minimal shape-compatible read-source tables, not full composed/native D1
qualification. Review/apply ordering must include actual reviewed Profile,
Support and Staff-grant schemas. No route or migration activation is added.

### Pinned synthetic acknowledgments increment (Nov 26)

`readRespiteAcknowledgments()` exposes deeply frozen exact fictional-only text
from the reviewed visual preview, each with a sha256-of-UTF8-text version. The
pending store now requires exactly those server-context versions and rejects old
`draft_test_v1` fixtures before writes. These are synthetic qualification policy
identifiers, not an approved real collection policy. Tests recompute the hashes,
match both displayed paragraphs exactly, reject extra/accessor/stale context and
verify immutable artifacts and zero writes on retired versions.

Ct13 must serve these exact texts and versions from the same selected source
and derive current context server-side. Client booleans remain affirmative
acknowledgments only. An authenticated rendered-version binding to detect a form
left open across policy changes is still a route/form composition requirement;
this helper alone cannot prove what a user saw. Confirmation fixtures still use
separate synthetic draft versions and must be reconciled to this artifact in the
composed fixture packet. Participant producer/field split remains unfinished.

### Participant field split increment (Nov 26)

`validateRespiteParticipantDetails` carries retained B1 question keys/bounds into
an isolated pure helper, without importing B1 HTTP/auth side effects. Reusable
private details include loved-one name/optional age/relationship, support and
emergency details, personal-care/medication support booleans. Caregiver identity,
name/email/phone are excluded and must come from existing verified caregiver and
Profile reads. Requested session, first-time, caregiver-on-site and affirmative
acknowledgments are request context, not reusable participant fields. No approved
question is removed; those excluded from this object still need composed display
and request snapshot handling. This is the proposed implementation split, not a
newly approved customer feature or complete producer.

Four pure tests cover strict question limits, conditional explanations, private
field shape and rejection of identity/contact/session/consent injection. The
participant create/read writer, idempotent creation, session-context/digest
snapshot extension and composed fixture contract remain unfinished. Initial
pending-store fixtures with arbitrary participant JSON are not full field-schema
qualification and must be upgraded before the completed candidate handoff.

### Participant create/private read increment (Nov 26)

`createRespiteParticipant(db, serverOwnerId, {request_id,details})` validates the
private field contract and derives a stable participant ID from SHA256 of the
owner/key pair. Same key and canonical details reconcile without another audit;
changed details conflict rather than overwriting a participant. Different owners
cannot collide using the same client key. Current owner qualification is checked
at INSERT and audit is in the same batch. Lost acknowledgment reconciles only an
existing same-owner exact snapshot; otherwise outcome_unknown, no automatic retry.
No caregiver contact/identity upsert occurs. Metadata audit records revision only.

`readOwnerRespiteParticipants` returns at most20 same-owner private participants,
rechecks current owner after the read, and refuses incompatible persisted JSON.
Five inert SQLite-backed tests cover isolation, idempotency, injection, archive
races, audit rollback, lost acknowledgment and corrupt-shape refusal. No HTTP
route is mounted and this is not a native D1 or real-collection acceptance.

Remaining integration: selected request session-context snapshot/digest extension
for caregiver-on-site and verified caregiver contact, composed form/acknowledgment
version binding, strict schema/trigger preflight and complete fixtures. The old
statement that participant create/read is missing is superseded by this increment;
participant edit/removal and operating privacy/export/restore gates stay separate.

### Request snapshot shape increment (Nov 26)

`buildRespiteRequestSnapshot(participantDetails, serverContact, {caregiver_onsite})`
proposes `{participant,caregiver,session}` with private reusable participant data,
current verified caregiver/Profile name-email-phone, and the per-session on-site
answer kept separate. It validates contact bounds, refuses missing/coerced values
and copies inputs. Three pure tests cover field separation and strict failures.
The contact argument is not authentication; ct13 must supply it from current
verified owner reads. No client caregiver identity/contact is accepted by this
interface. First-time remains the dedicated request field; acknowledgment versions
remain dedicated request columns.

This helper is not yet used by the pending writer. Integrating it MUST replace
initial whole-JSON participant equality with exact equality of the nested
participant snapshot to the current participant revision, and include all request
context in the idempotency digest. Existing lifecycle edit validators/confirmation
fixtures must be reconciled; do not apply a mixed old/new snapshot schema. Until
that integration and its regressions land, the helper remains unmounted and the
candidate is incomplete. No preview/production behavior is changed here.
