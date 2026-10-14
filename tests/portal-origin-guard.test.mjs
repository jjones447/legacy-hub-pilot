// Present-Origin defense only, using real Headers and fake bindings. No SQLite,
// network, provider, mail, customer records, workerd, compiler or subprocess.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';

const ORIGIN = 'https://origin.synthetic.invalid';
const ID = 'cg_origin_synthetic';
const SECRET = 'synthetic-origin-cookie-key';
const CLEARED = 'portal_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
const realFetch = globalThis.fetch;
let fetches;
beforeEach(() => {
  fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('Unexpected synthetic network call'); };
});
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0); });

const BAD = [
  '', 'null', 'not-an-origin', 'https://other.synthetic.invalid',
  `${ORIGIN}/`, `${ORIGIN}/path`, `${ORIGIN}?query`, `${ORIGIN}#fragment`,
  'https://user:password@origin.synthetic.invalid', `${ORIGIN}.evil.invalid`,
  `${ORIGIN}, https://other.synthetic.invalid`, `${ORIGIN} ${ORIGIN}`,
  'http://origin.synthetic.invalid', `${ORIGIN}:8443`, `${ORIGIN}:443`,
  'https://ORIGIN.synthetic.invalid',
];

function hostile(action, value, environment, suppliedHeaders) {
  const effects = [];
  const headers = suppliedHeaders ?? new Headers({ oRiGiN: value });
  const env = { ENVIRONMENT: environment, PORTAL_DEV_RETURN_LINK: '1' };
  for (const name of ['PORTAL_TOKEN_SECRET', 'LEGACY_DB', 'EMAIL_API_KEY']) {
    Object.defineProperty(env, name, { get() { effects.push(name); throw new Error('Unexpected binding access'); } });
  }
  const request = {
    url: `${ORIGIN}/api/portal/${action}`, method: 'POST',
    headers: { get(name) {
      if (name.toLowerCase() === 'origin') { effects.push('Origin'); return headers.get(name); }
      effects.push(`header:${name}`); throw new Error('Unexpected identity/header access');
    } },
    async json() { effects.push('body'); throw new Error('Unexpected body access'); },
  };
  return { env, request, effects };
}

async function assertJson(res, status, data, extra = {}) {
  assert.equal(res.status, status);
  assert.equal(await res.text(), JSON.stringify(data));
  assert.deepEqual(Object.fromEntries(res.headers), {
    'cache-control': 'no-store', 'content-type': 'application/json', ...extra,
  });
}

for (const action of ['login', 'wellness', 'logout']) {
  test(`${action}: every bad present Origin refuses before credential/cookie/body/store effects`, async () => {
    for (const value of BAD) {
      const f = hostile(action, value);
      await assertJson(await onRequestPost(f), 403, { ok: false, error: 'forbidden' });
      assert.deepEqual(f.effects, ['Origin'], `only Origin read allowed for ${JSON.stringify(value)}`);
    }
  });

  test(`${action}: duplicate same-origin fields concatenate and refuse, not first-value acceptance`, async () => {
    const headers = new Headers({ Origin: ORIGIN });
    headers.append('origin', ORIGIN);
    assert.equal(headers.get('ORIGIN'), `${ORIGIN}, ${ORIGIN}`);
    const f = hostile(action, ORIGIN, undefined, headers);
    await assertJson(await onRequestPost(f), 403, { ok: false, error: 'forbidden' });
    assert.deepEqual(f.effects, ['Origin']);
  });
}

