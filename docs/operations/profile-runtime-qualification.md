# Profile runtime qualification plan

[pc2-codex-ct-13], Nov21 08:49 UTC. Product source/schema/privacy at aa05e5f
has retained functional and Security source approval. This test adapter is a separate
review delta; source approval is not permission to claim native TEST completion.

## Chosen first mechanism

`tests/runtime/profile-qualification.mjs` starts only local workerd, bound to127.0.0.1,
with a newly created private scratch directory and a fake D1 identifier. Its fixed
Wrangler commands contain `--local`. It imports the unchanged Profile handlers through
`profile-worker.mjs`, serves the actual caregiver form controller and CSS, and permits
only Profile GET/POST and three static asset paths. There is no mint, login, verify,
staff or provider-control route. The adapter refuses nonloopback requests, wrong fixture
markers and any email key or preview-mail opt-in. Shared-preview configuration is untouched.

The runner creates two fictional caregivers and one archived fixture in new local D1.
It generates a random fixture-only signing secret, writes it only into a0600 config
inside0700 scratch, and signs short-lived owner cookies offline in memory using the
existing session format. Neither cookies nor secret are logged. Provider credentials
and inherited environment-file loading are excluded. No production secret/session,
existing caregiver record, live email or Cloudflare account operation is used.

Local browser execution uses separately installed, locked Playwright1.65.1/Chromium;
the browser routes only to the owned loopback origin. The planned assertions cover
partial save/reload, owner isolation, invalid/expired/archived cookies, forbidden owner
selectors/cross-origin writes, revision conflict, readback reconciliation, contact
transition, second-owner resume, storage absence and mobile width. Known-success GET
reconciliation is explicitly not an injected transport-loss result. Existing SQLite/DOM
rollback and staff-projection evidence remains separate until tested through an appropriate
runtime composition.

This is **local persistence and browser qualification**, not hosted Pages/D1, Access,
actual sign-in/mail, full portal navigation or screen-reader acceptance. The fixture's
separate environment marker is confined to the test adapter; it does not modify the
shared-preview portal guard or introduce a product authentication exception. Fixture
files are outside both site allowlist and Pages functions; no deploy command is provided.

## Current capability and next checkpoint

Playwright1.65.1/Chromium159.0.8154.6 and user-space shared libraries are installed.
The reviewed b2ce83ad fixture passed authentication/route refusals, then its browser
stopped before the first save: first missing libraries, then font initialization.
The successor supplies a fixed tools-only fontconfig file to the browser environment;
fonts and configuration remain under `/workspace/profile-browser-tools`, with no system
installation. SAME ct12 reviews that environment delta before execution. No completed
Profile browser/persistence result is claimed. Wrangler4.139.0 is pinned.

Next checkpoint: **Nov21 09:30 UTC**, exact reviewed adapter source plus actual browser
capability/local persistence outcome, or precise remaining error. SAME ct12 reviews
this delta before the fixture is executed. The already closed Profile product source
review is not being redispatched.

## Hosted TEST remains a separate gate

Hosted TEST must pin exact deployment/origin, isolated D142be536c, pre-migration bookmark
and inventory, apply reviewed0022 once (never reapply0021), preserve existing rows and
qualify owner sessions plus staff role restrictions through the deployed composition.
No installed no-mail owner-session route has yet been qualified. Local fixture cookies
must never be copied into the hosted portal. A supported hosted fixture mechanism needs
separate retained review and custody evidence; enabling the shared-preview mail opt-in
alone is not authorization or proof. Actual login/mail qualification remains explicitly
out of this persistence fixture. TESTNov22 23:59 remains conditional.

Synthetic scratch and results are retained after execution. Stop only the owned local
runtime/browser; do not delete shared state or perform automatic destructive rollback.

## Nov21 09:22 checkpoint: proposed hosted boundary (not installed)

