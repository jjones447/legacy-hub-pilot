# QA-only preview sign-in — source candidate

Author: pc1-codex-5. This document describes source behavior, not activation authority.
No settings, identities, databases, credentials, live mail or deployments are changed by this increment.

## Closed by default

Preview caregiver APIs require all three settings together, selected by the release owner through
an approved private configuration path. Do not put a personal address or real caregiver ID in
source, public issues, logs, screenshots or `wrangler.toml`.

| Setting | Required value |
| --- | --- |
| `ENVIRONMENT` | Keep the deployment's existing `preview` value. |
| `PORTAL_PREVIEW_MAIL_ENABLED` | Explicit `1` or `true` (case-insensitive; surrounding whitespace ignored). |
| `PORTAL_PREVIEW_QA_CAREGIVER_ID` | One exact approved caregiver ID: 1–128 ASCII letters, digits, `_` or `-`. |
| `PORTAL_PREVIEW_QA_EMAIL` | One exact approved address, matched after trim/lowercase; no recipient list. |

Missing, malformed or disabled configuration returns `503 preview_portal_disabled` before reading
the secret, body or database. Development stays disabled. Logout can still clear a local cookie.
The page explains the disabled state without exposing the selected identity.
Existing `PORTAL_TOKEN_SECRET` and `EMAIL_API_KEY` remain prerequisites; this source does not provision them.
`PREVIEW_MAIL_ENABLED`, the retired dev-link flag, and confirmation flags cannot enable portal auth.

Login checks the configured ID **and** current nonarchived row email. Other submitted addresses
receive the same generic `200 {ok:true}` without profile lookup, token mint or send; the IP limiter
still applies. The sender separately requires the server-selected `portal-signin` purpose, exact ID
and exact recipient. General-purpose preview mail stays off. The independent confirmation-mail
policy is unchanged; the QA flag alone cannot enable event, support-group or other mail.

Preview tokens, confirmation proofs and sessions are domain-separated from the old broad-preview /
production format and bound to the configured ID/email tuple. Retained credentials do not unlock
preview after opting in. Sessions also recheck the selected current row before profile/wellness access.
Token claims atomically recheck nonarchived status and configured email, retaining the one-winner rule.
Production/default-environment token hashes and session signatures retain their original format and policy.

Turning the flag off blocks existing credentials but does not delete them or revoke production
sessions. Re-enabling the same tuple can restore still-unexpired QA credentials (15-minute links,
2-hour sessions). This is not a new revocation service. Current-row checks and later data operations
are not a transaction against concurrent lifecycle changes.

## Source verification (inert only)

Use existing Node with `node:sqlite` and the existing Python/Jinja build environment; install nothing.
From this worktree:

```text
node --import ./tests/helpers/no-network.mjs --test tests/portal-preview-qa-only.test.mjs tests/portal-preview-containment.test.mjs tests/portal-signin-email.test.mjs tests/portal-caregiver-status.test.mjs tests/portal-login-v0.test.mjs tests/portal-origin-guard.test.mjs tests/portal-no-store.test.mjs tests/portal-logout-ui.test.mjs tests/registration-email.test.mjs tests/forms-live.test.mjs tests/intake.test.mjs
python build.py --verify
git diff --check
```

Fixtures are fictional `.invalid` recipients and in-memory SQLite. Fetch is a recording fake;
the preload refuses real HTTP/TLS/socket connections. No local server, workerd, mailbox, provider,
remote D1, browser acceptance, migrations or customer data is exercised.

Observed on PC1, 2026-11-03, Node 24.15.0:

- Focused command above: **249 passed, zero failed/skipped**, including 18 new QA-only tests.
- Full allowlisted unit inventory, with this preload inherited through process-local `NODE_OPTIONS`:
  **2,100 passed, three failed, zero skipped**. The untouched LF Staff306 base reproduces the same
  three failures (2,082 passed / three failed): NUL-text preservation in restore SQL,
  caregiver-contact creation and staff-note creation. No claim of an all-green full suite is made.
- Syntax checks, build verification and whitespace check pass. All 24 generated-page differences
  are the `app.js` cache key only. Deployment configuration, schema, Staff JavaScript,
  intake and registration-mail implementation are unchanged.

The first comparison used a CRLF checkout and produced additional line-ending failures; the
baseline numbers above come from a fresh LF checkout at the exact source base. No unrelated
fixture, restore or staff implementation was changed to suppress those failures.

## Independent integration / preflight — STOP before effects

1. Review the exact source delta from Staff306 `ca69b6926791cfb52ecb990129c22cee1620c308`.
   Other in-flight staging work and support-only mail qualification are separate increments;
   do not replace their files with this older-base branch or merge it wholesale into production.
2. Reconcile against the actual selected integration head. In particular, My Support adds portal
   routes: **every** call to `parseSessionCookie` and `hasNonarchivedCaregiver` must pass `env`.
   Missing context deliberately fails closed. Apply the same QA identity fence to all new reads,
   writes and request/audit identities. Review route guards, sender purposes, database scope,
   generated asset hashes and tests on the integrated head, not only this branch.
3. Rebuild generated HTML with `python build.py`, then verify. This branch changes only the shared
   app cache key in generated pages; preserve other workers' UI and headings during integration.
4. Independent reviewer checks positive QA login, non-consuming GET/HEAD, explicit POST confirmation,
   own-profile/wellness/logout, alternate/mismatched/archived identities, retained tokens/sessions,
   changed configuration, strict origin/CSRF, unknown-claim fail-closed behavior and unrelated-mail denial.
   Run the normal source checks. Source/unit evidence is not runtime/deployed/client acceptance.
5. Before any installation or later QA activation, the responsible owner must freshly verify exact
   account/project/source/deployment/environment, isolated staging D1/media bindings, no concurrent
   publisher and rollback custody. Obtain the approved identity from the Lead privately; never infer
   it from a shared staging row or use a personal address from public source. Stop on any drift.
6. Installation, configuration changes, sending a real link and signed-in acceptance need their own
   exact authorization and named operator. Keep preview auth/mail disabled until that authorization;
   this source PR is **not** a GO and does not permit production, credentials, data edits or replay.

Cloudflare guidance used: [Pages Functions context](https://developers.cloudflare.com/pages/functions/api-reference/),
[D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/),
and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
Bindings/configuration remain request-local; existing deployment settings are untouched.
