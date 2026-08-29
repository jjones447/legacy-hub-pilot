# Staging surface — how to preview before publishing

**Staging:** https://staging.legacy-hub.pages.dev
**Production:** https://legacy-hub.pages.dev

Jacob promised Legacy a non-production site at the 2026-08-21 walkthrough — somewhere Shanelle
can try a change (a seasonal logo, new copy) and see it before anything reaches the live site.
This is that surface. Approach chosen by Jacob 2026-08-27: a named preview branch on the existing
Cloudflare Pages project.

## Deploy to staging

```
python build.py --verify
npx wrangler pages deploy . --project-name=legacy-hub --branch=staging
```

## Promote the same build to production

```
npx wrangler pages deploy . --project-name=legacy-hub --branch=main
```

Deploy the **same working tree** to both. Do not rebuild between the two commands — that is how
staging and production drift apart while appearing to match.

## Verify, both times

A 200 proves nothing here: unknown paths catch-all to the homepage, and an unfollowed 308 looks
like an empty page. Always cache-bust and follow redirects, then check content-type and size:

```
curl -sL -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' \
  "https://staging.legacy-hub.pages.dev/?cb=$(date +%s%N)"
```

## Rules that are not negotiable

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

## When the site moves to Legacy's Cloudflare account

Recreate this branch alias in the new account and re-point anything referencing it. The staging
URL will change with the account; tell Shanelle before it does, not after.
