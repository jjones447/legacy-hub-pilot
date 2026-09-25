# Account Migration Runbook — Moving to Legacy's Cloudflare Account

How to bootstrap and rebuild the complete Legacy Hub infrastructure on Legacy's own Cloudflare account.

## 1. Prerequisites (Human Steps by Account Owner)
1. **Zero Trust Free**: Go to `dash.cloudflare.com` -> **Zero Trust** -> **Get started** -> choose **Zero Trust Free** ($0, up to 50 users).
2. **R2 Subscription**: Go to **R2 Object Storage** -> click **Add R2 subscription to my account** ($0, up to 10 GB/mo).
3. **Add Administrator**: Add X-Centric (`jjones@x-centric.com`) as an account Member under **Manage Account** -> **Members**.
4. **Ops API Token**: Create an account-scoped API token with permissions for Access, Zero Trust, Pages, Workers, D1, R2, and Account Read (stored in Vault).

## 2. Automated Account Bootstrap

```bash
# Set API token in environment (never passed as CLI argument, never logged)
export CF_API_TOKEN="<target-account-token>"

# Dry-run plan (makes zero writes, displays planned actions):
node scripts/cloudflare-account-bootstrap.mjs --account <ACCOUNT_ID> --mode plan --staff-emails "jjones@x-centric.com,jacob.jones447@gmail.com"

# Apply build (idempotent, configures D1, Pages, Access, R2, Backup Worker, and runs verification):
node scripts/cloudflare-account-bootstrap.mjs --account <ACCOUNT_ID> --mode apply --staff-emails "jjones@x-centric.com,jacob.jones447@gmail.com"
```