The reviewed local fixture executed at59d8f686. Read-only inspection of its retained
workerd D1 storage confirms owner A revision4, no owner B profile row, exactly four
revision-only audit payloads (1 through4), and exactly one generic follow-up created
at revision3 and now dismissed. This supplies local database witnesses for the
contact transition; it is not hosted D1 or an injected rollback/transport-loss result.
All earlier browser assertions completed; a remaining owned esbuild handle required
explicit cleanup, so the process result was143 rather than a clean-zero exit.

Proposed next package uses the existing legacy-hub Pages project, a dedicated fixture
preview branch/alias, the already isolated TEST D142be536c and a separately bundled
advanced-mode test worker. It must not deploy the product's whole Pages functions
or change production, canonical staging, existing preview authentication or any
existing secret. No additional Access app, account, service token or agent is proposed.
This plan requires retained Security review before implementing/deploying the wrapper.

The fixture worker would expose only fixed form assets and Profile GET/POST. It must
check actual preview environment, exact deployment-specific allowed hostname/origin,
expiry of the fixture window, method/path and a compile-time set of two newly reserved
synthetic owner IDs plus one archived negative ID. A decoded cookie owner allowlist
is only an additional prefilter: the unchanged handler must still verify the HMAC,
expiry, current eligibility, same-origin write and revision checks. All other caregiver
IDs, login/me/verify/mail/staff/publisher/mint routes and arbitrary assets are refused.

Use a newly generated fixture-only secret retained in a private0600 executor file and
one new preview-only binding named PROFILE_FIXTURE_SECRET. It must never replace or
reuse PORTAL_TOKEN_SECRET. Before any binding update, preserve the existing preview
configuration and verify all existing values/bindings remain unchanged. Source must
refuse deployment to production; the deployed source, environment, TEST database and
origin are independently read back before any fixture write. The deployment-specific
origin is established from actual provider output, never guessed or carried from the
publisher's qualified preview. No secret/session values enter source, logs or GitHub.

The adapter passes an explicit, minimal environment to the existing Profile handlers:
TEST database, fixture-only signing secret, Profile enabled and a fixture-only marker.
It must not forward inherited email keys, preview mail flags, production portal secret,
Access credentials or other provider bindings. That marker is a deliberate isolated
fixture composition, not a change or qualification of the shared-preview guard. The
product portal remains disabled in shared preview. The final cookie is offline-signed,
short-lived and bound by browser custody to this actual fixture origin; no public
mint endpoint or actual login/mail claim. Browser GET/POST traffic stays on that origin.

Migration0022 is additive and already source-reviewed, but remains UNAPPLIED. Before
applying once: verify TEST identity, capture a supported D1 bookmark plus table/row
inventory, confirm0022 absent and0021 present, and stop on ambiguous schema state.
Create only collision-checked, explicitly fictional fixture caregivers; preserve all
existing rows. Keep a retained exact synthetic-ID manifest. Native witnesses must
cover save/load/resume, owner isolation, revisions, conflict, generic follow-up/audit,
eligibility changes and fresh readback. A scoped audit-failure injection needs its own
reviewed synthetic-only trigger and confirmed removal; do not infer rollback from the
local SQLite test. Do not repeat writes after unknown outcomes.

Staff qualification is still distinct: do not mint a fake human Access actor or grant
the publisher staff-edit authority. The existing staff-projection tests and local DOM
results do not close actual human-session/full-portal qualification. Preserve this gap
explicitly if the bounded owner persistence fixture is accepted first.

Concrete capability/custody gap: current executor can use the delivered ops credential
for the existing Pages/D1 account, but this advanced-mode bundle, per-preview fixture
secret/configuration preservation, actual origin and synthetic-owner prefilter have not
yet been implemented or qualified. No hosted fixture cookie has been created and no
binding/migration/deployment has been changed for Profile. Retained ct12 must accept
or correct this isolation design, then review the exact adapter before execution.
The Nov22 23:59 actual TEST commitment remains conditional. This packet delivers the
Nov21 10:00 mechanism/witness checkpoint early; it is not hosted TEST completion.
