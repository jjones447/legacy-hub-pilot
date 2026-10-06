// The caregiver portal shows only real data: no sample caregiver shortcut, no canned
// application message, no invented saved resources, no sales copy (client meeting 2026-09-29: "we're past demo").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PORTAL = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('no demo actions or sample-caregiver shortcut in the portal', () => {
  assert.doesNotMatch(PORTAL, /data-action="demo-/);
  assert.doesNotMatch(PORTAL, /Maria G\.|Jane Doe|sample caregiver/i);
  for (const a of ['demo-portal-login', 'demo-view-application']) {
    assert.ok(!APP.includes(`'${a}'`), `${a} handler removed`);
  }
});

test('no invented saved resources and no sales copy on the dashboard', () => {
  assert.doesNotMatch(PORTAL, /saved Jun/);
  assert.doesNotMatch(PORTAL, /Why this matters/);
  assert.match(PORTAL, /Resources for you/);
});


test('portal copy requests a link without claiming it was sent or guaranteeing delivery', () => {
  assert.doesNotMatch(PORTAL, /We'll email you a link/);
  assert.match(PORTAL, /If your email is registered and delivery is available/);
  assert.match(APP, /Requesting sign-in link/);
  assert.doesNotMatch(APP, /Sending sign-in link/);
  assert.match(APP, /If this address is registered and delivery is available/);
  assert.match(APP, /signin_unavailable/);
  assert.match(APP, /Sign-in is temporarily unavailable/);
});

test('login UI shows the same generic success for undisclosed membership and a global unavailable error', async () => {
  const source = APP.slice(APP.indexOf('function submitPortalLogin('), APP.indexOf('function portalLogout('));
  assert.ok(source.startsWith('function submitPortalLogin('));
  async function simulate(data) {
    const status = { style: {}, textContent: '' };
    const button = { disabled: false };
    const context = {
      document: { getElementById: id => ({ loginEmail: { value: 'synthetic@example.invalid' }, loginStatus: status, loginBtn: button })[id] },
      fetch: async () => ({ status: data.ok ? 200 : 503, json: async () => data })
    };
    const submit = vm.runInNewContext(source + '\nsubmitPortalLogin;', context);
    submit();
    await new Promise(resolve => setImmediate(resolve));
    return { text: status.textContent, disabled: button.disabled };
  }
  assert.deepEqual(await simulate({ ok: true }), {
    text: 'If this address is registered and delivery is available, check your inbox for a secure sign-in link. If no link arrives, contact Legacy.',
    disabled: false
  });
  const unavailable = await simulate({ ok: false, error: 'signin_unavailable' });
  assert.equal(unavailable.text, 'Sign-in is temporarily unavailable. Please contact Legacy or try again later.');
  assert.equal(unavailable.disabled, false);
});
