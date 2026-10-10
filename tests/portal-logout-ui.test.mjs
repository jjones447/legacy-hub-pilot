// Source-only synthetic DOM/fetch checks. No browser, server, cookie, DB or provider calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function portalLogout('), app.indexOf('function renderPortalData('));
assert.ok(source.startsWith('function portalLogout('));

function fixture(reply) {
  const nodes = {
    loginView: { style: { display: 'none' } },
    dashView: { style: { display: 'block' } },
    loginStatus: { style: { display: 'block' } },
    loginEmail: { value: 'synthetic@example.invalid' },
    portalLogoutBtn: { disabled: false },
    portalLogoutStatus: { style: { display: 'none' }, textContent: '' }
  };
  const requests = [];
  const scrolls = [];
  const logout = vm.runInNewContext(source + '\nportalLogout;', {
    document: { getElementById: id => nodes[id] },
    fetch: async (url, options) => { requests.push({ url, method: options.method }); return reply(); },
    window: { scrollTo: options => scrolls.push(options) }
  });
  return { nodes, requests, scrolls, logout };
}

const response = (status, data, redirected = false) => ({ status, redirected, json: async () => data });
const settle = () => new Promise(resolve => setImmediate(resolve));

function assertHeld(f) {
  assert.equal(f.nodes.dashView.style.display, 'block');
  assert.equal(f.nodes.loginView.style.display, 'none');
  assert.equal(f.nodes.loginEmail.value, 'synthetic@example.invalid');
  assert.equal(f.nodes.loginStatus.style.display, 'block');
  assert.equal(f.scrolls.length, 0);
  assert.equal(f.nodes.portalLogoutBtn.disabled, true);
  assert.equal(f.nodes.portalLogoutStatus.style.display, 'block');
  assert.match(f.nodes.portalLogoutStatus.textContent, /could not be confirmed/i);
  assert.match(f.nodes.portalLogoutStatus.textContent, /close this tab.*contact Legacy.*before trying again/i);
}

test('portal provides an accessible sign-out acknowledgement status and identified button', () => {
  assert.match(portal, /id="portalLogoutBtn"/);
  assert.match(portal, /id="portalLogoutStatus"[^>]*role="alert"/);
});

test('only HTTP200 with explicit ok:true switches to signed-out view', async () => {
  const f = fixture(() => response(200, { ok: true }));
  f.logout();
  await settle();
  assert.deepEqual(f.requests, [{ url: '/api/portal/logout', method: 'POST' }]);
  assert.equal(f.nodes.dashView.style.display, 'none');
  assert.equal(f.nodes.loginView.style.display, 'block');
  assert.equal(f.nodes.loginEmail.value, '');
  assert.equal(f.nodes.loginStatus.style.display, 'none');
  assert.equal(f.nodes.portalLogoutStatus.style.display, 'none');
  assert.equal(f.nodes.portalLogoutBtn.disabled, false);
  assert.equal(f.scrolls.length, 1);
});

test('HTTP failures never imply logout even if their body says ok:true', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const f = fixture(() => response(status, { ok: true }));
    f.logout();
    await settle();
    assertHeld(f);
    assert.equal(f.requests.length, 1);
  }
});

test('missing or nonboolean acknowledgement stays uncertain', async () => {
  for (const data of [{ ok: false }, {}, null, { ok: 'true' }]) {
    const f = fixture(() => response(200, data));
    f.logout();
    await settle();
    assertHeld(f);
  }
});

test('redirected or unexpected success responses do not certify logout', async () => {
  for (const reply of [response(200, { ok: true }, true), response(204, { ok: true })]) {
    const f = fixture(() => reply);
    f.logout();
    await settle();
    assertHeld(f);
  }
});

test('invalid JSON and network rejection show bounded uncertainty without exception details', async () => {
  for (const reply of [
    () => ({ status: 200, json: async () => { throw new Error('synthetic private response detail'); } }),
    () => { throw new Error('synthetic private transport detail'); }
  ]) {
    const f = fixture(reply);
    f.logout();
    await settle();
    assertHeld(f);
    assert.doesNotMatch(f.nodes.portalLogoutStatus.textContent, /private|synthetic/);
  }
});

test('pending duplicate clicks and uncertain outcomes do not repeat the POST', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(() => pending);
  f.logout();
  f.logout();
  assert.equal(f.requests.length, 1);
  assert.equal(f.nodes.portalLogoutBtn.disabled, true);
  assert.equal(f.nodes.dashView.style.display, 'block');
  release(response(500, { ok: false }));
  await settle();
  assertHeld(f);
  f.logout();
  await settle();
  assert.equal(f.requests.length, 1);
});
