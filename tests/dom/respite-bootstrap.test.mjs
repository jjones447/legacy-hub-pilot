import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindRespitePage } from '../../portal-respite-bootstrap.mjs';
import { readRespiteAcknowledgments } from '../../functions/_lib/respite-acknowledgments.mjs';

const proof = 'a'.repeat(64);
const acknowledgment = 'b'.repeat(64);
const qualified = {ok: true, principal: 'fictional-owner', proof, visible: true};
const view = {
  ok: true, visible: true, requests: [], participants: [{id: 'p', revision: 1, name: 'Fictional participant'}],
  dates: [{id: 'session', title: 'Fictional session', starts_at: '2999-01-01T15:00:00Z'}],
  caregiver: {name: 'Fictional owner', email: 'fictional@example.invalid', phone: '414-555-0100'},
  acknowledgments: readRespiteAcknowledgments(), acknowledgment_proof: acknowledgment,
  participant_questions: [],
};

function setup(t, markup, hash = '') {
  const dom = new JSDOM(markup, {url: 'https://example.invalid/portal.html' + hash});
  const win = dom.window;
  win.portalFunctionalOwner = qualified.principal;
  const state = {session: qualified, calls: []};
  win.fetch = async (url, options) => {
    state.calls.push({url, options});
    if (url.endsWith('/session')) return Response.json(state.session);
    if (options.method === 'POST') return state.post(options);
    return Response.json(view);
  };
  const stop = bindRespitePage(win);
  t.after(() => { stop(); win.close(); });
  return {win, state, get: id => win.document.getElementById(id)};
}

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Respite view did not reach the expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('dashboard reads the form on tab selection and clears it before a late POST returns', async t => {
  const {win, get, state} = setup(t, `
    <nav><a id="portalDashboardTab" aria-current="page">Dashboard</a>
      <a id="portalRespiteTab" href="#respite" hidden>Respite Registration</a></nav>
    <button id="portalLogoutBtn">Sign out</button>
    <div id="portalDashboardContent">Dashboard content</div><section id="respite" hidden></section>
  `);
  await until(() => !get('portalRespiteTab').hidden);
  assert.ok(state.calls.every(({url}) => url.endsWith('/session')));
  win.location.hash = 'respite';
  await until(() => get('respite').querySelector('form') && !get('respite').hidden);
  assert.equal(get('portalDashboardContent').hidden, true);
  assert.equal(get('portalRespiteTab').getAttribute('aria-current'), 'page');

  let complete;
  state.post = () => new Promise(resolve => { complete = resolve; });
  const form = get('respite').querySelector('form');
  Array.from(form.querySelectorAll('select')).forEach((select, index) => { select.value = ['p', 'no', 'yes'][index]; });
  form.querySelectorAll('input[type="checkbox"]').forEach(box => { box.checked = true; });
  form.requestSubmit();
  await until(() => complete);
  const write = state.calls.find(({options}) => options.method === 'POST');
  assert.equal(write.options.headers['X-Respite-Session'], proof);
  assert.equal(write.options.headers['X-Respite-Acknowledgments'], acknowledgment);
  win.portalRespiteInvalidate();
  complete(Response.json({ok: true, id: 'pending', status: 'pending'}));
  await Promise.resolve();
  assert.equal(get('respite').textContent, '');
  assert.equal(get('portalRespiteTab').hidden, true);
  assert.equal(get('portalDashboardContent').hidden, false);
});

test('Profile only requests visibility and hides the link when the session loses eligibility', async t => {
  const {win, get, state} = setup(t, '<a id="portalRespiteTab" href="portal.html#respite" hidden>Respite</a>');
  await until(() => !get('portalRespiteTab').hidden);
  state.session = {...qualified, visible: false};
  win.dispatchEvent(new win.Event('focus'));
  await until(() => get('portalRespiteTab').hidden);
  assert.ok(state.calls.every(({url}) => url.endsWith('/session')));
});
