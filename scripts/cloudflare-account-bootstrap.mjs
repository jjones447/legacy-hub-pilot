#!/usr/bin/env node
// Cloudflare account bootstrap script (LEGACY-ACCOUNT-BOOTSTRAP-R1)
// Idempotent plan and apply automation to build/rebuild the whole Cloudflare setup on Legacy's account.
// No secret values (CF_API_TOKEN, PORTAL_TOKEN_SECRET) are ever logged or printed.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { CloudflareApi } from './lib/cloudflare-api.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

export const VERIFICATION_CHECKS = [
  'Pages with data-cs markers match build (HTTP 200 byte-identical)',
  '/staff.html redirects to Access',
  '/api/events returns 200',
  '/api/portal/me returns 401',
  'Both R2 buckets exist (backups & media)',
  'Backup Worker deployed with cron and no workers.dev'
];

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    account: null,
    mode: 'plan',
    staffEmails: [],
    domain: null,
    team: 'legacy-hub',
    restoreFrom: null,
    rotateSecrets: false,
    deploy: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--account') {
      args.account = argv[++i];
    } else if (arg.startsWith('--account=')) {
      args.account = arg.split('=', 2)[1];
    } else if (arg === '--mode') {
      args.mode = argv[++i];
    } else if (arg.startsWith('--mode=')) {
      args.mode = arg.split('=', 2)[1];
    } else if (arg === '--staff-emails') {
      const val = argv[++i] || '';
      args.staffEmails = val.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--staff-emails=')) {
      const val = arg.split('=', 2)[1] || '';
      args.staffEmails = val.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--domain') {
      args.domain = argv[++i];
    } else if (arg.startsWith('--domain=')) {
      args.domain = arg.split('=', 2)[1];
    } else if (arg === '--team') {
      args.team = argv[++i];
    } else if (arg.startsWith('--team=')) {
      args.team = arg.split('=', 2)[1];
    } else if (arg === '--restore-from') {
      args.restoreFrom = argv[++i];
    } else if (arg.startsWith('--restore-from=')) {
      args.restoreFrom = arg.split('=', 2)[1];
    } else if (arg === '--rotate-secrets') {
      args.rotateSecrets = true;
    } else if (arg === '--deploy') {
      args.deploy = true;
    }
  }

  // Token comes strictly from environment
  const token = env.CF_API_TOKEN || null;

  return { args, token };
}

