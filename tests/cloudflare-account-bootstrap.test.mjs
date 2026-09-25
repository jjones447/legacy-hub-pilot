// Tests for LEGACY-ACCOUNT-BOOTSTRAP-R1: Cloudflare account bootstrap script
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractConsoleDestinations,
  runBootstrap,
  parseArgs,
  verifyDeployment,
  getMigrationFiles,
  VERIFICATION_CHECKS
} from '../scripts/cloudflare-account-bootstrap.mjs';

function createMockFetch(initialState = {}) {
  const state = {
    zeroTrustEnabled: true,
    r2Enabled: true,
    teamDomain: 'legacy-hub',
    databases: [],
    d1Tables: {}, // dbId -> array of table names
    migrations: {}, // dbId -> array of applied migration filenames
    hasD1MigrationsTable: {}, // dbId -> boolean
    contentItemCols: {}, // dbId -> array of col objects
    pageSectionSchema: {}, // dbId -> string
    pagesProject: null,
    identityProviders: [],
    apps: [],
    policies: {},
    buckets: [],
    workerScript: null,
    workerSubdomainEnabled: true,
    writeCalls: [],
    executedSql: [],
    ...initialState
  };

  const fetchImpl = async (url, init = {}) => {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const method = init.method || 'GET';
    const body = init.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : null;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const isSelectQuery = pathname.includes('/query') && body?.sql?.trim()?.toUpperCase()?.startsWith('SELECT');
      const isPragma = pathname.includes('/query') && body?.sql?.trim()?.toUpperCase()?.startsWith('PRAGMA');
      if (!isSelectQuery && !isPragma) {
        state.writeCalls.push({ method, pathname, body });
      }
    }

    // Live endpoint mocks for verification
    if (url === 'https://legacy-hub.pages.dev/index.html') {
      return new Response('<html><body data-cs="banner">Home</body></html>', { status: 200 });
    }
    if (url === 'https://legacy-hub.pages.dev/staff.html') {
      return new Response(null, {
        status: 302,
        headers: { location: `https://${state.teamDomain}.cloudflareaccess.com/login` }
      });
    }
    if (url === 'https://legacy-hub.pages.dev/api/events') {
      return new Response(JSON.stringify({ events: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://legacy-hub.pages.dev/api/portal/me') {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }

    // Cloudflare v4 REST API mocks
    if (pathname === '/client/v4/user/tokens/verify') {
      return new Response(JSON.stringify({ success: true, result: { id: 'token_1', status: 'active' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (pathname.match(/^\/client\/v4\/accounts\/[^/]+$/) && method === 'GET') {
      return new Response(JSON.stringify({ success: true, result: { id: 'acc_123', name: 'Legacy Account' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Access Organization (Zero Trust)
    if (pathname.includes('/access/organizations')) {
      if (!state.zeroTrustEnabled) {
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'Access is not enabled for this account' }] }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: { auth_domain: state.teamDomain } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'PUT') {
        state.teamDomain = body.auth_domain;
        return new Response(JSON.stringify({ success: true, result: { auth_domain: state.teamDomain } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // R2 Buckets
    if (pathname.includes('/r2/buckets')) {
      if (!state.r2Enabled) {
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'Please enable R2 through the Cloudflare Dashboard' }] }), {
          status: 403,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: { buckets: state.buckets.map((b) => ({ name: b })) } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'POST') {
        state.buckets.push(body.name);
        return new Response(JSON.stringify({ success: true, result: { name: body.name } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // D1 Databases
    if (pathname.match(/\/d1\/database$/)) {
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: state.databases }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'POST') {
        const newDb = { uuid: `uuid_${body.name}`, name: body.name };
        state.databases.push(newDb);
        return new Response(JSON.stringify({ success: true, result: newDb }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // D1 Query
    if (pathname.includes('/query')) {
      const match = pathname.match(/\/d1\/database\/([^/]+)\/query/);
      const dbId = match ? match[1] : 'unknown';
      const sql = body.sql || '';
      state.executedSql.push({ dbId, sql });

      // 1. Table existence check for d1_migrations
      if (sql.includes("name='d1_migrations'")) {
        const hasTbl = state.hasD1MigrationsTable[dbId] ?? Boolean(state.migrations[dbId]);
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ results: hasTbl ? [{ name: 'd1_migrations' }] : [] }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // 2. Query d1_migrations
      if (sql.includes('SELECT name FROM d1_migrations')) {
        const applied = state.migrations[dbId] || [];
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ results: applied.map((n) => ({ name: n })) }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // 3. Query existing tables (non-sqlite, non-_cf)
      if (sql.includes("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) {
        const tables = state.d1Tables[dbId] || [];
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ results: tables.map((t) => ({ name: t })) }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // 4. PRAGMA table_info(content_item)
      if (sql.includes('PRAGMA table_info(content_item)')) {
        const cols = state.contentItemCols[dbId] ?? [{ name: 'id' }, { name: 'draft_of' }];
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ results: cols }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // 5. Query content_type json_schema
      if (sql.includes("SELECT json_schema FROM content_type WHERE id = 'page_section'")) {
        const schema = state.pageSectionSchema[dbId] ?? '{"caring_for_options": []}';
        return new Response(
          JSON.stringify({
            success: true,
            result: [{ results: [{ json_schema: schema }] }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // 6. Baselining or inserting into d1_migrations
      if (sql.includes('INSERT OR IGNORE INTO d1_migrations')) {
        state.hasD1MigrationsTable[dbId] = true;
        if (!state.migrations[dbId]) state.migrations[dbId] = [];
        const matches = sql.matchAll(/VALUES\s*\('([^']+)'\)/g);
        for (const m of matches) {
          if (!state.migrations[dbId].includes(m[1])) {
            state.migrations[dbId].push(m[1]);
          }
        }
        return new Response(JSON.stringify({ success: true, result: [{ success: true }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true, result: [{ success: true }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Pages Projects
    if (pathname.match(/\/pages\/projects\/legacy-hub$/)) {
      if (method === 'GET') {
        if (!state.pagesProject) {
          return new Response(JSON.stringify({ success: false, errors: [{ message: 'Not found' }] }), { status: 404 });
        }
        return new Response(JSON.stringify({ success: true, result: state.pagesProject }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'PATCH') {
        const prevConfigs = state.pagesProject?.deployment_configs || {};
        const newConfigs = body.deployment_configs || {};
        state.pagesProject = {
          ...state.pagesProject,
          ...body,
          deployment_configs: {
            ...prevConfigs,
            ...newConfigs,
            production: {
              ...prevConfigs.production,
              ...newConfigs.production,
              env_vars: {
                ...prevConfigs.production?.env_vars,
                ...newConfigs.production?.env_vars
              }
            },
            preview: {
              ...prevConfigs.preview,
              ...newConfigs.preview,
              env_vars: {
                ...prevConfigs.preview?.env_vars,
                ...newConfigs.preview?.env_vars
              }
            }
          }
        };
        return new Response(JSON.stringify({ success: true, result: state.pagesProject }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }
    if (pathname.match(/\/pages\/projects$/)) {
      if (method === 'POST') {
        state.pagesProject = { name: body.name, ...body };
        return new Response(JSON.stringify({ success: true, result: state.pagesProject }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // Access Identity Providers
    if (pathname.includes('/access/identity_providers')) {
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: state.identityProviders }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'POST') {
        state.identityProviders.push(body);
        return new Response(JSON.stringify({ success: true, result: body }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // Access Apps
    if (pathname.match(/\/access\/apps$/)) {
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: state.apps }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'POST') {
        const app = { id: `app_${Date.now()}`, aud: 'mock_aud_tag_12345678', ...body };
        state.apps.push(app);
        return new Response(JSON.stringify({ success: true, result: app }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // Access Policies
    if (pathname.includes('/policies')) {
      const match = pathname.match(/\/access\/apps\/([^/]+)\/policies/);
      const appId = match ? match[1] : 'default';
      if (method === 'GET') {
        return new Response(JSON.stringify({ success: true, result: state.policies[appId] || [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (method === 'POST') {
        if (!state.policies[appId]) state.policies[appId] = [];
        state.policies[appId].push(body);
        return new Response(JSON.stringify({ success: true, result: body }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    // Worker Scripts
    if (pathname.match(/\/workers\/scripts\/legacy-hub-backup$/)) {
      if (method === 'GET') {
        if (!state.workerScript) {
          return new Response(JSON.stringify({ success: false, errors: [{ message: 'Worker not found' }] }), { status: 404 });
        }
        return new Response(JSON.stringify({ success: true, result: state.workerScript }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    if (pathname.match(/\/workers\/scripts\/legacy-hub-backup\/subdomain$/)) {
      if (method === 'POST') {
        state.workerSubdomainEnabled = body.enabled;
        state.workerScript = { id: 'legacy-hub-backup' };
        return new Response(JSON.stringify({ success: true, result: { enabled: body.enabled } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({ success: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  return { state, fetchImpl };
}

test('CLI argument parsing supports all options including --rotate-secrets and --deploy', () => {
  const { args, token } = parseArgs(
    [
      '--account',
      'acc_999',
      '--mode=apply',
      '--staff-emails',
      'a@test.com,b@test.com',
      '--domain',
      'caregiversanctuary.org',
      '--team',
      'my-team',
      '--restore-from',
      'backups/db.sql',
      '--rotate-secrets',
      '--deploy'
    ],
    { CF_API_TOKEN: 'token_env_123' }
  );

  assert.equal(args.account, 'acc_999');
  assert.equal(args.mode, 'apply');
  assert.deepEqual(args.staffEmails, ['a@test.com', 'b@test.com']);
  assert.equal(args.domain, 'caregiversanctuary.org');
  assert.equal(args.team, 'my-team');
  assert.equal(args.restoreFrom, 'backups/db.sql');
  assert.equal(args.rotateSecrets, true);
  assert.equal(args.deploy, true);
  assert.equal(token, 'token_env_123');
});

test('console destinations extracts all routes from _middleware.js', () => {
  const { paths, destinations } = extractConsoleDestinations();
  assert.ok(paths.includes('/staff'));
  assert.ok(paths.includes('/staff.html'));
  assert.ok(paths.includes('/api/staff'));
  assert.ok(paths.includes('/api/agent'));
  assert.ok(paths.includes('/api/registrations'));
  assert.ok(paths.includes('/api/followups'));
  assert.ok(paths.includes('/api/grants'));

  // 14 destinations: 7 on legacy-hub.pages.dev + 7 on *.legacy-hub.pages.dev
  assert.equal(destinations.length, 14);

  // Custom domain adds 14 more
  const withDomain = extractConsoleDestinations(undefined, 'caregiversanctuary.org');
  assert.equal(withDomain.destinations.length, 28);
});

test('plan against an empty account lists every step and makes zero writes', async () => {
  const { state, fetchImpl } = createMockFetch();
  const logs = [];
  const logger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  const result = await runBootstrap({
    accountId: 'test_account_1',
    token: 'test_token_123',
    mode: 'plan',
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger
  });

  assert.equal(result.mode, 'plan');
  assert.ok(result.plannedActions.length > 5, 'Must list all planned actions');
  assert.equal(state.writeCalls.length, 0, 'Plan mode MUST make zero write calls');

  // Verify steps included
  const steps = result.plannedActions.map((a) => a.step);
  assert.ok(steps.includes(2), 'Must include D1 step');
  assert.ok(steps.includes(3), 'Must include Pages step');
  assert.ok(steps.includes(4), 'Must include Access step');
  assert.ok(steps.includes(5), 'Must include R2 step');
  assert.ok(steps.includes(6), 'Must include Worker step');

  // Verification checks are displayed in plan output
  const output = logs.join('\n');
  assert.match(output, /Verification: 6 checks/);
});

test('plan against a fully built account reports "No changes. Verification: 6 checks."', async () => {
  const allMigrations = getMigrationFiles();

  const { state, fetchImpl } = createMockFetch({
    teamDomain: 'legacy-hub',
    databases: [
      { uuid: 'id_prod', name: 'legacy-hub-db' },
      { uuid: 'id_staging', name: 'legacy-hub-db-staging' }
    ],
    hasD1MigrationsTable: {
      id_prod: true,
      id_staging: true
    },
    migrations: {
      id_prod: allMigrations,
      id_staging: allMigrations
    },
    pagesProject: {
      name: 'legacy-hub',
      production_branch: 'main',
      deployment_configs: {
        production: {
          env_vars: {
            PORTAL_TOKEN_SECRET: { type: 'secret_text', value: null },
            CF_ACCESS_TEAM_DOMAIN: { type: 'plain_text', value: 'legacy-hub.cloudflareaccess.com' },
            CF_ACCESS_AUD: { type: 'plain_text', value: 'aud_1' }
          }
        },
        preview: {
          env_vars: {
            PORTAL_TOKEN_SECRET: { type: 'secret_text', value: null },
            CF_ACCESS_TEAM_DOMAIN: { type: 'plain_text', value: 'legacy-hub.cloudflareaccess.com' },
            CF_ACCESS_AUD: { type: 'plain_text', value: 'aud_1' }
          }
        }
      }
    },
    identityProviders: [{ type: 'onetimepin', name: 'One-time PIN' }],
    apps: [{ id: 'app_1', name: 'Legacy Hub Staff Console', aud: 'aud_1' }],
    policies: {
      app_1: [{ name: 'Legacy staff allowlist', decision: 'allow' }]
    },
    buckets: ['legacy-hub-backups', 'legacy-hub-media'],
    workerScript: { id: 'legacy-hub-backup' }
  });

  const logs = [];
  const logger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  const result = await runBootstrap({
    accountId: 'test_account_built',
    token: 'test_token_123',
    mode: 'plan',
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger
  });

  assert.equal(state.writeCalls.length, 0, 'Must make zero writes');
  assert.equal(result.plannedActions.length, 0, 'Must have zero planned actions on fully built account');

  const output = logs.join('\n');
  assert.match(output, /No changes\. Verification: 6 checks\./);
  assert.match(output, /Secrets present: CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, PORTAL_TOKEN_SECRET/);
});

test('baselining an existing DB records without executing SQL', async () => {
  const allMigrations = getMigrationFiles();

  // Existing databases with tables and matching schema, but missing d1_migrations table
  const { state, fetchImpl } = createMockFetch({
    databases: [
      { uuid: 'id_prod', name: 'legacy-hub-db' },
      { uuid: 'id_staging', name: 'legacy-hub-db-staging' }
    ],
    d1Tables: {
      id_prod: ['content_item', 'content_type', 'caregiver'],
      id_staging: ['content_item', 'content_type', 'caregiver']
    },
    hasD1MigrationsTable: {
      id_prod: false,
      id_staging: false
    },
    contentItemCols: {
      id_prod: [{ name: 'id' }, { name: 'draft_of' }],
      id_staging: [{ name: 'id' }, { name: 'draft_of' }]
    },
    pageSectionSchema: {
      id_prod: '{"caring_for_options": []}',
      id_staging: '{"caring_for_options": []}'
    }
  });

  const planLogs = [];
  const planLogger = { log: (msg) => planLogs.push(msg), error: (msg) => planLogs.push(msg) };

  // Plan mode: prints baseline message and does NOT queue raw migration SQL actions
  const planResult = await runBootstrap({
    accountId: 'acc_baseline',
    token: 'test_token_123',
    mode: 'plan',
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger: planLogger
  });

  const planOut = planLogs.join('\n');
  assert.match(planOut, /baseline: record 0001-0010 as applied/);
  const migrationActions = planResult.plannedActions.filter((a) => a.action.includes('Apply migration'));
  assert.equal(migrationActions.length, 0, 'Plan must not queue SQL migration executions for matching baseline DB');

  // Apply mode: records rows in d1_migrations without executing migration SQL files
  const applyLogs = [];
  const applyLogger = { log: (msg) => applyLogs.push(msg), error: (msg) => applyLogs.push(msg) };

  await runBootstrap({
    accountId: 'acc_baseline',
    token: 'test_token_123',
    mode: 'apply',
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger: applyLogger
  });

  // Verify d1_migrations now recorded
  assert.equal(state.migrations['id_prod']?.length, allMigrations.length);
  assert.equal(state.migrations['id_staging']?.length, allMigrations.length);

  // Verify none of the executed SQL was raw table drops or seed migrations
  const rawExecuted = state.executedSql.map((e) => e.sql).join('\n');
  assert.doesNotMatch(rawExecuted, /CREATE TABLE event/, 'Must not execute migration SQL when baselining');
  assert.match(rawExecuted, /INSERT OR IGNORE INTO d1_migrations/);
});

test('mismatched existing database fails baseline safely with clear message', async () => {
  const { fetchImpl } = createMockFetch({
    databases: [{ uuid: 'id_prod', name: 'legacy-hub-db' }],
    d1Tables: { id_prod: ['content_item'] },
    hasD1MigrationsTable: { id_prod: false },
    contentItemCols: { id_prod: [{ name: 'id' }] }, // missing draft_of!
    pageSectionSchema: { id_prod: '{}' }
  });

  const logs = [];
  const logger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  await assert.rejects(
    async () => {
      await runBootstrap({
        accountId: 'acc_mismatch',
        token: 'test_token_123',
        mode: 'plan',
        fetchImpl,
        logger
      });
    },
    (err) => {
      assert.match(err.message, /does not match the latest migration schema.*probe failed.*Cannot safely baseline/);
      return true;
    }
  );
});

test('apply is idempotent when run twice (second run makes no writes)', async () => {
  const { state, fetchImpl } = createMockFetch({
    workerScript: { id: 'legacy-hub-backup' }
  });
  const logs = [];
  const logger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  // First apply run
  await runBootstrap({
    accountId: 'acc_idempotent',
    token: 'test_token_123',
    mode: 'apply',
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger
  });

  const firstRunWritesCount = state.writeCalls.length;
  assert.ok(firstRunWritesCount > 0, 'First run must execute writes to create resources');

  // Reset write tracking
  state.writeCalls = [];

  // Second apply run
  await runBootstrap({
    accountId: 'acc_idempotent',
    token: 'test_token_123',
    mode: 'apply',
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger
  });

  assert.equal(state.writeCalls.length, 0, 'Second apply run must make ZERO writes (idempotency)');
});

test('secrets are ensure, not change (preserves PORTAL_TOKEN_SECRET unless --rotate-secrets)', async () => {
  const { state, fetchImpl } = createMockFetch({
    pagesProject: {
      name: 'legacy-hub',
      production_branch: 'main',
      deployment_configs: {
        production: {
          env_vars: {
            PORTAL_TOKEN_SECRET: { type: 'secret_text', value: 'existing_token_secret_123' },
            CF_ACCESS_TEAM_DOMAIN: { type: 'plain_text', value: 'legacy-hub.cloudflareaccess.com' },
            CF_ACCESS_AUD: { type: 'plain_text', value: 'aud_existing' }
          }
        },
        preview: {
          env_vars: {
            PORTAL_TOKEN_SECRET: { type: 'secret_text', value: 'existing_token_secret_123' },
            CF_ACCESS_TEAM_DOMAIN: { type: 'plain_text', value: 'legacy-hub.cloudflareaccess.com' },
            CF_ACCESS_AUD: { type: 'plain_text', value: 'aud_existing' }
          }
        }
      }
    },
    databases: [
      { uuid: 'id_prod', name: 'legacy-hub-db' },
      { uuid: 'id_staging', name: 'legacy-hub-db-staging' }
    ],
    hasD1MigrationsTable: { id_prod: true, id_staging: true },
    migrations: { id_prod: getMigrationFiles(), id_staging: getMigrationFiles() },
    identityProviders: [{ type: 'onetimepin', name: 'One-time PIN' }],
    apps: [{ id: 'app_1', name: 'Legacy Hub Staff Console', aud: 'aud_existing' }],
    policies: { app_1: [{ name: 'Legacy staff allowlist', decision: 'allow' }] },
    buckets: ['legacy-hub-backups', 'legacy-hub-media'],
    workerScript: { id: 'legacy-hub-backup' }
  });

  const logs = [];
  const logger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  // Run apply without --rotate-secrets
  await runBootstrap({
    accountId: 'acc_sec',
    token: 'test_token_123',
    mode: 'apply',
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger
  });

  assert.equal(state.writeCalls.length, 0, 'Must not touch secrets when already present');

  // Now run apply with --rotate-secrets
  await runBootstrap({
    accountId: 'acc_sec',
    token: 'test_token_123',
    mode: 'apply',
    rotateSecrets: true,
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger
  });

  const patchCall = state.writeCalls.find((c) => c.method === 'PATCH' && c.pathname.includes('/pages/projects/legacy-hub'));
  assert.ok(patchCall, 'Must update Pages secrets when --rotate-secrets is passed');
  assert.ok(patchCall.body.deployment_configs.production.env_vars.PORTAL_TOKEN_SECRET);
});

test('the token is never printed to stdout or logs', async () => {
  const secretToken = 'SUPER_SECRET_CLOUDFLARE_API_TOKEN_XYZ_999';
  const { fetchImpl } = createMockFetch();
  const logs = [];
  const logger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  await runBootstrap({
    accountId: 'acc_token_check',
    token: secretToken,
    mode: 'plan',
    staffEmails: ['alice@example.com'],
    fetchImpl,
    logger
  });

  const fullOutput = logs.join('\n');
  assert.doesNotMatch(fullOutput, new RegExp(secretToken), 'API token must never appear in stdout or logs');
});

test('missing-Zero-Trust stops with the specified plain message', async () => {
  const { fetchImpl } = createMockFetch({ zeroTrustEnabled: false });
  const logs = [];
  const logger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  await assert.rejects(
    async () => {
      await runBootstrap({
        accountId: 'acc_no_zt',
        token: 'token_123',
        mode: 'plan',
        fetchImpl,
        logger
      });
    },
    (err) => {
      assert.match(
        err.message,
        /Zero Trust is not enabled on this account.*Cloudflare dashboard -> Zero Trust -> Get started -> select Zero Trust Free plan/
      );
      return true;
    }
  );
});

test('missing-R2 stops with the specified plain message', async () => {
  const { fetchImpl } = createMockFetch({ r2Enabled: false });
  const logs = [];
  const logger = { log: (msg) => logs.push(msg), error: (msg) => logs.push(msg) };

  await assert.rejects(
    async () => {
      await runBootstrap({
        accountId: 'acc_no_r2',
        token: 'token_123',
        mode: 'plan',
        fetchImpl,
        logger
      });
    },
    (err) => {
      assert.match(
        err.message,
        /R2 is not enabled on this account.*Cloudflare dashboard -> R2 Object Storage -> Add R2 subscription to my account/
      );
      return true;
    }
  );
});
