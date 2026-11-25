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