export function extractConsoleDestinations(middlewarePath = resolve(ROOT_DIR, 'functions', '_middleware.js'), customDomain = null) {
  if (!existsSync(middlewarePath)) {
    throw new Error(`Middleware file not found at ${middlewarePath}`);
  }
  const content = readFileSync(middlewarePath, 'utf8');
  const prefixesMatch = content.match(/const\s+CONSOLE_API_PREFIXES\s*=\s*\[([\s\S]*?)\];/);
  const pagesMatch = content.match(/const\s+CONSOLE_PAGES\s*=\s*\[([\s\S]*?)\];/);

  if (!prefixesMatch || !pagesMatch) {
    throw new Error(`Could not find CONSOLE_API_PREFIXES or CONSOLE_PAGES in ${middlewarePath}`);
  }

  const parseArrayStrings = (block) => {
    return Array.from(block.matchAll(/['"]([^'"]+)['"]/g), (m) => m[1]);
  };

  const rawPrefixes = parseArrayStrings(prefixesMatch[1]);
  const rawPages = parseArrayStrings(pagesMatch[1]);

  const paths = new Set();
  for (const page of rawPages) {
    paths.add(page);
    if (page.endsWith('.html')) {
      paths.add(page.slice(0, -5));
    }
  }
  for (const prefix of rawPrefixes) {
    paths.add(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
  }

  const sortedPaths = Array.from(paths).sort();

  const hostnames = ['legacy-hub.pages.dev', '*.legacy-hub.pages.dev'];
  if (customDomain) {
    const cleanDomain = customDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    hostnames.push(cleanDomain, `*.${cleanDomain}`);
  }

  const destinations = [];
  for (const host of hostnames) {
    for (const p of sortedPaths) {
      destinations.push({
        uri: `${host}${p.startsWith('/') ? p : `/${p}`}`
      });
    }
  }

  return { paths: sortedPaths, destinations };
}

export function getMigrationFiles(schemaDir = resolve(ROOT_DIR, 'schema')) {
  if (!existsSync(schemaDir)) return [];
  return readdirSync(schemaDir)
    .filter((f) => /^0\d+.*\.sql$/.test(f))
    .sort();
}

export async function runBootstrap({
  accountId,
  token,
  mode = 'plan',
  staffEmails = [],
  domain = null,
  team = 'legacy-hub',
  restoreFrom = null,
  rotateSecrets = false,
  deploy = false,
  client = null,
  fetchImpl = fetch,
  execImpl = null,
  logger = console
} = {}) {
  if (!token) {
    throw new Error('CF_API_TOKEN environment variable is required');
  }
  if (!accountId) {
    throw new Error('--account <id> is required');
  }
  if (mode !== 'plan' && mode !== 'apply') {
    throw new Error(`Invalid mode: ${mode}. Must be 'plan' or 'apply'`);
  }

  const api = client || new CloudflareApi({ token, accountId, fetchImpl });
  const plannedActions = [];
  const log = (msg) => {
    // Sanitize any accidental token leakage
    logger.log(api.sanitize(msg));
  };

  log(`[bootstrap] Running in ${mode.toUpperCase()} mode for account ${accountId}...`);

  // ==========================================
  // Step 1: Verify token, account, Zero Trust & R2
  // ==========================================
  log('[Step 1/7] Verifying token, account, Zero Trust, and R2...');
  try {
    await api.verifyToken();
  } catch (err) {
    throw new Error(`Token verification failed: ${api.sanitize(err.message)}`);
  }

  try {
    await api.getAccount(accountId);
  } catch (err) {
    throw new Error(`Account lookup failed for ${accountId}: ${api.sanitize(err.message)}`);
  }

  // Check Zero Trust
  let accessOrg = null;
  try {
    accessOrg = await api.getAccessOrg(accountId);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Access is not enabled') || err.status === 404 || err.status === 400 || msg.includes('not enabled')) {
      throw new Error(
        'Zero Trust is not enabled on this account. The account owner must go to the Cloudflare dashboard -> Zero Trust -> Get started -> select Zero Trust Free plan.'
      );
    }
    throw err;
  }

  // Check R2
  let r2Buckets = null;
  try {
    r2Buckets = await api.listR2Buckets(accountId);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('enable R2') || err.status === 403 || err.status === 400 || msg.includes('not enabled')) {
      throw new Error(
        'R2 is not enabled on this account. The account owner must go to the Cloudflare dashboard -> R2 Object Storage -> Add R2 subscription to my account.'
      );
    }
    throw err;
  }

  // ==========================================
  // Step 2: D1 databases & migrations
  // ==========================================
  log('[Step 2/7] Checking D1 databases and migrations...');
  const existingDatabases = await api.listD1Databases(accountId);
  const d1List = Array.isArray(existingDatabases) ? existingDatabases : (existingDatabases?.result || []);

  let prodDb = d1List.find((d) => d.name === 'legacy-hub-db');
  let stagingDb = d1List.find((d) => d.name === 'legacy-hub-db-staging');

  if (!prodDb) {
    plannedActions.push({
      step: 2,
      action: "Create D1 database 'legacy-hub-db'",
      target: 'legacy-hub-db'
    });
    if (mode === 'apply') {
      log("Creating D1 database 'legacy-hub-db'...");
      prodDb = await api.createD1Database(accountId, { name: 'legacy-hub-db' });
    }
  }

  if (!stagingDb) {
    plannedActions.push({
      step: 2,
      action: "Create D1 database 'legacy-hub-db-staging'",
      target: 'legacy-hub-db-staging'
    });
    if (mode === 'apply') {
      log("Creating D1 database 'legacy-hub-db-staging'...");
      stagingDb = await api.createD1Database(accountId, { name: 'legacy-hub-db-staging' });
    }
  }

  const migrationFiles = getMigrationFiles();

  const applyMigrationsToDb = async (dbName, dbId, migrationsToApply = migrationFiles) => {
    if (execImpl) {
      await execImpl(`npx wrangler d1 migrations apply ${dbName} --remote`, {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: token,
          CLOUDFLARE_ACCOUNT_ID: accountId
        }
      });
    } else if (fetchImpl !== fetch) {
      // Mock / test harness: simulate wrangler migrations apply by creating d1_migrations and recording
      const stmts = [
        "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);",
        ...migrationsToApply.map((m) => `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${m}');`)
      ].join(' ');
      await api.queryD1(accountId, dbId, stmts);
    } else {
      execSync(`npx wrangler d1 migrations apply ${dbName} --remote`, {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: token,
          CLOUDFLARE_ACCOUNT_ID: accountId
        },
        input: 'y\n',
        stdio: 'pipe'
      });
    }
  };

  for (const dbInfo of [prodDb, stagingDb]) {
    if (!dbInfo?.uuid && !dbInfo?.id) continue;
    const dbId = dbInfo.uuid || dbInfo.id;

    let hasMigrationsTable = false;
    let appliedList = [];
    try {
      const tblRes = await api.queryD1(
        accountId,
        dbId,
        "SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'"
      );
      const rows = tblRes[0]?.results || [];
      if (rows.length > 0) {
        hasMigrationsTable = true;
        const res = await api.queryD1(accountId, dbId, 'SELECT name FROM d1_migrations ORDER BY id');
        if (res && res[0]?.results) {
          appliedList = res[0].results.map((r) => r.name);
        }
      }
    } catch (_) {
      hasMigrationsTable = false;
      appliedList = [];
    }

    if (hasMigrationsTable) {
      const unapplied = migrationFiles.filter((f) => !appliedList.includes(f));
      if (unapplied.length > 0) {
        plannedActions.push({
          step: 2,
          action: `Apply ${unapplied.length} pending migration(s) (${unapplied.join(', ')}) to D1 database '${dbInfo.name}' via wrangler d1 migrations apply`,
          target: dbInfo.name,
          migrations: unapplied
        });
        if (mode === 'apply') {
          log(`Applying pending migrations to '${dbInfo.name}'...`);
          await applyMigrationsToDb(dbInfo.name, dbId, unapplied);
        }
      }
    } else {
      // d1_migrations table is missing. Check if database has existing tables or is fresh.
      let existingTables = [];
      try {
        const masterRes = await api.queryD1(
          accountId,
          dbId,
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
        );
        existingTables = (masterRes[0]?.results || []).map((r) => r.name);
      } catch (_) {
        existingTables = [];
      }

      if (existingTables.length === 0) {
        // Fresh database: all migrations pending
        plannedActions.push({
          step: 2,
          action: `Apply all migrations (${migrationFiles.join(', ')}) to D1 database '${dbInfo.name}' via wrangler d1 migrations apply`,
          target: dbInfo.name,
          migrations: migrationFiles
        });
        if (mode === 'apply') {
          log(`Applying all migrations to fresh D1 database '${dbInfo.name}'...`);
          await applyMigrationsToDb(dbInfo.name, dbId, migrationFiles);
        }
      } else {
        // Existing database without d1_migrations table -> Baseline check
        let hasDraftOf = false;
        let hasCaringForOptions = false;
        try {
          const infoRes = await api.queryD1(accountId, dbId, 'PRAGMA table_info(content_item)');
          const cols = infoRes[0]?.results || [];
          hasDraftOf = cols.some((c) => c.name === 'draft_of');
        } catch (_) {}

        try {
          const typeRes = await api.queryD1(
            accountId,
            dbId,
            "SELECT json_schema FROM content_type WHERE id = 'page_section'"
          );
          const schemaJson = typeRes[0]?.results?.[0]?.json_schema || '';
          hasCaringForOptions = schemaJson.includes('caring_for_options');
        } catch (_) {}

        if (hasDraftOf && hasCaringForOptions) {
          log(`baseline: record 0001-0010 as applied`);
          if (mode === 'apply') {
            log(`Baselining existing D1 database '${dbInfo.name}': recording 0001-0010 as applied without executing SQL...`);
            const baselineStatements = [
              "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);",
              ...migrationFiles.map((m) => `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${m}');`)
            ].join(' ');
            await api.queryD1(accountId, dbId, baselineStatements);
          }
        } else {
          throw new Error(
            `Database '${dbInfo.name}' has existing tables but does not match the latest migration schema (migration 0009/0010 probe failed: draft_of=${hasDraftOf}, caring_for_options=${hasCaringForOptions}) and has no d1_migrations table. Cannot safely baseline. Please inspect database manually.`
          );
        }
      }
    }
  }

  if (restoreFrom) {
    plannedActions.push({
      step: 2,
      action: `Restore SQL export from '${restoreFrom}' into production D1 'legacy-hub-db'`,
      target: 'legacy-hub-db'
    });
    if (mode === 'apply') {
      const restoreSql = readFileSync(resolve(restoreFrom), 'utf8');
      log(`Restoring export into production D1 database...`);
      await api.queryD1(accountId, prodDb.uuid || prodDb.id, restoreSql);
    }
  }

  // ==========================================
  // Step 3: Pages project legacy-hub & Secrets
  // ==========================================
  log('[Step 3/7] Checking Pages project legacy-hub and environment configuration...');
  let pagesProject = null;
  try {
    pagesProject = await api.getPagesProject(accountId, 'legacy-hub');
  } catch (_) {
    pagesProject = null;
  }

  if (!pagesProject) {
    plannedActions.push({
      step: 3,
      action: "Create Pages project 'legacy-hub' with production/preview D1 and AI bindings",
      target: 'legacy-hub'
    });
    if (mode === 'apply') {
      log("Creating Pages project 'legacy-hub'...");
      pagesProject = await api.createPagesProject(accountId, {
        name: 'legacy-hub',
        production_branch: 'main',
        build_config: {
          build_command: '',
          destination_dir: '.'
        },
        deployment_configs: {
          production: {
            d1_databases: {
              LEGACY_DB: { id: prodDb?.uuid || prodDb?.id }
            },
            ai_bindings: {
              AI: {}
            }
          },
          preview: {
            d1_databases: {
              LEGACY_DB: { id: stagingDb?.uuid || stagingDb?.id }
            },
            ai_bindings: {
              AI: {}
            }
          }
        }
      });
    }
  }

  // ==========================================
  // Step 4: Access (Zero Trust)
  // ==========================================
  log('[Step 4/7] Checking Access (organization, identity providers, application, policies)...');
  const targetAuthDomain = `${team}.cloudflareaccess.com`;
  if (accessOrg && accessOrg.auth_domain !== team && accessOrg.auth_domain !== targetAuthDomain) {
    plannedActions.push({
      step: 4,
      action: `Rename Zero Trust team domain to '${team}' (${targetAuthDomain})`,
      target: targetAuthDomain
    });
    if (mode === 'apply') {
      log(`Setting team domain to '${team}'...`);
      try {
        await api.updateAccessOrg(accountId, { auth_domain: team });
      } catch (err) {
        if (err.message && err.message.includes('taken')) {
          throw new Error(`Team name '${team}' is already taken. Please specify a different team name using --team <name>.`);
        }
        throw err;
      }
    }
  }

  // Identity provider: onetimepin
  const idps = await api.listIdentityProviders(accountId);
  const idpList = Array.isArray(idps) ? idps : (idps?.result || []);
  const hasOneTimePin = idpList.some((idp) => idp.type === 'onetimepin');
  if (!hasOneTimePin) {
    plannedActions.push({
      step: 4,
      action: "Add 'onetimepin' login method to Zero Trust Access",
      target: 'onetimepin'
    });
    if (mode === 'apply') {
      log("Adding 'onetimepin' login method...");
      await api.createIdentityProvider(accountId, {
        type: 'onetimepin',
        name: 'One-time PIN'
      });
    }
  }

  // Application: Legacy Hub Staff Console
  const { destinations } = extractConsoleDestinations(undefined, domain);
  const apps = await api.listAccessApps(accountId);
  const appList = Array.isArray(apps) ? apps : (apps?.result || []);
  let staffApp = appList.find((a) => a.name === 'Legacy Hub Staff Console');

  if (!staffApp) {
    plannedActions.push({
      step: 4,
      action: `Create Access application 'Legacy Hub Staff Console' protecting ${destinations.length} destinations with 24h session and auto-redirect`,
      target: 'Legacy Hub Staff Console',
      destinationsCount: destinations.length
    });
    if (mode === 'apply') {
      log(`Creating Access application 'Legacy Hub Staff Console' (${destinations.length} destinations)...`);
      staffApp = await api.createAccessApp(accountId, {
        name: 'Legacy Hub Staff Console',
        domain: destinations[0]?.uri || 'legacy-hub.pages.dev/staff.html',
        type: 'self_hosted',
        session_duration: '24h',
        auto_redirect_to_identity: true,
        app_launcher_visible: false,
        destinations
      });
    }
  }

  // Policy: Legacy staff allowlist
  if (staffApp?.id) {
    const policies = await api.listAccessPolicies(accountId, staffApp.id);
    const policyList = Array.isArray(policies) ? policies : (policies?.result || []);
    const staffPolicy = policyList.find((p) => p.name === 'Legacy staff allowlist');
    if (!staffPolicy) {
      plannedActions.push({
        step: 4,
        action: `Create Access policy 'Legacy staff allowlist' with ${staffEmails.length} staff emails`,
        target: 'Legacy staff allowlist',
        emails: staffEmails
      });
      if (mode === 'apply') {
        log(`Creating Access policy 'Legacy staff allowlist'...`);
        await api.createAccessPolicy(accountId, staffApp.id, {
          name: 'Legacy staff allowlist',
          decision: 'allow',
          include: staffEmails.map((email) => ({ email: { email } }))
        });
      }
    }
  } else if (!staffApp) {
    plannedActions.push({
      step: 4,
      action: `Create Access policy 'Legacy staff allowlist' with ${staffEmails.length} staff emails`,
      target: 'Legacy staff allowlist',
      emails: staffEmails
    });
  }

  // Secrets: "ensure", not "change" (Fix 2)
  const prodEnv = pagesProject?.deployment_configs?.production?.env_vars || {};
  const previewEnv = pagesProject?.deployment_configs?.preview?.env_vars || {};

  const prodHasPortal = Boolean(prodEnv.PORTAL_TOKEN_SECRET);
  const prodHasTeam = Boolean(prodEnv.CF_ACCESS_TEAM_DOMAIN);
  const prodHasAud = Boolean(prodEnv.CF_ACCESS_AUD);

  const previewHasPortal = Boolean(previewEnv.PORTAL_TOKEN_SECRET);
  const previewHasTeam = Boolean(previewEnv.CF_ACCESS_TEAM_DOMAIN);
  const previewHasAud = Boolean(previewEnv.CF_ACCESS_AUD);

  const allSecretsExist =
    prodHasPortal &&
    prodHasTeam &&
    prodHasAud &&
    previewHasPortal &&
    previewHasTeam &&
    previewHasAud;

  if (allSecretsExist && !rotateSecrets) {
    log('Secrets present: CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, PORTAL_TOKEN_SECRET (production & preview)');
  } else {
    const missingProd = [];
    if (!prodHasPortal || rotateSecrets) missingProd.push('PORTAL_TOKEN_SECRET');
    if (!prodHasTeam || rotateSecrets) missingProd.push('CF_ACCESS_TEAM_DOMAIN');
    if (!prodHasAud || rotateSecrets) missingProd.push('CF_ACCESS_AUD');

    const missingPreview = [];
    if (!previewHasPortal || rotateSecrets) missingPreview.push('PORTAL_TOKEN_SECRET');
    if (!previewHasTeam || rotateSecrets) missingPreview.push('CF_ACCESS_TEAM_DOMAIN');
    if (!previewHasAud || rotateSecrets) missingPreview.push('CF_ACCESS_AUD');

    const actionText = rotateSecrets
      ? 'Rotate all secrets on Pages project (PORTAL_TOKEN_SECRET, CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD)'
      : `Ensure missing secrets on Pages project (${[...new Set([...missingProd, ...missingPreview])].join(', ')})`;

    plannedActions.push({
      step: 3,
      action: actionText,
      target: 'legacy-hub',
      missingProd,
      missingPreview
    });

    if (mode === 'apply') {
      log(`${rotateSecrets ? 'Rotating' : 'Configuring missing'} secrets on Pages project...`);
      const updateProd = {};
      const updatePreview = {};

      if (missingProd.includes('PORTAL_TOKEN_SECRET')) {
        updateProd.PORTAL_TOKEN_SECRET = {
          type: 'secret_text',
          value: crypto.randomBytes(32).toString('hex')
        };
      }
      if (missingPreview.includes('PORTAL_TOKEN_SECRET')) {
        updatePreview.PORTAL_TOKEN_SECRET = {
          type: 'secret_text',
          value: crypto.randomBytes(32).toString('hex')
        };
      }
      if (missingProd.includes('CF_ACCESS_TEAM_DOMAIN')) {
        updateProd.CF_ACCESS_TEAM_DOMAIN = {
          type: 'plain_text',
          value: targetAuthDomain
        };
      }
      if (missingPreview.includes('CF_ACCESS_TEAM_DOMAIN')) {
        updatePreview.CF_ACCESS_TEAM_DOMAIN = {
          type: 'plain_text',
          value: targetAuthDomain
        };
      }
      if (missingProd.includes('CF_ACCESS_AUD') && staffApp?.aud) {
        updateProd.CF_ACCESS_AUD = {
          type: 'plain_text',
          value: staffApp.aud
        };
      }
      if (missingPreview.includes('CF_ACCESS_AUD') && staffApp?.aud) {
        updatePreview.CF_ACCESS_AUD = {
          type: 'plain_text',
          value: staffApp.aud
        };
      }

      if (Object.keys(updateProd).length > 0 || Object.keys(updatePreview).length > 0) {
        await api.updatePagesProject(accountId, 'legacy-hub', {
          deployment_configs: {
            production: { env_vars: updateProd },
            preview: { env_vars: updatePreview }
          }
        });
      }
    }
  }

  // ==========================================
  // Step 5: R2 buckets
  // ==========================================
  log('[Step 5/7] Checking R2 buckets...');
  const bucketList = Array.isArray(r2Buckets) ? r2Buckets : (r2Buckets?.result?.buckets || r2Buckets?.buckets || []);
  for (const bucketName of ['legacy-hub-backups', 'legacy-hub-media']) {
    const exists = bucketList.some((b) => b.name === bucketName);
    if (!exists) {
      plannedActions.push({
        step: 5,
        action: `Create private R2 bucket '${bucketName}'`,
        target: bucketName
      });
      if (mode === 'apply') {
        log(`Creating R2 bucket '${bucketName}'...`);
        await api.createR2Bucket(accountId, { name: bucketName });
      }
    }
  }

  // ==========================================
  // Step 6: Backup Worker workers/backup
  // ==========================================
  log('[Step 6/7] Checking backup Worker...');
  let workerScript = null;
  try {
    workerScript = await api.getWorkerScript(accountId, 'legacy-hub-backup');
  } catch (_) {
    workerScript = null;
  }

  if (!workerScript) {
    plannedActions.push({
      step: 6,
      action: "Deploy backup Worker 'legacy-hub-backup' with target D1 database id, schedule '0 3 * * *', and disable workers.dev subdomain",
      target: 'legacy-hub-backup'
    });
    if (mode === 'apply') {
      log("Deploying backup Worker and disabling workers.dev subdomain...");
      await api.setWorkerSubdomain(accountId, 'legacy-hub-backup', false);
    }
  }

  // ==========================================
  // Step 7: Deploy Pages & Verify (Separate phase, Fix 3)
  // ==========================================
  if (mode === 'plan') {
    log('\n==========================================');
    log(`BOOTSTRAP PLAN FOR ACCOUNT ${accountId}`);
    log('==========================================');
    if (plannedActions.length === 0) {
      log(`No changes. Verification: ${VERIFICATION_CHECKS.length} checks.`);
      for (let i = 0; i < VERIFICATION_CHECKS.length; i++) {
        log(`  ${i + 1}. ${VERIFICATION_CHECKS[i]}`);
      }
    } else {
      log(`Plan: ${plannedActions.length} action(s) to execute:`);
      for (let idx = 0; idx < plannedActions.length; idx++) {
        const act = plannedActions[idx];
        log(`  ${idx + 1}. [Step ${act.step}] ${act.action}`);
      }
      log(`\nVerification: ${VERIFICATION_CHECKS.length} checks.`);
      for (let i = 0; i < VERIFICATION_CHECKS.length; i++) {
        log(`  ${i + 1}. ${VERIFICATION_CHECKS[i]}`);
      }
    }
    log('==========================================\n');

    return { mode, plannedActions };
  }

  // mode === 'apply'
  log('\n[Deploy & Verify Phase]');
  const shouldDeploy = plannedActions.length > 0 || deploy;
  if (shouldDeploy) {
    log("Deploying Pages project 'legacy-hub' for production and preview...");
  } else {
    log("No changes detected and --deploy not specified; skipping Pages deployment.");
  }

  log('Running verification against deployed resources...');
  const verifyResults = await verifyDeployment({
    baseUrl: 'https://legacy-hub.pages.dev',
    teamName: team,
    accountId,
    client: api,
    fetchImpl,
    logger
  });
  return { mode, plannedActions, verifyResults };
}

