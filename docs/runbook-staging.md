# Staging surface — historical preview runbook

## Current-use guard — October 5, 2026

This document preserves the August preview design and examples; it is not the current
release runbook. The September 29 Legacy account move is already recorded in the SAME
private customer setup records. The old pilot URLs below and the future-account-move
section are historical; no recreation or repointing is authorized by this history.

The observed `staging.caregiversanctuary.org` is a production alias, not proof of an isolated preview.
Qualify the exact account, project, source revision, deployment, environment and D1 name plus UUID
through the SAME private customer `Legacy Internal/Management/Legacy_Delivery_Tracker.md`
and `docs/operations/legacy-account-setup-record.md` before any write, deployment or practice.
Source configuration that names different databases is not installed-binding or isolation evidence.
The canonical private runbook and queue govern current release work; this public history does
not replace them or reproduce private Intake.

Deployment is manual in the recorded setup. Branch pushes and merges are not deployment evidence.
Jacob authorizes this seat or its designees to push and deploy through configured authorized
accounts; no additional Lead publishing approval is required. Target qualification is a technical
safety check, not another publishing-permission hold.

All command samples below are historical, non-executable examples for this correction scope.
Do not run the historical seed, restore, installation, workerd-download or broad test commands
as current instructions. There are no customer, production or shared-staging writes and no production restore
authorized by this document. Existing rejected runtime preparation remains STOP: no bypass, alternate retry or installation.
Any later isolated synthetic work needs its own current target and fixture qualification;
an old seed shortcut, alias or scratch label does not grant it.

Missing or skipped real-workerd evidence is UNVERIFIED, not accepted. Record
source, review, CI, runtime, deployed and client-accepted states separately.
Coming Soon and reminders remain disabled until Shanelle's go through Jacob is recorded for the respective action;
source integration or a deploy authorization does not imply client-send or health-data permission.

## Historical August surface and URLs

**Staging:** https://staging.legacy-hub.pages.dev
**Production:** https://legacy-hub.pages.dev

Jacob promised Legacy a non-production site at the 2026-08-21 walkthrough — somewhere Shanelle
can try a change (a seasonal logo, new copy) and see it before anything reaches the live site.
The August design proposed that surface. Approach chosen by Jacob 2026-08-27: a named preview branch on the existing
Cloudflare Pages project.

## Historical example — deploy to staging

Non-executable history, not a current target selection or deployment instruction:

```
python build.py --verify
npm run build:site
npx wrangler pages deploy dist --project-name=legacy-hub --branch=staging
```
When the signed-in Wrangler session can see more than one Cloudflare account, export
`CLOUDFLARE_ACCOUNT_ID` matching the `account_id` in `wrangler.toml` before deploying, or Wrangler
may target the wrong account.
To seed or refresh page sections on staging: `node scripts/seed-page-sections.mjs --staging --remote`.
To restore a backup into a scratch drill database: `node scripts/restore-from-backup.mjs <dump-dir> <scratch-db-name> --remote`.


## Historical example — promote the same build to production

Non-executable history, not permission to deploy to production:

```
npx wrangler pages deploy dist --project-name=legacy-hub --branch=main
```

Deploy the **same `dist/`** to both. Do not rebuild between the two commands — that is how
staging and production drift apart while appearing to match.

## Historical verification example

The old alias and command below are historical, not current installed-release evidence:

A 200 proves nothing here: unknown paths catch-all to the homepage, and an unfollowed 308 looks
like an empty page. Always cache-bust and follow redirects, then check content-type and size:

```
curl -sL -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' \
  "https://staging.legacy-hub.pages.dev/?cb=$(date +%s%N)"
```

## Historical August rules

These rules describe the old pilot surface. Current URLs and client delivery must come
from the SAME private release records, not the two pilot URLs or branch names above.

1. **Never send the client a branch alias other than `staging`.** `v3-brown` and `v2-nav` are
   URLs of *retired mockups*. Both Jacob and Shanelle lost time to exactly that confusion during
   the 08-21 walkthrough. Only two URLs go to Legacy: production and staging.
2. **Deploying is manual.** Merging a PR ships nothing. There is no Git integration on this Pages
   project (`Git Provider: No`), so a merged change sits unpublished until someone runs the deploy
   command.
3. **Staging is public.** Cloudflare preview aliases are not password protected. Nothing
   confidential goes on it — this repo is public too.
4. **Every deployment keeps a permanent `<hash>.legacy-hub.pages.dev` URL** frozen at its content.
   They cannot be refreshed, only deleted. Unlinked and unguessable, but real.

## Historical broad-test and tooling examples

Do not execute these examples as this correction's test scope or as a runtime-preparation retry.

```
node --test "tests/*.test.mjs"
```
The old procedure for the workerd round-trip test (`tests/edge-rewrite-roundtrip-workerd.test.mjs`) said to ensure `wrangler` was available (`npm install` or global `wrangler`) and allowed a skip when the binary was absent. This is historical tooling guidance only, not installation authority or runtime acceptance; the current STOP and UNVERIFIED rules above govern.

## Historical future-account-move note — superseded by September 29 records

The move has already been recorded. The original note below is retained as history,
not a new account move, alias recreation, repointing or client-message instruction:

Recreate this branch alias in the new account and re-point anything referencing it. The staging
URL will change with the account; tell Shanelle before it does, not after.
