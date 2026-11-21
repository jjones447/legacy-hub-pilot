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

Playwright1.65.1 and Chromium159 downloads completed. The first isolated browser launch
failed because the container lacks OS shared libraries (including glib/NSS/X11).
User-space Debian libraries are being acquired into a separate tools directory; no
system package installation, host change or new agent is requested. Browser execution
is not yet qualified. Wrangler4.139.0 is already pinned in the repository.

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
