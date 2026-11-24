import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { PROFILE_SECTIONS } from '../../functions/_lib/caregiver-profile-fields.js';
const read = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const response = (status, body) => ({ status, redirected: false, json: async () => body });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture(handler) {
  const dom = new JSDOM(read('profile.html'), { url: 'https://test.invalid/profile.html', runScripts: 'outside-only' });
  const requests = [], { window } = dom;
  window.fetch = async (url, options) => { requests.push({ url, ...options }); return handler(url, options); };
  window.eval(read('caregiver-profile.js')); window.eval(read('profile-page.js'));
  const root = window.document.getElementById('profilePageEditor');
  return { dom, window, root, requests,
    input(value) { const el = root.querySelector('[name=preferred_name]'); el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); },
    submit() { root.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); } };
}
const packet = (preferred_name = '', revision = 0) => ({ ok: true, sections: PROFILE_SECTIONS,
  profile: { revision, fields: { first_name: 'Fictional', last_name: 'Owner', email: 'owner@example.invalid', preferred_name } } });
test('dedicated page reuses all five field sections; ordinary save and reload retain values, dashboard contains link only', async t => {
  let value = '', rev = 0;
  const f = fixture((url, options) => {
    if (url.endsWith('/me')) return response(200, { ok: true, profile: { id: 'fictional-a' } });
    if (options.method === 'POST') { value = JSON.parse(options.body).fields.preferred_name; rev++; return response(200, { ok: true, revision: rev }); }
    return response(200, packet(value, rev));
  }); t.after(() => f.window.close()); await settle();
  assert.equal(f.window.document.querySelectorAll('main').length, 1);
  assert.equal(f.window.document.querySelectorAll('[id=main]').length, 1);
  assert.equal(f.root.querySelectorAll('details').length, 5);
  assert.equal(f.root.querySelectorAll('.profile-optional-help').length, 4);
  const demographic = f.root.querySelectorAll('details')[4];
  assert.equal(demographic.querySelector('.profile-optional-help'), null);
  assert.equal(demographic.querySelector('p').textContent, PROFILE_SECTIONS[4].intro);
  assert.equal(f.root.querySelector('[name=email]').readOnly, true);
  f.input('Synthetic saved'); f.submit(); await settle();
  assert.equal(f.root.querySelector('[name=preferred_name]').value, 'Synthetic saved');
  assert.match(f.root.textContent, /Your profile is saved/);
  assert.deepEqual(JSON.parse(f.requests.find(r => r.method === 'POST').body), { revision: 0, fields: { preferred_name: 'Synthetic saved' } });
  assert.equal(f.window.localStorage.length, 0); assert.equal(f.window.sessionStorage.length, 0);
  const portal = new JSDOM(read('portal.html')).window.document;
  assert.equal(portal.querySelector('#portalProfileEditor'), null);
  assert.ok(portal.querySelector('#portalProfileCard a[href="profile.html"]'));
});
test('anonymous session never loads answers and directs user to ordinary portal sign-in', async t => {
  const f = fixture(() => response(401, { ok: false })); t.after(() => f.window.close()); await settle();
  assert.equal(f.root.hidden, true); assert.equal(f.root.querySelector('form'), null);
  assert.ok(f.requests.every(r => r.url === '/api/portal/me'));
  assert.match(f.window.document.getElementById('profilePageStatus').textContent, /sign in/i);
});
test('account switch before save clears answers and blocks the write', async t => {
  let owner = 'fictional-a';
  const f = fixture(url => url.endsWith('/me') ? response(200, { ok: true, profile: { id: owner } }) : response(200, packet()));
  t.after(() => f.window.close()); await settle(); f.input('Never send to B'); owner = 'fictional-b'; f.submit(); await settle();
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0); assert.equal(f.root.hidden, true);
  assert.equal(f.root.textContent, ''); assert.match(f.window.document.getElementById('profilePageStatus').textContent, /account changed/);
});
test('pagehide clears answers and late response cannot repopulate; persisted pageshow checks identity again', async t => {
  let resolve, pending = true;
  const f = fixture(url => url.endsWith('/me') ? response(200, { ok: true, profile: { id: 'fictional-a' } })
    : pending ? new Promise(r => { resolve = r; }) : response(200, packet('Fresh')));
  t.after(() => f.window.close()); await settle(); assert.ok(resolve);
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  resolve(response(200, packet('OLD PRIVATE ANSWER'))); await settle();
  assert.equal(f.root.textContent, ''); assert.equal(f.root.hidden, true);
  pending = false;
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true })); await settle();
  assert.equal(f.root.querySelector('[name=preferred_name]').value, 'Fresh');
});
test('focus recheck preserves same-owner unsaved changes but clears them on identity failure', async t => {
  let valid = true;
  const f = fixture(url => url.endsWith('/me') ? response(valid ? 200 : 401, { ok: valid, profile: { id: 'fictional-a' } }) : response(200, packet()));
  t.after(() => f.window.close()); await settle(); f.input('Unsaved');
  f.window.dispatchEvent(new f.window.Event('focus')); await settle();
  assert.equal(f.root.querySelector('[name=preferred_name]').value, 'Unsaved');
  valid = false; f.window.dispatchEvent(new f.window.Event('focus')); await settle();
  assert.equal(f.root.textContent, ''); assert.equal(f.root.hidden, true);
});
test('uncertain logout clears answers and cannot repeat POST or reload', async t => {
  const f = fixture(url => url.endsWith('/me') ? response(200, { ok: true, profile: { id: 'fictional-a' } })
    : url.endsWith('/logout') ? response(503, { ok: false }) : response(200, packet()));
  t.after(() => f.window.close()); await settle();
  const btn = f.window.document.getElementById('profilePageLogout'); btn.click(); await settle(); btn.click();
  f.window.document.getElementById('profilePageReload').click(); await settle();
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true })); await settle();
  assert.equal(f.requests.filter(r => r.url.endsWith('/logout')).length, 1);
  assert.equal(f.root.textContent, ''); assert.match(f.window.document.getElementById('profilePageStatus').textContent, /could not be confirmed/);
});
