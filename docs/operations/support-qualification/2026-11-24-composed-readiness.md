# Functional Support composition readiness — November 24

Candidate composes deployed #386 f090fcfc with ct5 #382 b79b707, preserving both
histories. The sole conflict was the unit inventory; both sets remain. All 2,383
unit tests pass. No deployment, schema application or activation follows. #383's
owner dispatcher is present but PORTAL_SUPPORT_REQUEST_ENABLED remains disabled.

## Concrete remaining work

- Ct5 owns Support page/controller/CSS and narrow portal/Staff presentation mounts.
  `mountSupportForm(root, transport)` returns submit/history/reset/dispose. Ct13 wires
  reset immediately on owner/session invalidation; dispose on navigation/unmount.
- Owner GET/POST `/api/portal/support-requests` contract matches the dedicated transport:
  server-derived owner, strict Origin/JSON, received receipt, same-key replay, conflict.
- Staff store `updateSupportStatus(db, verifiedEmail, body)` exists, but its server route
  is now mounted through the verified-human/current-active Staff HTTP adapter.
  GET fails closed until ct5 supplies readStaffSupportRequests(db, verifiedEmail).
- Proposed Staff list is NOT implemented: GET `/api/staff/support-requests`, no query,
  max50, fixed projection of id/caregiver_id/revision/needs/preferred_contact/message/
  status/created_at/updated_at/followup_id, exclude archived and internal QA owners.
  Do not substitute owner history for that Staff projection.
- Browser modules use `.mjs`; current static build allowlist excludes `.mjs`.
  Final mounting must include the explicit browser-module assets and a dist import
  closure test. No assertion that the current compiled artifact can serve those modules.
- Candidate schema remains unapplied. Native D1 must qualify batch transaction rollback,
  changes() audit gating, idempotency, Staff CAS and revoked-eligibility races before
  activation. Source SQLite tests do not replace native proof.
- Final exact composed Security/functional review and four hosted checks are required.
  Preserve Profile, People, capture, Reviewed controls and the named-host correction.

Planning: ct5 full source Nov26 noon remains the last accepted author checkpoint.
Ct13's conditional Nov27 12–16 integration reservation supports QA16–18 only with
complete reviewed/green input and an accepted operator window. This preparation
is not a new unconditional Nov27 customer date or an accepted external review slot.

## November 24 server/session increment

The Staff adapter rejects disabled flags, unknown paths, queries, wrong methods,
non-same-origin writes, non-JSON writes and client actor fields. It derives the
actor from verified authentication and checks current active Staff authorization.
The status store retains its write-time eligibility and revision predicates.
A real dispatcher test exercises the SQLite-backed success and stale-revision
paths; it is not native D1 evidence.

The owner session transport validates /me before requests and rejects changed
owners or late responses after invalidation. The portal registration bridge
resets mounted Support views on owner change, logout initiation, session reset
and pagehide. Unmount callers dispose their views; pagehide uses reset to support
browser history restoration. Ct5's dedicated page still needs to mount the
transport and revalidate on restoration/focus before displaying owner data.

Packaging owner is ct5: scripts/build-site.mjs must explicitly include the
browser module closure, including portal-support-session.mjs. Ct13 owns the
final composed regeneration. No partial source increment is deployable evidence.

## Native D1 qualification plan (not executed)

Use a separately authorized isolated synthetic database, with a verified binding
that is neither production nor the shared customer-test database. Record candidate
schema hash and preimage, then apply only that candidate in the isolated fixture.
No database creation or schema application is authorized by this source packet.

Qualify concurrent same-owner/same-key requests, conflicting payload reuse,
owner isolation, archived or newly ineligible owners, and current Staff revocation.
Run concurrent status CAS writes and require one accepted revision and exactly
one audit record. Inject a failing statement into batch writes and verify complete
rollback, no orphan follow-up and no audit leakage. Confirm native changes()
semantics across the exact batch, including stale and no-op transitions.

Exercise the actual HTTP dispatcher with strict Origin/JSON/body-size and
client-owner/actor rejection. Verify the fixed bounded Staff projection excludes
archived and internal QA identities and leaks no uncontracted fields. Reconcile
unknown or late acknowledgments by readback, never blind replay. Retain redacted
counts/results and remove only scoped synthetic fixtures after evidence capture.

Activation requires that native evidence, completed UI/import closure, exact-head
functional/Security review and GUI5's authenticated browser qualification. The
Support flag remains off; #386's merge and customer acceptance remain independent.

Generic follow-up reconciliation: both `/api/followups` status updates and Staff
`/api/staff/followup/:id/resolve` now reject the immutable creation source
`portal_owner_support_request` with 409 `use_support_status`, before mutation or
audit. This guard does not require the candidate table or enabled flag. Dedicated
Support status remains authoritative; generic Reviewed/Done/Dismissed never imply
owner progress. Final Staff presentation must suppress those generic controls for
these records and direct users to the dedicated status workflow.
