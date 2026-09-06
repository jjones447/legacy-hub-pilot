# Caregiver Portal — what "done" means

Written 2026-09-06 by pc1-cc-gui-2. The portal task has carried the note *"scope and acceptance
criteria are not yet written down"* since 2026-08-21; this closes that gap so the next touch base
has something concrete instead of "still in progress".

**This is a proposal, not an agreed scope.** Jacob owns the portal build. Nothing here has been put
to Legacy, and the Phase 1 / Phase 2 split below is the part most worth arguing about before it is
promised to anyone.

## What exists today

| Piece | State |
|---|---|
| `portal.html` | Login screen only — one input, no form element |
| `functions/api/portal/[[path]].js` | Routes present for `login`, `logout`, `me` |
| `schema/0005_portal_login.sql` | `portal_token` table: token hash, caregiver id, expiry, single-use flag |
| Auth model | Magic link. No password is stored, which is the right call for this audience |

So the shape is chosen and the auth spine exists. What is missing is everything a caregiver would
actually log in *for*.

## The question that decides scope

**What does a caregiver get by logging in that they cannot get from the public site?**

Until that has a one-sentence answer, the portal is a login screen in front of nothing. Everything
the site does today — the Resource Hub, the directory, programme pages, the events calendar — is
public and should stay public. Putting caregiver help behind a login is a barrier to the people
least able to cope with one.

Three candidate answers, in order of how well they justify a login:

1. **My registrations.** What I have signed up for, what is coming, cancel or change it. Genuinely
   personal, genuinely useless without knowing who you are.
2. **My wellness grant.** Application status, what is outstanding, award history. Personal and
   sensitive — this is the strongest case for a login.
3. **Saved resources.** Bookmarks from the Resource Hub. Pleasant, but a browser bookmark does the
   same job; on its own it does not justify an account.

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

Put the scope question to Shanelle at a touch base before building further: *what should a caregiver
be able to do here that they cannot do on the open site?* Her answer decides whether Phase 1 is
registrations or grants, and that is a cheaper conversation than a rebuild.
