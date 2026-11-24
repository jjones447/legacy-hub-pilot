# Controlled customer-test magic-link inbox candidate

[pc2-codex-ct-13] Jacob direction via GUI5/ct41 Nov24 03:14UTC. Isolated successor of38369fa280; preserves38188461422 and383 review pins. Six-file increment: portal-test-inbox.mjs, staff/test-inbox.js, portal dispatcher transport hook,23 focused tests, unit inventory and this packet. No schema addition, account mutation, flag configuration, deployment or live login.

## Contract and security boundary

POST `/api/staff/test-inbox`, body exactly `{action:"request"}` or `{action:"cleanup",token_hash:"<64 hex>"}`. GET/other methods, query aliases, non-JSON and missing/wrong Origin refuse. Existing `/api/staff/` middleware verifies Cloudflare Access JWT; handler additionally requires its unforgeable request-local human-staff capability and rechecks active admin in staff_member. Plain context, dev headers and publisher service identity cannot supply that proof. GUI5 needs a real verified admin session; browser HTTP200 alone does not prove it. No extra Jacob permission is needed.

Hard-coded origin `https://customer-test.legacy-hub-5qo.pages.dev`, ENVIRONMENT exactlypreview and PORTAL_TEST_INBOX_ENABLED exactly1 are required. Selected identity uses explicit PORTAL_TEST_INBOX_CAREGIVER_ID and PORTAL_TEST_INBOX_EMAIL pins; no addresses committed. Identity must be nonarchived, uniquely match normalized email, and have BOTH qa_test + exclude_reporting tags. Existing ordinary-list/reporting predicates recognize these markers; installed visibility/aggregate exclusion remains an execution qualification. No staff/member list or aggregate query is expanded by this source.

Existing portal preview-mail opt-in containment remains required for normal login/redemption. No EMAIL_API_KEY is required for this controlled transport. Production/nonpreview/other-origin requests cannot invoke capture even if flags and identity pins are accidentally supplied. Public login cannot create its internal WeakMap capability and never returns a link. Ordinary mail behavior is unchanged.

The protected endpoint invokes the existing login handler with the pinned email and private request-local capability. Existing rate limits, random opaque-token generation, hash storage, confirmation nonce/proof and one-use redemption remain. Captured tokens expire after5minutes; ordinary tokens remain15minutes. Token insertion rechecks current admin/QA owner in the same INSERT predicate. Delivery rechecks before/after metadata-only admin audit. Failed checks return generic errors; no fallback to external email for capture. This tests controlled application delivery, NOT external mailbox/provider acceptance.

The inbox is one transient no-store/private JSON response to the authorized admin, containing delivery label, link, token_hash and expires_at. No new plaintext table, public page, localStorage, logs or token-bearing audit fields. No persistent inbox retention. Operator must keep response/links out of console logs, traces/screenshots/shared artifacts and use a separate fresh caregiver browser context for normal Continue. Never transfer the admin Access session into that context.

## Cleanup and unknown outcomes

POST cleanup marks only the supplied hash for the pinned QA owner used, guarded by the same current admin/QA predicates; unrelated owners are unchanged. Normal consumed tokens stay consumed and expire naturally. Cleanup does not revoke an already issued portal_session: sign out normally and close the isolated browser context after QA. Re-archive the selected QA row through the existing guarded executor plan, retaining QA tags; this endpoint does not change rows.

A lost request/response can leave an undisclosed token until expiry. Do not blindly retry: record unknown outcome and allow the five-minute bound to expire before another scoped request, or reconcile privately if the token hash was received. This is not a durable/idempotent mailbox. No automatic delete of audit/history/token rows. Before runtime, confirm correct TEST DB binding and unchanged production via provider readbacks; source hostname checks alone do not prove binding isolation.

## Validation and remaining gates

23 local HTTP/SQLite tests and2360 whole-suite tests PASS; template verification/build115files/diff clean. Actual ordinary confirmation GET/POST is exercised: GET issues no portal_session, Continue consumes once, replay/expiry refuse. Refusals cover prod/development/missing config/wrong origin, fake proof/nonadmin/deactivated/archived/unmarked/one-tag/duplicate-normalized-email/wrong pin, method/query/Origin/type/body injection, downgrade/marker removal at write, downgrade before delivery, public forged context and scoped cleanup. Existing middleware signature tests run in the full suite; fixtures use synthetic server proof, not actual Access/browser evidence.

Required before operation: retained exact-source Security/functional review and hosted green; normal approved source integration; deployed TEST binding/flags/pins and admin-session qualification; recognized QA identity classification and installed exclusions; safe Shanelle window; isolated normal Continue/Profile save/reload and scoped cleanup readbacks. No deployment/readiness or external delivery is claimed. GUI5 owns browser operation after approved/green integration, ct13 owns auth/mail source and execution coordination. Customer Profile acceptance and separate support source remain distinct. Handoff fulfills06UTC source-or-gap checkpoint only.

## November 24 Security correction

Both `LEGACY_TEST_INBOX_ENABLED=1` and `PORTAL_TEST_INBOX_ENABLED=1` are required,
in addition to exact preview environment and customer-test HTTPS origin. Production
is explicitly refused before bindings even with both flags. No runtime flags were set.

The existing write-time predicate requires BOTH qa_test and exclude_reporting plus
current active admin and the pinned unique caregiver identity. GET is deliberately
405/no-store for every principal: there is no stored plaintext inbox or GET token API.
The only link delivery remains the verified-admin POST response.

Authenticated POST `{action:"purge"}` removes only the selected QA owner's expired
or consumed portal_token hashes, rechecking current admin/QA eligibility in the DELETE.
Request performs the same purge before issuance; cleanup invalidates the selected hash
then purges. Normal customer tokens, live unused tokens, sessions and audit history are
untouched. After successful Continue, the operator calls purge; this does not revoke
the new portal session. Expiry alone denies redemption even before the next purge.
