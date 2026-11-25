import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fixture } from '../helpers/caregiver-profile-fixture.mjs';
const html = readFileSync(new URL('../../staff.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../staff-profile.js', import.meta.url), 'utf8');
const staffSource = readFileSync(new URL('../../staff.js', import.meta.url), 'utf8');
const admin = { email: 'admin@example.invalid', role: 'admin', status: 'active' };
const staff = { email: 'staff@example.invalid', role: 'staff', status: 'active' };
async function page(t) {
  const f = fixture(); t.after(() => f.close());
  await f.call({ method: 'POST', body: { revision: 0, fields: { first_name: '<img src=x onerror=alert(1)>', date_of_birth: '1980-02-29', gender: 'Woman', care_challenge: 'Synthetic support answer' } } });
  const dom = new JSDOM(html, { url: 'https://profile.synthetic.invalid/staff', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window; w.eval(source);
  const detail = w.document.getElementById('staffCaregiverProfile'), summary = w.document.getElementById('staffProfileSummary');
  const requests = []; let actor = staff.email, response;
  const view = w.createStaffProfileViews(detail, summary, { fetch: async (url, options) => {
    requests.push({ url, options }); assert.equal(options.method ?? 'GET', 'GET');
    return response ? response(url) : f.staffCall(url, { actor });
  } });
  function identify(me) { actor = me.email; const token = view.beginIdentity(); view.setIdentity(token, me); }
  identify(staff); view.selectCaregiver('cg_a');
  return { f, w, detail, summary, view, requests, identify, respond: value => { response = value; } };
}
test('actual staff projection and DOM omit restricted values and labels; admin sees only text', async t => {
  const p = await page(t); await p.view.loadDetail();
  assert.match(p.detail.textContent, /Synthetic support answer/);
  assert.doesNotMatch(p.detail.textContent, /1980-02-29|Date of Birth|Woman|describe your gender/);
  assert.equal(p.detail.querySelector('img'), null);
  p.identify(admin); await p.view.loadDetail();
  assert.match(p.detail.textContent, /1980-02-29/); assert.match(p.detail.textContent, /Woman/);
  assert.equal(p.detail.querySelector('img'), null);
  assert.equal(p.w.localStorage.length, 0); assert.equal(p.w.sessionStorage.length, 0);
});
test('current backend role downgrade removes individual restrictions even if UI still remembers admin', async t => {
  const p = await page(t); p.identify(admin); await p.view.loadDetail();
  p.f.raw.exec("UPDATE staff_member SET role='staff' WHERE email='admin@example.invalid'");
  const pending = p.view.loadDetail(); assert.doesNotMatch(p.detail.textContent, /1980-02-29|Woman/);
  await pending; assert.doesNotMatch(p.detail.textContent, /1980-02-29|Date of Birth|Woman/);
});
test('changing selected caregiver invalidates old response and back clears all answers', async t => {
  const p = await page(t); p.identify(admin);
  let resolve; p.respond(() => new Promise(r => { resolve = r; }));
  const pending = p.view.loadDetail(); const old = await p.f.staffCall(undefined, { actor: admin.email });
  p.view.selectCaregiver('cg_b'); resolve(old); await pending;
  assert.doesNotMatch(p.detail.textContent, /1980|Synthetic support answer/);
  p.respond(null); await p.view.loadDetail(); assert.match(p.detail.textContent, /No saved Profile/);
  p.view.clearCaregiver(); assert.equal(p.detail.textContent, ''); assert.equal(p.detail.hidden, true);
});
test('staff identity revalidation clears admin values and rejects pending responses and older identity callbacks', async t => {
  const p = await page(t); p.identify(admin); await p.view.loadDetail();
  let resolve; p.respond(() => new Promise(r => { resolve = r; }));
  const pending = p.view.loadDetail(), old = await p.f.staffCall(undefined, { actor: admin.email });
  const earlier = p.view.beginIdentity(), latest = p.view.beginIdentity();
  p.view.setIdentity(earlier, admin); assert.equal(p.detail.querySelector('button').disabled, true);
  resolve(old); await pending; assert.doesNotMatch(p.detail.textContent, /1980|Woman/);
  p.view.setIdentity(latest, staff); assert.equal(p.detail.querySelector('button').disabled, false);
});
test('summary renders actual suppression as withheld, never zero or raw individual data', async t => {
  const p = await page(t); await p.view.loadSummary();
  assert.match(p.summary.textContent, /Withheld/); assert.doesNotMatch(p.summary.textContent, /1980-02-29|Synthetic support answer|fictional.a/);
  assert.equal(p.summary.querySelectorAll('table caption').length, 4);
  for (const cell of p.summary.querySelectorAll('tbody tr td:last-child')) assert.equal(cell.textContent, 'Withheld');
});
test('denied, missing and failed reloads remove prior individual and aggregate content', async t => {
  const p = await page(t); p.identify(admin);
  for (const status of [401, 403, 404, 500]) {
    p.respond(null); await p.view.loadDetail(); await p.view.loadSummary();
    p.respond(async () => ({ status, redirected: false })); await p.view.loadDetail(); await p.view.loadSummary();
    assert.doesNotMatch(p.detail.textContent, /1980|Woman/); assert.equal(p.summary.querySelector('table'), null);
  }
  p.respond(null); await p.view.loadDetail(); p.w.dispatchEvent(new p.w.Event('pagehide'));
  assert.doesNotMatch(p.detail.textContent, /1980|Woman/); assert.equal(p.detail.querySelector('button').disabled, true);
});
test('actual staff selection and back handlers clear Profile before fetching and mounting the next record', async t => {
  const p = await page(t); const calls = [];
  p.w.staffProfileViews = { clearCaregiver: () => { calls.push('clear'); p.view.clearCaregiver(); }, selectCaregiver: id => { calls.push(id); p.view.selectCaregiver(id); } };
  p.w.eval(staffSource.slice(staffSource.indexOf('function localDateTimeValue('), staffSource.indexOf('function formatContactTime(')));
  p.w.scrollTo = () => {}; p.w.escapeHtml = value => String(value ?? '');
  p.w.fetch = async () => ({ ok: true, json: async () => ({ ok: true, profile: { first_name: 'Synthetic', id: 'cg_b' }, grants: [], registrations: [], followups: [], notes: [] }) });
  const block = staffSource.slice(staffSource.indexOf('// A focused caregiver view'), staffSource.indexOf('function eventsCountText('));
  p.w.eval('let currentCaregiverId = null, currentGrantId = null;\n' + block);
  p.identify(admin); await p.view.loadDetail();
  await p.w.viewCaregiver('cg_b'); assert.deepEqual(calls, ['clear', 'cg_b']);
  p.w.backToStaffDashboard(); assert.deepEqual(calls, ['clear', 'cg_b', 'clear']); assert.equal(p.detail.textContent, '');
});

test('actual staff access refresh clears displayed answers immediately and leaves failed identity disabled', async t => {
  const p = await page(t); p.identify(admin); await p.view.loadDetail();
  p.w.staffProfileViews = p.view; p.w.updatePeopleAddActions = () => {}; p.w.renderStaffTeam = () => {};
  p.w.escapeHtml = value => String(value ?? '');
  p.w.eval(staffSource.slice(staffSource.indexOf('let staffMe = null;'), staffSource.indexOf('function renderStaffTeam()')));
  let settleMe; p.w.fetch = url => url.endsWith('/me') ? new Promise(resolve => { settleMe = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ ok: true, team: [] }) });
  const pending = p.w.loadStaffTeam();
  assert.doesNotMatch(p.detail.textContent, /1980|Woman/); assert.equal(p.detail.querySelector('button').disabled, true);
  settleMe({ ok: false, json: async () => ({ ok: false, error: 'forbidden' }) });
  assert.equal(await pending, false); assert.equal(p.detail.querySelector('button').disabled, true);
});
