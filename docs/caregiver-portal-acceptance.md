# Caregiver Portal — what "done" means

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
