import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createHostedProfileFixture } from './runtime/profile-hosted-boundary.mjs';
import { HOSTED_PROFILE_MANIFEST } from './runtime/profile-hosted-manifest.mjs';
import { onRequestGet, onRequestPost } from '../functions/api/portal/[[path]].js';
import { fixture } from './helpers/caregiver-profile-fixture.mjs';
const ORIGIN = 'https://profile-fixture-unit.legacy-hub-5qo.pages.dev';
const SECRET = 'f'.repeat(64); // Fixed public unit-test value; never a hosted credential.
const owners = HOSTED_PROFILE_MANIFEST.owners;
function manifest() { return { ...HOSTED_PROFILE_MANIFEST, origin: ORIGIN, startsAt: Date.now() - 1000, expiresAt: Date.now() + 600000 }; }
function cookie(id = owners[0], expiry = Date.now() + 60000, secret = SECRET) {
  const payload = `${id}:${expiry}`;
  return 'portal_session=' + encodeURIComponent(payload + ':' + createHmac('sha256', secret).update('session:' + payload).digest('hex'));
}
function request({ path = '/api/portal/profile', method = 'GET', origin = ORIGIN, headers = {}, body } = {}) {
  const h = new Headers({ Cookie: cookie(), Origin: ORIGIN, 'Content-Type': 'application/json', ...headers });
  for (const [name, value] of Object.entries(headers)) if (value === null) h.delete(name);
  return new Request(origin + path, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function env(db) { return { ENVIRONMENT: 'preview', PROFILE_FIXTURE_SECRET: SECRET, LEGACY_DB: db }; }
function worker(m = manifest(), get = onRequestGet, post = onRequestPost) { return createHostedProfileFixture({ manifest: m, get, post }); }
function setup(t) {
  const f = fixture(); t.after(() => f.close());
  for (const [i, id] of owners.entries()) f.raw.prepare('INSERT INTO caregiver(id,first_name,email,status) VALUES (?,?,?,?)')
    .run(id, 'Fictional hosted owner', `hosted${i}@example.invalid`, i === 2 ? 'archived' : 'active');
  return f;
}
function witness(f) { return JSON.stringify(['caregiver_profile', 'audit_log', 'followup'].map(table => f.raw.prepare(`SELECT * FROM ${table}`).all())); }

test('inert null manifest stays closed before touching ANY env or DB', async () => {
  const unreadable = new Proxy({}, { get() { throw Error('must never read ambient env'); } });
  assert.equal((await worker({ ...manifest(), origin: null, startsAt: null, expiresAt: null }).fetch(request(), unreadable)).status, 403);
});

const denied = [
  ['wrong host', { origin: 'https://caregiversanctuary.org' }],
  ['wrong scheme', { origin: ORIGIN.replace('https:', 'http:') }],
  ['wrong Origin', { headers: { Origin: 'https://other.invalid' } }],
  ['null Origin', { headers: { Origin: 'null' } }],
  ['cross-site', { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
  ['query selector', { path: '/api/portal/profile?caregiver_id=cg_a' }],
  ['encoded path', { path: '/api/portal/%70rofile' }],
  ['missing cookie', { headers: { Cookie: null } }],
  ['real owner with valid fixture HMAC', { headers: { Cookie: cookie('cg_a') } }],
  ['duplicate cookie', { headers: { Cookie: cookie() + '; ' + cookie(owners[1]) } }],
  ['lookalike cookie', { headers: { Cookie: 'x' + cookie() } }],
  ['malformed encoding', { headers: { Cookie: 'portal_session=%E0%A4%A' } }],
  ['expired cookie', { headers: { Cookie: cookie(owners[0], Date.now() - 10000) } }],
  ['overlong session', { headers: { Cookie: cookie(owners[0], Date.now() + 3600000) } }],
  ['HEAD', { method: 'HEAD' }],
  ['POST without Origin', { method: 'POST', headers: { Origin: null }, body: { revision: 0, fields: { zip: '53202' } } }],
  ...['/mint', '/api/portal/login', '/api/portal/verify', '/api/portal/me', '/api/staff/people', '/api/agent/publisher/status', '/wrangler.toml', '/_worker.js', '/index.html', '/fixture-start.js?x=1'].map(path => [path, { path }]),
];
for (const [name, spec] of denied) test(`early ${name} denial cannot touch database, handler or assets`, async t => {
  const f = setup(t), before = witness(f); let reads = 0;
  const ambient = { ENVIRONMENT: 'preview', PROFILE_FIXTURE_SECRET: SECRET,
    get LEGACY_DB() { reads++; throw Error('DB accessed'); }, get ASSETS() { reads++; throw Error('assets accessed'); } };
  const hit = () => { throw Error('handler reached'); };
  const response = await worker(manifest(), hit, hit).fetch(request(spec), ambient);
  assert.ok([401, 403, 404, 405].includes(response.status), name);
  assert.equal(reads, 0); assert.equal(witness(f), before);
});

for (const [name, changes] of [
  ['unset', { origin: null }], ['production', { origin: 'https://caregiversanctuary.org' }],
  ['wildcard', { origin: 'https://*.legacy-hub-5qo.pages.dev' }], ['expired', { startsAt: Date.now() - 60000, expiresAt: Date.now() - 1000 }],
  ['future', { startsAt: Date.now() + 60000 }], ['overlong', { expiresAt: Date.now() + 7200000 }],
  ['customer id', { owners: ['cg_a', owners[1], owners[2]] }], ['duplicate ids', { owners: [owners[0], owners[0], owners[2]] }],
]) test(`manifest ${name} stays closed`, async () => {
  const inaccessible = new Proxy({}, { get() { throw Error('env accessed'); } });
  assert.equal((await worker({ ...manifest(), ...changes }).fetch(request(), inaccessible)).status, 403);
});

test('production env, missing/malformed secret and session beyond window refuse before DB', async () => {
  for (const fields of [{ ENVIRONMENT: 'production' }, { PROFILE_FIXTURE_SECRET: undefined }, { PROFILE_FIXTURE_SECRET: 'short' }]) {
    const ambient = { ...env(null), ...fields, get LEGACY_DB() { throw Error('DB accessed'); } };
    assert.equal((await worker().fetch(request(), ambient)).status, 403);
  }
  const m = { ...manifest(), expiresAt: Date.now() + 5000 };
  assert.equal((await worker(m).fetch(request(), env(null))).status, 401);
});

test('inherited secret sentinels never reach handlers, responses, logs or transport', async t => {
  const calls = [], logs = []; const savedFetch = globalThis.fetch, savedError = console.error, savedLog = console.log;
  globalThis.fetch = (...args) => { calls.push(args); throw Error('outbound fetch forbidden'); };
  console.error = (...args) => logs.push(args); console.log = (...args) => logs.push(args);
  t.after(() => { globalThis.fetch = savedFetch; console.error = savedError; console.log = savedLog; });
  const f = setup(t), ambient = env(f.db), secrets = ['EMAIL_API_KEY', 'PORTAL_TOKEN_SECRET', 'CLOUDFLARE_API_TOKEN', 'PREVIEW_MAIL_ENABLED', 'PORTAL_PREVIEW_MAIL_ENABLED', 'ACCESS_CLIENT_SECRET'];
  for (const name of secrets) Object.defineProperty(ambient, name, { enumerable: true, get() { throw Error('SENTINEL_' + name); } });
  const checked = handler => async context => {
    assert.deepEqual(Object.keys(context.env).sort(), ['ENVIRONMENT', 'LEGACY_DB', 'PORTAL_PROFILE_ENABLED', 'PORTAL_TOKEN_SECRET']);
    assert.equal(context.env.PORTAL_TOKEN_SECRET, SECRET);
    assert.equal(context.request.headers.has('Authorization'), false);
    assert.equal(context.request.headers.has('CF-Access-Client-Secret'), false);
    return handler(context);
  };
  const adapter = worker(manifest(), checked(onRequestGet), checked(onRequestPost));
  for (const spec of [{}, { method: 'POST', body: { revision: 0, fields: { zip: '53202' } } }, {}]) {
    const response = await adapter.fetch(request({ ...spec, headers: { Authorization: 'SENTINEL_HEADER', 'CF-Access-Client-Secret': 'SENTINEL_ACCESS' } }), ambient);
    assert.equal(response.status, 200); assert.equal((await response.text()).includes('SENTINEL'), false);
  }
  assert.deepEqual(calls, []); assert.deepEqual(logs, []);
});

test('unchanged HMAC/current-owner check and owner-isolated revision CAS are exercised through adapter', async t => {
  const f = setup(t), adapter = worker(), ambient = env(f.db);
  const call = spec => adapter.fetch(request(spec), ambient);
  for (const id of [owners[0], owners[2]]) {
    const before = witness(f);
    const response = await call({ headers: { Cookie: cookie(id, Date.now() + 60000, id === owners[0] ? 'wrong-secret' : SECRET) } });
    assert.equal(response.status, 401); assert.equal(witness(f), before);
  }
  assert.equal((await call({ method: 'POST', body: { revision: 0, fields: { zip: '53202', contact_requested: 'Yes' } } })).status, 200);
  assert.equal((await (await call({})).json()).profile.revision, 1);
  assert.equal((await (await call({ headers: { Cookie: cookie(owners[1]) } })).json()).profile.revision, 0);
  const before = witness(f);
  for (const spec of [
    { method: 'POST', body: { revision: 0, fields: { zip: '53203' } } },
    { method: 'POST', body: { revision: 0, fields: { caregiver_id: owners[0] } }, headers: { Cookie: cookie(owners[1]) } },
  ]) { assert.ok([400, 409].includes((await call(spec)).status)); assert.equal(witness(f), before); }
  f.raw.prepare("UPDATE caregiver SET status='archived' WHERE id=?").run(owners[0]);
  assert.equal((await call({})).status, 401); assert.equal(witness(f), before);
});

test('fixed asset forwarding strips secrets/cookies, ignores upstream headers and forbids arbitrary paths', async () => {
  const m = manifest(); let assets = 0;
  const ambient = { ENVIRONMENT: 'preview', ASSETS: { async fetch(req) {
    assets++; assert.equal([...req.headers].length, 0); assert.equal(new URL(req.url).origin, ORIGIN);
    return new Response('fixed asset', { headers: { 'Set-Cookie': 'SENTINEL', Location: 'https://other.invalid' } });
  } } };
  for (const path of ['/', '/caregiver-profile.js', '/styles.css', '/fixture-start.js']) {
    const response = await worker(m).fetch(request({ path }), ambient);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('Location'), null); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  }
  assert.equal(assets, 4);
});


test('pinned hosted candidate is closed outside its exact reviewed window', async () => {
  const blocked = new Proxy({}, { get() { throw Error('outside window accessed env'); } });
  for (const time of [HOSTED_PROFILE_MANIFEST.startsAt - 1, HOSTED_PROFILE_MANIFEST.expiresAt]) {
    const candidate = createHostedProfileFixture({ manifest: HOSTED_PROFILE_MANIFEST,
      get: onRequestGet, post: onRequestPost, now: () => time });
    const r = new Request(HOSTED_PROFILE_MANIFEST.origin + '/api/portal/profile');
    assert.equal((await candidate.fetch(r, blocked)).status, 403);
  }
});

test('reviewed synthetic seed preserves prior owners and refuses any duplicate insert', t => {
  const f = fixture(); t.after(() => f.close());
  f.raw.exec('ALTER TABLE caregiver ADD COLUMN is_caregiver INTEGER NOT NULL DEFAULT 0');
  const before = JSON.stringify(f.raw.prepare('SELECT * FROM caregiver ORDER BY id').all());
  const sql = readFileSync(new URL('./runtime/profile-hosted-seed.sql', import.meta.url), 'utf8');
  f.raw.exec(sql);
  const rows = f.raw.prepare("SELECT * FROM caregiver WHERE source='profile_qualification' ORDER BY id").all();
  assert.deepEqual(rows.map(row => row.id).sort(), [...owners].sort());
  assert.ok(rows.every(row => row.is_caregiver === 1 && row.email.endsWith('@example.invalid')));
  assert.equal(rows.filter(row => row.status === 'archived').length, 1);
  assert.equal(JSON.stringify(f.raw.prepare("SELECT * FROM caregiver WHERE source != 'profile_qualification' ORDER BY id").all()), before);
  const inserted = JSON.stringify(rows);
  assert.throws(() => f.raw.exec(sql), /UNIQUE constraint/);
  assert.equal(JSON.stringify(f.raw.prepare("SELECT * FROM caregiver WHERE source='profile_qualification' ORDER BY id").all()), inserted);
  assert.equal(witness(f), '[[],[],[]]');
});
