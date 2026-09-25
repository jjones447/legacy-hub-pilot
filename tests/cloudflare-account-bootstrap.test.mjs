// Tests for LEGACY-ACCOUNT-BOOTSTRAP-R1: Cloudflare account bootstrap script
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractConsoleDestinations,
  runBootstrap,
  parseArgs,
  verifyDeployment
} from '../scripts/cloudflare-account-bootstrap.mjs';

function createMockFetch(initialState = {}) {
  const state = {
    zeroTrustEnabled: true,
    r2Enabled: true,
    teamDomain: 'legacy-hub',
    databases: [],
    migrations: {},
    pagesProject: null,
    identityProviders: [],
    apps: [],
    policies: {},
    buckets: [],
    workerScript: null,
    workerSubdomainEnabled: true,
    writeCalls: [],
    ...initialState
  };

  const fetchImpl = async (url, init = {}) => {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const method = init.method || 'GET';
    const body = init.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : null;

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const isSelectQuery = pathname.includes('/query') && body?.sql?.trim()?.toUpperCase()?.startsWith('SELECT');
      if (!isSelectQuery) {
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
      if (sql.includes('SELECT name FROM _schema_migrations')) {
        const applied = state.migrations[dbId] || [];
        return new Response(JSON.stringify({ success: true, result: [{ results: applied.map((n) => ({ name: n })) }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      // Record migration
      const migMatch = sql.match(/INSERT OR REPLACE INTO _schema_migrations VALUES \('([^']+)'/);
      if (migMatch) {
        if (!state.migrations[dbId]) state.migrations[dbId] = [];
        state.migrations[dbId].push(migMatch[1]);
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

    // Worker Script
    if (pathname.includes('/workers/scripts/legacy-hub-backup')) {
      if (pathname.endsWith('/subdomain')) {
        state.workerSubdomainEnabled = body.enabled;
        state.workerScript = { id: 'legacy-hub-backup' };
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }

      if (method === 'GET') {
        if (!state.workerScript) {
          return new Response(JSON.stringify({ success: false, errors: [{ message: 'Not found' }] }), { status: 404 });
        }
        return new Response(JSON.stringify({ success: true, result: state.workerScript }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ success: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  return { state, fetchImpl };
}

test('extractConsoleDestinations extracts paths from functions/_middleware.js and generates destinations', () => {
  const { paths, destinations } = extractConsoleDestinations();
  // 7 distinct paths
  assert.equal(paths.length, 7);
  assert.ok(paths.includes('/staff.html'));
  assert.ok(paths.includes('/staff'));
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
  assert.ok(steps.includes(7), 'Must include Pages deploy step');
});

test('plan against a fully built account reports nothing to do', async () => {
  const allMigrations = [
    '0001_init.sql',
    '0002_seed_public_events.sql',
    '0003_grant_award.sql',
    '0004_content_types.sql',
    '0005_portal_login.sql',
    '0006_caregiver_contact_history_outcomes.sql',
    '0007_grant_course_complete.sql',
    '0008_agent_change.sql',
    '0009_content_live.sql',
    '0010_page_section_forms.sql'
  ];

  const { state, fetchImpl } = createMockFetch({
    teamDomain: 'legacy-hub',
    databases: [
      { uuid: 'id_prod', name: 'legacy-hub-db' },
      { uuid: 'id_staging', name: 'legacy-hub-db-staging' }
    ],
    migrations: {
      id_prod: allMigrations,
      id_staging: allMigrations
    },
    pagesProject: {
      name: 'legacy-hub',
      production_branch: 'main'
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
  // Only the standard continuous steps (unlogged secret generation / deployment check) or 0
  const actionableResourceCreates = result.plannedActions.filter(
    (a) => a.action.includes('Create D1') || a.action.includes('Create Access app') || a.action.includes('Create private R2')
  );
  assert.equal(actionableResourceCreates.length, 0, 'Plan must find zero missing resources to create');
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
