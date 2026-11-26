# Selective respite successor: model and capacity fence

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
