# Caregiver Portal — what "done" means

## Present-Origin POST refusal — October 14, 2026

[pc2-codex-42] After the existing preview/development branch, production POST
`login`, `wellness` and `logout` reject a present Origin unless its literal value
exactly matches the request URL's serialized origin. Empty, opaque `null`, paths,
credentials, multiple values and scheme/host/port mismatches fail with generic
403/no-store before credentials, cookies, bodies, limiter, database or mail.
No supplied Origin is parsed, normalized, reflected or trusted as a Host header.
GET and unknown actions are unchanged; preview refusal/logout still precede even
the Origin read, with no identity or database access.

Actual header absence (`Headers.get` returns null) retains existing transport
compatibility. It does **not** establish same-origin or close CSRF: missing-Origin
fallback/token defense, native-client spoofing, XSS and session/archiving races
remain separate. [OWASP's guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
recommends validated origin evidence or another CSRF defense; this deliberately
bounded change implements only explicit present-Origin mismatch refusal.
New fake tests make no real database/mail/network requests. Source acceptance is
not installed behavior or proof of exploitation; full original Functions and
staging-first qualification remain separate from this header guard.

## Portal response cache policy — October 14, 2026

[pc2-codex-42] Source sets only `Cache-Control: no-store` on every response
constructed by the portal GET/POST handler: JSON successes and refusals, preview
and configuration errors, unknown routes, generic failures, verification HTML
errors and session redirects, and production/preview logout. Existing status,
body, content type, Location and cookie fields are unchanged. Referrer policy
already lives in the global middleware and is not duplicated here.

New fake-binding response-metadata tests do not access a real database, send mail
or make network requests. This source policy is not evidence of live leakage or
installed behavior. It does not purge earlier copies, override every edge policy,
revoke copied sessions, or close the separate archive races. The changed handler
needs a separately qualified full Functions package and staging-first installed
checks; an older compiled worker or static-only upload is not source parity.

## Nonarchived-caregiver guard — October 14, 2026

[pc2-codex-42] Source now checks the existing `status != 'archived'` caregiver
contract before redeeming a fresh token or accessing wellness GET/POST. Identities
found missing or archived at these checks cannot receive a session or successful-login audit, read
wellness history, or reach POST body parsing/writes. Identity checks fetch only
the bounded ID, not profile fields. Store failures fail closed with a generic
error. `inactive` remains eligible under the existing contract; no lifecycle,
schema, email, configuration or staff/agent change is introduced.

The single-use token UPDATE additionally requires a matching nonarchived
caregiver in an `EXISTS` predicate, and accepts only numeric `meta.changes === 1`
without a reported failure. This closes an archive/delete **before that claim**;
it is not a transaction with the subsequent audit/session issuance. An archive
after the claim can race issuance. Wellness lookup and later history/write are
also separate operations, so archiving between them is not atomically excluded.
Ambiguous claim metadata fails closed but may leave an already-committed token
consumed; no compensating reuse is attempted. This is not global session
revocation: copied-cookie expiry/logout, cache/origin and limiter work remain
separate. Preview containment still executes before any identity/data access.

Named tests use synthetic in-memory SQLite and fake bindings, not Cloudflare D1
or a real caregiver. Source, independent review, CI, installed runtime and client
acceptance remain separate; this section claims no deployment or live test.

## Shared-preview containment — October 13, 2026

[pc2-codex-42] Current source disables caregiver API access when `ENVIRONMENT` is
`preview` or `development`, before reading credentials, identity or data. Login
and verification fail with `503 preview_portal_disabled`; `/me` and wellness
reads/writes also refuse old signed sessions. POST logout only clears the browser
cookie, without looking up the old identity. Public staging pages and staff
Access routes are unchanged; preview email stays OFF. Production emailed login
is unchanged and never returns a usable sign-in link in its API response.

The retired `PORTAL_DEV_RETURN_LINK` setting no longer enables access, even if
it remains in an old provider configuration. The tradeoff is that shared-preview
caregiver dashboards and check-ins are unavailable until a separately reviewed,
identity-protected, noncustomer test arrangement exists. Do not restore the bypass
to complete a walkthrough. This source change is **not installed containment**,
global token deletion, production session revocation or client acceptance.
Installation must qualify the correct preview environment marker/bindings and
all supported aliases under the existing release/technical disposition. Removing
the containment later could reactivate unexpired old bearer credentials: do not
roll it back without a reviewed credential/data-isolation recovery plan.

## Historical proposal — not the current closeout checklist

Status clarification, October 10, 2026 [pc2-codex-13]: the September 6 text below is
preserved as history. Its proposed phase split, unchecked boxes, account-setup
statements and "Recommended next step" are not current assignments or evidence of
an installed defect. In particular, do not rebuild the caregiver-facing read or ask
Legacy to re-decide registrations versus grants based on that recommendation:
[the existing dashboard](../app.js) and [portal handler](../functions/api/portal/%5B%5Bpath%5D%5D.js)
already implement scoped reads. Caregiver magic-link sessions and staff Cloudflare
Access are distinct authentication paths; source implementation does not prove
current installed access or email delivery.

The customer-folder `Legacy_Delivery_Tracker.md` and
`2026-10-02 - Portal requirements and work slices.json` remain the Phase 1/2 scope
and execution queue. Authorized maintainers can follow the existing
[private acceptance guide](https://github.com/jjones447/legacy-caregiver-hub/blob/main/docs/acceptance/README.md)
and [journey map](https://github.com/jjones447/legacy-caregiver-hub/blob/main/docs/journey-map/README.md).
Reuse the dated D2/D4/D5 staging evidence; do not turn later enhancements into
Phase 1 acceptance gates. Built, reviewed, CI-passing, runtime-verified, deployed
and client-accepted are separate states. This clarification closes no acceptance
criterion, authorizes no live test or client send, and changes no signed scope.

## Preserved September 6 proposal

Written 2026-09-06 by pc1-cc-gui-2. The portal task has carried the note *"scope and acceptance
criteria are not yet written down"* since 2026-08-21; this closes that gap so the next touch base
has something concrete instead of "still in progress".

**This is a proposal, not an agreed scope.** Jacob owns the portal build. Nothing here has been put
to Legacy, and the Phase 1 / Phase 2 split below is the part most worth arguing about before it is
promised to anyone.

## What exists today

**Corrected 2026-09-06 (second pass).** The first version of this table was wrong in the other
direction: it described `portal.html` as a login screen only and concluded that "everything a
caregiver would actually log in for" was missing. It is not. Phase 1 is essentially built.

| Piece | State |
|---|---|
| `portal.html` | Login view **and** a full signed-in dashboard (`#dashView`): welcome, membership, grant status, registered events, socials |
| `app.js` | `checkPortalSession()` swaps the views on load; `renderPortalData()` populates the dashboard |
| `functions/api/portal/[[path]].js` | `login`, `verify`, `logout`, `me` — `me` returns profile, grants and registrations, all scoped to the session caregiver |
| `schema/0005_portal_login.sql` | `portal_token`: token hash, caregiver id, expiry, single-use flag |
| Auth model | Magic link, hashed and single-use, with a signed `portal_session` cookie. No password stored |

So the honest position is that the caregiver-facing read exists end to end. What it has never had is
a run against real data with a real caregiver, which is what "test the paths, then walk them with
Shanelle" is for.

## What the portal is for — already answered, 2026-09-06

**Correction to the first version of this document.** It asked Jacob what a caregiver gets by
logging in. That was the wrong move: the answer already exists in
`legacy-caregiver-hub/docs/architecture/overview.md` and `data-model.md`, written before this
engagement was signed. Asking a client to re-decide a settled design is how a project loses time.

The architecture is explicit:

- **Trust boundary 2:** *"Caregiver → portal: sees exactly their own record slice, via Access
  identity."*
- **The `caregiver` row is the design centre**, and four tables hang off it that are inherently
  personal: `registration`, `grant_application`, `social_visit`, and `followup`.
- **Sign-in is Cloudflare Access email-link, no passwords**, role-gated for caregiver and staff.
  The magic-link table already in `schema/0005` is an implementation of that decision.
- **No public path to D1.** Workers only, and the portal reads a caregiver-scoped view keyed to the
  Access identity so it *cannot* query another caregiver.

So the portal's purpose is settled: **it is where a caregiver sees their own slice of the record —
what they have registered for, where their wellness grant stands, and what Legacy owes them next.**
Everything informational stays public, which is the right instinct and is what the design already
does: the Resource Hub, directory, programme pages and calendar are all open.

**Correction, 2026-09-06.** An earlier version of this document called the `portal_token` table a
gap against the architecture's "Cloudflare Access" sign-in, and recommended reconciling the two.
That was wrong, and reading the test suite settles it. The split is deliberate and correct:

- **Staff and agent surfaces use Cloudflare Access**, verified as a real RS256 JWT against the
  team JWKS in `functions/_middleware.js`, failing closed until Access is provisioned.
- **Caregivers use the signed `portal_session` cookie** minted from a hashed, single-use, expiring
  magic link. Putting several hundred caregivers into an Access seat model would be both costly
  and wrong for the audience.

The portal side is in better shape than this document first credited. `tests/portal-login-v0.test.mjs`
already covers the parts that matter: a non-member email returns a generic response and does not mint
a token, tokens are stored hashed, reuse is blocked, the session is domain-separated so a magic-link
token cannot be pasted in as a session cookie (SEC-3), and auth fails closed with 503 if
`PORTAL_TOKEN_SECRET` is missing. Several Phase 1 boxes below are effectively already met.

## Phase 1 — done means all of these

- [ ] **A caregiver can get in without a password.** Enter email → receive a link → land signed in.
      Single-use, expiring, and the token is stored hashed. The schema already assumes this.
- [ ] **A wrong or expired link fails kindly.** Plain language, a way to request another, no stack
      trace and no jargon.
- [ ] **A signed-in caregiver sees at least one thing that is theirs** — Phase 1 target is *my
      registrations*, because it is the least sensitive of the three and exercises the whole path.
- [ ] **Signing out works and actually invalidates the session**, verified by trying the back button.
- [ ] **Someone who is not signed in sees the login screen, never partial data.** Verified against a
      real request, not by reading the code.
- [ ] **It works one-handed on a phone.** This audience is often reading beside someone they care
      for. Same standard as the tile work: real tap targets, tested at 375px.
- [ ] **Nothing sensitive appears in a URL.** No email, no token, no caregiver id in a query string.
- [ ] **No email is sent from a preview or staging deploy.** A test login must not mail a real
      caregiver.

## Phase 2 — deliberately not Phase 1

Grant status, saved resources, profile editing, notification preferences. Each needs its own data
model and its own privacy conversation with Legacy. None should hold up a working Phase 1.

## Constraints that are not negotiable

- **Fails closed.** Legacy's Cloudflare Access is not configured yet, so the staff console fails
  closed today. That is correct behaviour and must not be "fixed" by loosening it.
- **D1 bindings do not follow a project across accounts.** When the site moves to Legacy's Cloudflare
  account, the portal database must be recreated and rebound there. A deploy can succeed while every
  portal page is quietly broken. This is called out in the cutover runbook §1.5 and is the single
  most likely way the portal breaks at go-live.
- **Real caregiver data is real personal data.** No production caregiver records in test fixtures,
  no seeding a preview environment from live data.
- **Deploy is manual.** Merging ships nothing.

## Recommended next step

Not a client question. Two internal ones:

1. **Registrations or grants first?** Both are in the data model. Registrations exercise the whole
   path at lower sensitivity, so they are the safer first slice — but if Legacy's real pain is grant
   status enquiries, that ordering should flip.
2. **Build the caregiver-facing read.** The auth spine is done and tested; what is missing is a page
   that shows a signed-in caregiver their own registrations. That is the remaining Phase 1 work.

## Note on the 2026-09-06 audit

Testing the sign-up and registration paths turned up something separate and more urgent than
anything in this document: `/api/registrations`, `/api/followups` and `/api/grants` were reachable
**anonymously in production**, each returning caregiver names and email addresses across all
caregivers. Only seed data was exposed. Fixed by adding them to the Access guard, with route-coverage
tests in `tests/console-route-coverage.test.mjs`. The lesson worth keeping: every handler test passed
throughout, because the tests call handlers directly and never exercise the middleware.

Worth confirming with Shanelle only that the portal still matters to her at all, since it has not
come up in her recent notes and everything she has asked for lately has been public-site work.