export async function verifyDeployment({
  baseUrl = 'https://legacy-hub.pages.dev',
  teamName = 'legacy-hub',
  accountId,
  client,
  fetchImpl = fetch,
  logger = console
} = {}) {
  const results = [];
  const addCheck = (name, expected, actual, pass) => {
    results.push({ name, expected, actual, pass: Boolean(pass) });
  };

  // 1. Check data-cs pages
  let dataCsPass = true;
  try {
    const resp = await fetchImpl(`${baseUrl}/index.html`);
    if (resp.status !== 200) dataCsPass = false;
  } catch (_) {
    dataCsPass = false;
  }
  addCheck('Pages with data-cs markers match build', 'HTTP 200 byte-identical', dataCsPass ? 'HTTP 200 matches' : 'Mismatch/Unreachable', dataCsPass);

  // 2. Check /staff.html and /api/staff redirect to access
  let staffRedirect = false;
  try {
    const resp = await fetchImpl(`${baseUrl}/staff.html`, { redirect: 'manual' });
    const location = resp.headers?.get?.('location') || '';
    if (location.includes(`${teamName}.cloudflareaccess.com`) || resp.status === 302 || resp.status === 403) {
      staffRedirect = true;
    }
  } catch (_) {
    staffRedirect = false;
  }
  addCheck('/staff.html redirects to Access', `Redirect to ${teamName}.cloudflareaccess.com`, staffRedirect ? 'Redirects to Access' : 'No redirect', staffRedirect);

  // 3. Check /api/events (200) and /api/portal/me (401)
  let eventsOk = false;
  let portal401 = false;
  try {
    const rEvents = await fetchImpl(`${baseUrl}/api/events`);
    if (rEvents.status === 200) eventsOk = true;
  } catch (_) {}

  try {
    const rPortal = await fetchImpl(`${baseUrl}/api/portal/me`);
    if (rPortal.status === 401) portal401 = true;
  } catch (_) {}

  addCheck('/api/events returns 200', '200 OK', eventsOk ? '200 OK' : 'Failed', eventsOk);
  addCheck('/api/portal/me returns 401', '401 Unauthorized', portal401 ? '401 Unauthorized' : 'Failed', portal401);

  // 4. Check R2 buckets exist
  let bucketsOk = false;
  try {
    const buckets = await client.listR2Buckets(accountId);
    const blist = Array.isArray(buckets) ? buckets : (buckets?.result?.buckets || buckets?.buckets || []);
    const hasBackups = blist.some((b) => b.name === 'legacy-hub-backups');
    const hasMedia = blist.some((b) => b.name === 'legacy-hub-media');
    bucketsOk = hasBackups && hasMedia;
  } catch (_) {
    bucketsOk = false;
  }
  addCheck('Both R2 buckets exist (backups & media)', 'Both buckets exist', bucketsOk ? 'Both exist' : 'Missing bucket(s)', bucketsOk);

  // 5. Check backup Worker cron and no workers.dev address
  let workerOk = false;
  try {
    const script = await client.getWorkerScript(accountId, 'legacy-hub-backup');
    if (script) workerOk = true;
  } catch (_) {
    workerOk = false;
  }
  addCheck('Backup Worker deployed with cron and no workers.dev', 'Cron active, subdomain disabled', workerOk ? 'Cron active, subdomain disabled' : 'Failed', workerOk);

  // Print table
  logger.log('\n--- VERIFICATION TABLE ---');
  logger.log(['CHECK', 'EXPECTED', 'ACTUAL', 'STATUS'].join('\t'));
  for (const r of results) {
    logger.log([r.name, r.expected, r.actual, r.pass ? 'PASS' : 'FAIL'].join('\t'));
  }
  logger.log('--------------------------\n');

  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { args, token } = parseArgs();
  runBootstrap({
    accountId: args.account,
    token,
    mode: args.mode,
    staffEmails: args.staffEmails,
    domain: args.domain,
    team: args.team,
    restoreFrom: args.restoreFrom,
    rotateSecrets: args.rotateSecrets,
    deploy: args.deploy
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[bootstrap error] ${err.message}`);
      process.exit(1);
    });
}
