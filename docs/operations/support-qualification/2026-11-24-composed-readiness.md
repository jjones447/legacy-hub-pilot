# Functional Support composition readiness — November 24

Draft #387 combines the deployed #386 Profile base, ct5’s #382 Support modules and the projection and presentation from #389. The candidate is ready for source review. Support remains disabled on both TEST hosts and in production.

## Review scope

The dashboard and dedicated Support page validate the caregiver through the existing session handler. The Staff console validates the active staff member and verified Access identity. The opt-in capability response supplies an in-memory proof scoped to the authenticated principal, origin and session credential. Each owner or Staff Support read and write verifies that proof against its own authenticated request before touching private records. Session rotation clears the form. The ordinary caregiver dashboard response retains its existing contract.

Page hiding clears rendered history and form values. Browser restoration and focus recheck the session before displaying the form. Dashboard logout and account changes invalidate outstanding requests. Once the signed-in form has replaced public intake, only an explicit feature-off response restores public intake on that page.

Staff can read the fixed 50-row projection and update status through the dedicated endpoint. Both the status lookup and conditional update apply the same archived and internal-QA exclusions as the Staff list. The update also checks the current revision and Staff actor. Dedicated requests remain visible in Alerts. Staff use the dedicated status control for them. Bulk review applies only to ordinary follow-ups.

The static build includes the seven explicit Support browser modules and checks local imports. Local unit and DOM tests exercise these source paths. GUI5 owns authenticated browser qualification after the isolated D1 and review steps. The scheduled Security review is November 25, 11:00–12:30 UTC.

## Native D1 qualification plan

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
