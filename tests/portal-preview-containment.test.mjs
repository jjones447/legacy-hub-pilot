// Pure synthetic containment tests: fake D1 only, no SQLite, provider, workerd,
// subprocess, customer fixtures or compiler. Exercise actual handler branches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { canSendEmail } from '../functions/_lib/email.js';

const ORIGIN = 'https://portal.synthetic.invalid';
const SECRET = 'synthetic-preview-retained-session-secret';

async function productionCredentials() {
  const rows = [];
  const db = {
    prepare(sql) {
      return { bind(...values) {
        return {
          async first() {
            if (sql.includes('COUNT(*)')) return { n: 0 };
            if (sql.includes('SELECT id, email FROM caregiver')) {
              return { id: 'synthetic-caregiver', email: 'caregiver@example.invalid' };
            }
            if (sql.includes('FROM portal_token')) {
              return rows.find(row => row.token_hash === values[0]) ?? null;
            }
            throw new Error('Unexpected synthetic first');
          },
          async run() {
            if (sql.includes('INSERT INTO portal_token')) {
              rows.push({ token_hash: values[0], caregiver_id: values[1], expires_at: values[2], used: 0 });
              return { meta: { changes: 1 } };
            }
            if (sql.includes('UPDATE portal_token')) {
              const row = rows.find(row => row.token_hash === values[0] && row.used === 0);
              if (row) row.used = 1;
              return { meta: { changes: row ? 1 : 0 } };
            }
            if (sql.includes('INSERT INTO audit_log')) return { meta: { changes: 1 } };
            throw new Error('Unexpected synthetic run');
          },
        };
      } };
    },
  };
  const env = { LEGACY_DB: db, PORTAL_TOKEN_SECRET: SECRET, EMAIL_API_KEY: 'synthetic-key', PORTAL_DEV_RETURN_LINK: '1' };
  const originalFetch = globalThis.fetch;
  let mailedLink;
  let sends = 0;
  globalThis.fetch = async (_url, init) => {
    sends++;
    mailedLink = JSON.parse(init.body).text.match(/https:\/\/[^\s]+\/api\/portal\/verify\?token=[A-Za-z0-9_-]+/)[0];
    return { ok: true, status: 202 };
  };
  try {
    const login = await onRequestPost({ env, request: new Request(`${ORIGIN}/api/portal/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'caregiver@example.invalid' }),
    }) });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { ok: true }, 'even the retired flag cannot return production tokens');
    assert.equal(sends, 1);
    assert.match(mailedLink, /^https:\/\/portal\.synthetic\.invalid\/api\/portal\/verify\?token=[A-Za-z0-9_-]{43}$/);
    const verify = await onRequestGet({ env, request: new Request(mailedLink) });
    assert.equal(verify.status, 302);
    const cookie = verify.headers.get('Set-Cookie').split(';')[0];
    assert.match(cookie, /^portal_session=/);
    return { mailedLink, cookie };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Throwing getters make early refusal observable: a swallowed effect cannot
// masquerade as a passing 503. This checks identity/body access as well as I/O.
async function blockedEffects(environment, retiredFlag, run) {
  const effects = [];
  const env = { ENVIRONMENT: environment, PORTAL_DEV_RETURN_LINK: retiredFlag };
  for (const name of ['LEGACY_DB', 'PORTAL_TOKEN_SECRET', 'EMAIL_API_KEY']) {
    Object.defineProperty(env, name, { get() { effects.push(name); throw new Error('Forbidden synthetic binding read'); } });
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { effects.push('fetch'); throw new Error('Forbidden synthetic network'); };
  const request = (url, method) => ({
    url, method,
    headers: { get() { effects.push('identity/header'); throw new Error('Forbidden synthetic identity read'); } },
    async json() { effects.push('body'); throw new Error('Forbidden synthetic body read'); },
  });
  try {
    await run(env, request);
    assert.deepEqual(effects, [], 'containment must precede credentials, data, identity and network');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

for (const environment of ['preview', 'development']) {
  for (const retiredFlag of [undefined, '1', 1]) {
    test(`${environment}: all caregiver routes refuse before effects (old flag ${retiredFlag})`, async () => {
      await blockedEffects(environment, retiredFlag, async (env, request) => {
        for (const [method, handler, actions] of [
          ['GET', onRequestGet, ['login', 'verify', 'me', 'wellness', 'unknown']],
          ['POST', onRequestPost, ['login', 'verify', 'me', 'wellness', 'unknown']],
        ]) {
          for (const action of actions) {
            const res = await handler({ env, request: request(`${ORIGIN}/api/portal/${action}`, method) });
            assert.equal(res.status, 503);
            assert.deepEqual(await res.json(), { ok: false, error: 'preview_portal_disabled' });
            assert.equal(res.headers.get('Set-Cookie'), null);
            assert.equal(res.headers.get('Location'), null);
          }
        }
      });
    });
  }

  test(`${environment}: old bearer links and valid signed sessions cannot unlock caregiver data`, async () => {
    const { mailedLink, cookie } = await productionCredentials();
    await blockedEffects(environment, '1', async (env) => {
      // Same synthetically minted bearer formats/secret as a retained preview
      // credential. Refuse before checking validity or resolving a record.
      for (const [method, url] of [
        ['GET', mailedLink],
        ['GET', `${ORIGIN}/api/portal/me`],
        ['GET', `${ORIGIN}/api/portal/wellness`],
        ['POST', `${ORIGIN}/api/portal/wellness`],
      ]) {
        const handler = method === 'GET' ? onRequestGet : onRequestPost;
        const res = await handler({ env, request: new Request(url, { method, headers: { Cookie: cookie } }) });
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { ok: false, error: 'preview_portal_disabled' });
        assert.equal(res.headers.get('Set-Cookie'), null);
      }
    });
  });

  test(`${environment}: logout clears old cookie without secret or database`, async () => {
    await blockedEffects(environment, '1', async (env, request) => {
      const res = await onRequestPost({ env, request: request(`${ORIGIN}/api/portal/logout`, 'POST') });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      assert.match(res.headers.get('Set-Cookie'), /portal_session=; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=0;/);
    });
  });

  test(`${environment}: public staging pages remain available and mail remains disabled`, async () => {
    assert.equal(canSendEmail({ ENVIRONMENT: environment, EMAIL_API_KEY: 'synthetic-key' }), false);
    const res = await middleware({ env: { ENVIRONMENT: environment }, data: {},
      request: new Request(`${ORIGIN}/portal`), next: async () => new Response('public synthetic page') });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'public synthetic page');
  });
}

test('production mailed login and single-use verification remain intact', async () => {
  await productionCredentials();
});
