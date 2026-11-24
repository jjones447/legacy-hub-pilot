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
  is not mounted. Ct13 owns verified-human/current Staff authorization and transport.
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
