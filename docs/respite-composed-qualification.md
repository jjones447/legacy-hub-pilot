# Working Respite TEST composition

The source combines the [Respite handoff](https://github.com/jjones447/legacy-hub-pilot/pull/390), the reviewed Support candidate and the Profile tab shell. The owner can request fictional Drop-In dates from the portal. Each accepted date produces a pending receipt, with zero registration places reserved. Staff see pending metadata for the one trial caregiver.

## Authentication and routes

| Context | Path | Operations |
| --- | --- | --- |
| Caregiver | `/api/portal/respite/session` | Returns the verified owner session proof and current visibility. |
| Caregiver | `/api/portal/respite` | Loads the private form, date and receipt projections, acknowledgment text, versions and display proof. |
| Caregiver | `/api/portal/respite/participant` | Creates one participant for the verified owner. |
| Caregiver | `/api/portal/respite/request` | Creates one pending receipt using the same session and displayed acknowledgment proof. |
| Staff | `/api/staff/respite/session` | Returns a proof for the configured active human Staff identity. |
| Staff | `/api/staff/respite` | Shows the pending list for the trial owner. |
| Staff | `/api/staff/respite/eligibility` | Reads or updates the trial owner's Staff eligibility grant using its exact revision. |

The routes require the preview environment, `PORTAL_RESPITE_TEST_ENABLED=1` and an exact named HTTPS Pages origin in `PORTAL_RESPITE_TEST_ORIGIN`. A comma-separated value can pin multiple approved origins. Portal routes also apply the existing preview login policy. The caregiver must match `PORTAL_RESPITE_TEST_CAREGIVER_ID` and have both `qa_test` and `exclude_reporting`. Staff must match `PORTAL_RESPITE_TEST_STAFF_EMAIL` and already hold an active Staff or admin row. On the configured preview, Staff Access checks use existing rows and require JWT verification. Dispatch checks the selected schema before storage access. Reads use `no-store`, and writes require a literal same-origin header and bounded JSON.

Private form contents and both proofs live in memory for the current session. A fresh session check precedes each request, and logout, navigation away from the panel, page restoration, or identity change clears private data. Pending submission uses separately keyed dates, the policy versions displayed by the form and the matching session-bound display proof.

## Hosted fixture manifest

- Use the ordered source list in [Respite pending requests](respite-selective-successor.md#selected-schema-and-local-fixture). The native local D1 schema fingerprint was `2425b87d17793f1575e3993732cb701f5b26a478a642a68573610d2e8f1a1181`. The SHA-256 of the ordered DDL source, with only the Staff table DDL from `0011_staff_member.sql` and newline-separated files, was `fe4a9301938533adf6023fd057ef5b5ea7bf3ae37743bcc5469aa2bdc7c109a8`.
- Record authorization, account, project, origin, D1 UUID and the pre-run bookmark. Use a separate designated binding. Preserve the existing Support QA fixtures.
- Qualify one pinned, active synthetic caregiver with both QA tags, one foreign synthetic caregiver and one preprovisioned active Staff identity. Use two available marked future sessions and one unavailable control. Use one designated synthetic participant and two stable per-date request keys. Save the exact generated record IDs and audit IDs privately.
- Verify all five independent eligibility signals, cross-owner and Staff boundaries, schema preflight, stale acknowledgments, two receipts, replay, capacity exclusion and a write with a forced audit failure. Expected final deltas are one participant, two pending requests, zero registrations, one participant-create audit and two pending-request audits. Record the Staff grant and revocation revisions. Verify audit metadata contains no private participant values.
- Agree on cleanup before fixture insertion. The grant history protection prevents deleting a revoked grant and can prevent deleting its parent caregiver. An approved restore to the isolated pre-run bookmark or an approved retained synthetic fixture covers this dependency. Record the cleanup or retention readback.
