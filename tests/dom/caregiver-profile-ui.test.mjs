import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { PROFILE_SECTIONS } from '../../functions/_lib/caregiver-profile-fields.js';
const script = readFileSync(new URL('../../caregiver-profile.js', import.meta.url), 'utf8');
const response = (status, body) => ({ status, redirected: false, json: async () => body });
const packet = (fields = {}, revision = 0) => ({ ok: true, sections: PROFILE_SECTIONS,
  profile: { revision, fields: { first_name: 'Synthetic', last_name: 'Owner', email: 'owner@example.invalid', ...fields } } });
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function fixture(handler) {
  const dom = new JSDOM('<div id="root" hidden></div>', { url: 'https://test.invalid/portal.html', runScripts: 'outside-only' });
  const { window } = dom; const root = window.document.getElementById('root'); let epoch = 1; const requests = [];
  window.eval(script);
  const editor = window.createCaregiverProfileEditor(root, { epoch: () => epoch,
    fetch: async (url, options) => { requests.push({ url, ...options }); return handler(url, options, requests.length); } });
  const input = (key, value, event = 'input') => { const el = root.querySelector('#caregiver-profile-' + key); el.value = value; el.dispatchEvent(new window.Event(event, { bubbles: true })); return el; };
  const submit = () => root.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, window, root, editor, requests, input, submit, changeOwner: () => { epoch++; editor.clear(); } };
}
test('catalog form renders five accessible sections, readonly email and safe text without browser storage', async () => {
  const f = fixture(() => response(200, packet({ first_name: '<img src=x onerror=alert(1)>' })));
  await f.editor.load();
  assert.equal(f.root.querySelectorAll('details').length, 5);
  assert.equal(f.root.querySelectorAll('details[open]').length, 1);
  assert.equal(f.root.querySelectorAll('img').length, 0);
  assert.equal(f.root.querySelector('#caregiver-profile-email').readOnly, true);
  assert.equal(f.root.querySelector('#caregiver-profile-first_name').value, '<img src=x onerror=alert(1)>');
  for (const el of f.root.querySelectorAll('input:not([type=checkbox]),select,textarea')) assert.ok(f.root.querySelector('label[for="' + el.id + '"]'));
  assert.equal(f.window.localStorage.length, 0); assert.equal(f.window.sessionStorage.length, 0);
  assert.match(f.root.textContent, /All other questions are optional/);
  f.dom.window.close();
});
test('partial save excludes readonly and hidden changed answers, then reloads normalized saved state', async () => {
  let getCount = 0;
  const f = fixture((url, opts) => opts.method === 'POST' ? response(200, { ok: true, revision: 1 })
    : response(200, ++getCount === 1 ? packet() : packet({ currently_caring: 'No', first_name: 'New' }, 1)));
  await f.editor.load();
  f.input('first_name', ' New '); f.input('relationship', 'Parent', 'change'); f.input('currently_caring', 'No', 'change');
  f.root.querySelector('#caregiver-profile-email').value = 'tampered@example.invalid';
  f.submit(); await settle();
  const writes = f.requests.filter(x => x.method === 'POST'); assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].body), { revision: 0, fields: { first_name: ' New ', currently_caring: 'No' } });
  assert.equal(f.root.querySelector('#caregiver-profile-first_name').value, 'New');
  assert.match(f.root.textContent, /Your profile is saved/);
  assert.equal(f.root.querySelector('button[type=submit]').disabled, true);
  f.dom.window.close();
});
test('conditional questions preserve saved hidden values and exclusive choices clear conflicting options', async () => {
  const f = fixture(() => response(200, packet({ dementia_status: 'No', dementia_type: "Alzheimer's disease" })));
  await f.editor.load();
  const dementia = f.root.querySelector('#caregiver-profile-dementia_type');
  assert.equal(dementia.closest('.profile-field').hidden, true);
  f.input('dementia_status', 'Suspected dementia', 'change'); assert.equal(dementia.closest('.profile-field').hidden, false);
  assert.equal(dementia.value, "Alzheimer's disease");
  const choices = [...f.root.querySelectorAll('#caregiver-profile-respite_barriers-0, #caregiver-profile-respite_barriers-6')];
  choices[0].click(); assert.equal(choices[0].checked, true); choices[1].click();
  assert.equal(choices[0].checked, false); assert.equal(choices[1].checked, true);
  f.dom.window.close();
});
test('stale load from prior owner cannot disclose answers after clear and new load', async () => {
  let resolveOld; let n = 0;
  const f = fixture(() => ++n === 1 ? new Promise(resolve => { resolveOld = resolve; }) : response(200, packet({ first_name: 'Current owner' })));
  const old = f.editor.load(); f.changeOwner(); await f.editor.load();
  resolveOld(response(200, packet({ first_name: 'OLD PRIVATE ANSWER' }))); await old;
  assert.equal(f.root.querySelector('#caregiver-profile-first_name').value, 'Current owner');
  assert.doesNotMatch(f.root.innerHTML, /OLD PRIVATE/);
  f.dom.window.close();
});
test('stale save acknowledgement never reloads or repopulates a signed-out owner', async () => {
  let resolveWrite;
  const f = fixture((url, options) => options.method === 'POST' ? new Promise(resolve => { resolveWrite = resolve; }) : response(200, packet()));
  await f.editor.load(); f.input('care_challenge', 'PRIVATE UNSAVED'); f.submit(); f.changeOwner();
  resolveWrite(response(200, { ok: true, revision: 1 })); await settle();
  assert.equal(f.root.innerHTML, ''); assert.equal(f.root.hidden, true); assert.equal(f.requests.length, 2);
  f.dom.window.close();
});
test('conflict locks writes until explicit reload, without overwriting or automatic retry', async () => {
  let n = 0;
  const f = fixture((url, opts) => opts.method === 'POST' ? response(409, { ok: false }) : response(200, packet({ first_name: ++n === 1 ? 'Initial' : 'Concurrent saved' }, n)));
  await f.editor.load(); f.input('first_name', 'Unsaved'); f.submit(); await settle();
  assert.match(f.root.textContent, /changed elsewhere/); assert.equal(f.root.querySelector('button[type=submit]').disabled, true);
  f.submit(); await settle(); assert.equal(f.requests.filter(x => x.method === 'POST').length, 1);
  f.root.querySelector('button[type=button]').click(); await settle();
  assert.equal(f.root.querySelector('#caregiver-profile-first_name').value, 'Concurrent saved');
  f.dom.window.close();
});
test('unknown save acknowledgement holds write until owner GET reconciles a committed save', async () => {
  let n = 0;
  const f = fixture((url, opts) => {
    if (opts.method === 'POST') throw new Error('synthetic lost acknowledgment');
    return response(200, packet({ preferred_name: ++n === 1 ? '' : 'Saved despite loss' }, n - 1));
  });
  await f.editor.load(); f.input('preferred_name', 'Saved despite loss'); f.submit(); await settle();
  assert.match(f.root.textContent, /Save could not be confirmed/);
  f.submit(); await settle(); assert.equal(f.requests.filter(x => x.method === 'POST').length, 1);
  f.root.querySelector('button[type=button]').click(); await settle();
  assert.equal(f.root.querySelector('#caregiver-profile-preferred_name').value, 'Saved despite loss');
  assert.equal(f.root.querySelector('button[type=submit]').disabled, true);
  f.dom.window.close();
});
test('feature-off and unauthorized reads clear the editor without exposing earlier answers', async () => {
  for (const status of [404, 401, 403]) {
    let n = 0; const f = fixture(() => ++n === 1 ? response(200, packet()) : response(status, { ok: false }));
    await f.editor.load(); await f.editor.load();
    assert.equal(f.editor.available, false); assert.equal(f.root.innerHTML, ''); assert.equal(f.root.hidden, true);
    f.dom.window.close();
  }
});