async function signedCookie() {
  const payload = `${ID}:${Date.now() + 60_000}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`session:${payload}`));
  const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
  return `portal_session=${encodeURIComponent(`${payload}:${hex}`)}`;
}

function compatible(action, origin, cookie, targetOrigin = ORIGIN) {
  const effects = [];
  const headers = new Headers();
  if (origin !== null) headers.set('ORIGIN', origin);
  if (cookie) headers.set('Cookie', cookie);
  const db = { prepare(sql) {
    effects.push('DB');
    const methods = {
      async first() {
        if (sql.includes('COUNT(*)')) return { n: 0 };
        if (sql.includes('SELECT id, email FROM caregiver')) return null; // No mail/token mint.
        if (sql.includes('SELECT id FROM caregiver')) return { id: ID };
        throw new Error('Unexpected fake first');
      },
      async run() { return { success: true, meta: { changes: 1 } }; },
      async all() { throw new Error('Unexpected history read'); },
    };
    return { bind: () => methods, ...methods };
  } };
  const env = { LEGACY_DB: db, PORTAL_TOKEN_SECRET: SECRET, EMAIL_API_KEY: 'synthetic-unused-key' };
  return { effects, env, request: {
    url: `${targetOrigin}/api/portal/${action}`, method: 'POST',
    headers: { get(name) { effects.push(`header:${name.toLowerCase()}`); return headers.get(name); } },
    async json() {
      effects.push('body');
      return action === 'login' ? { email: 'unknown@example.invalid' }
        : { answers: { stress: 3, sleep: 3, support: 3, self_time: 3 } };
    },
  } };
}

for (const origin of [ORIGIN, null]) {
  const label = origin === null ? 'actual absence (compatibility only)' : 'exact same origin';
  for (const action of ['login', 'wellness', 'logout']) test(`${action}: ${label} preserves existing success/body/cookie contract`, async () => {
    const f = compatible(action, origin, await signedCookie());
    const res = await onRequestPost(f);
    await assertJson(res, 200, action === 'wellness' ? { ok: true, score: 50 } : { ok: true },
      action === 'logout' ? { 'set-cookie': CLEARED } : {});
    assert.equal(f.effects[0], 'header:origin');
    assert.ok(f.effects.includes('DB'), 'accepted transport still reaches the existing action');
  });
}

test('exact serialized nondefault-port origin works; default-port spelling is not normalized by guard', async () => {
  const custom = `${ORIGIN}:8443`;
  const f = compatible('login', custom, null, custom);
  await assertJson(await onRequestPost(f), 200, { ok: true });
  const denied = hostile('login', `${ORIGIN}:443`);
  await assertJson(await onRequestPost(denied), 403, { ok: false, error: 'forbidden' });
});

test('literal null is never trusted, even for an artificial opaque request URL', async () => {
  const f = hostile('logout', 'null');
  f.request.url = 'data:/api/portal/logout';
  await assertJson(await onRequestPost(f), 403, { ok: false, error: 'forbidden' });
  assert.deepEqual(f.effects, ['Origin']);
});

for (const environment of ['preview', 'development']) test(`${environment}: refusal and logout precede even Origin access`, async () => {
  for (const action of ['login', 'wellness', 'logout']) {
    const f = hostile(action, 'https://evil.synthetic.invalid', environment);
    f.request.headers.get = () => { f.effects.push('Origin-or-cookie'); throw new Error('No header access'); };
    const res = await onRequestPost(f);
    await assertJson(res, action === 'logout' ? 200 : 503,
      action === 'logout' ? { ok: true } : { ok: false, error: 'preview_portal_disabled' },
      action === 'logout' ? { 'set-cookie': CLEARED } : {});
    assert.deepEqual(f.effects, []);
  }
});

test('GET verify/me/wellness behavior remains independent of Origin', async () => {
  for (const action of ['verify', 'me', 'wellness']) {
    const effects = [];
    const request = {
      url: `${ORIGIN}/api/portal/${action}`, method: 'GET',
      headers: { get(name) {
        effects.push(name.toLowerCase());
        if (name.toLowerCase() === 'origin') throw new Error('GET must not read Origin');
        return null;
      } },
    };
    const res = await onRequestGet({ request, env: { PORTAL_TOKEN_SECRET: SECRET } });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    if (action === 'verify') {
      assert.equal(res.status, 400);
      assert.match(await res.text(), /Missing verification token\./);
      assert.deepEqual(effects, []);
    } else {
      await assertJson(res, 401, { ok: false, error: 'unauthorized' });
      assert.deepEqual(effects, ['cookie']);
    }
  }
});

test('unknown production POST preserves404 and does not inspect Origin', async () => {
  const request = { url: `${ORIGIN}/api/portal/unknown`, method: 'POST',
    headers: { get() { throw new Error('Unknown action must not read headers'); } },
    async json() { throw new Error('No body read'); } };
  await assertJson(await onRequestPost({ request, env: { PORTAL_TOKEN_SECRET: SECRET } }),
    404, { ok: false, error: 'not_found' });
  await assertJson(await onRequestPost({ request, env: {} }),
    503, { ok: false, error: 'auth_not_configured' });
});

for (const action of ['login', 'wellness', 'logout']) test(`${action}: present mismatch wins over missing signing configuration`, async () => {
  const f = hostile(action, 'https://evil.synthetic.invalid');
  f.env = {}; // Actually absent secret, not merely a throwing secret getter.
  Object.defineProperty(f.env, 'LEGACY_DB', { get() { f.effects.push('DB'); throw new Error('No DB access'); } });
  await assertJson(await onRequestPost(f), 403, { ok: false, error: 'forbidden' });
  assert.deepEqual(f.effects, ['Origin']);
});
