import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('app.js');
const source = app.slice(0, app.indexOf('/* ---------- Resource hub:'));
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function fixture({ storageFailure, fetchImpl } = {}) {
  const regions = Object.fromEntries(['[data-intake-success]', '[data-intake-routing]', '[data-intake-error]', '[type="submit"]', '[data-membership-pending]']
    .map(key => [key, { style: { display: 'none' }, hidden: true, disabled: false, textContent: '', focusCount: 0,
      focus() { this.focusCount++; } }]));
  const form = { id: 'membershipForm', querySelector: key => regions[key] };
  const modal = { classList: { add() {}, remove() {} } };
  const inputs = { memName: { value: 'Fictional Person' }, memEmail: { value: 'fictional@example.invalid' },
    memCaringFor: { value: 'Family' }, memNote: { value: 'Fictional test only' } };
  const store = new Map(), calls = [], timers = new Map();
  let timerSerial = 0;
  const context = {
    document: { getElementById: id => id === 'membershipForm' ? form : id === 'membershipModal' ? modal : inputs[id] },
    crypto: { randomUUID: () => 'fictional-membership-ref' },
    sessionStorage: {
      getItem(key) { if (storageFailure === 'get') throw new Error('SecurityError'); return store.get(key); },
      setItem(key, value) { if (storageFailure === 'set') throw new Error('QuotaExceededError'); store.set(key, value); }
    },
    setTimeout(fn, ms) { const id = ++timerSerial; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { calls.push({ url, payload: JSON.parse(options.body) }); return fetchImpl?.(url, options) ?? Promise.resolve(response(201, { ok: true })); }
  };
  vm.runInNewContext(source, context);
  return { context, form, regions, calls, store, timers, inputs,
    submit: () => context.submitMembership({ preventDefault() {} }),
    expire() { const scheduled = [...timers.values()]; timers.clear(); for (const { fn, ms } of scheduled) { assert.equal(ms, 20000); fn(); } }
  };
}

test('membership save reveals the existing secure portal path, focuses confirmation and never sends login mail', async () => {
  const f = fixture();
  f.submit();
  assert.equal(f.regions['[data-membership-pending]'].hidden, false);
  assert.equal(f.form.ariaBusy, 'true');
  assert.equal(f.regions['[type="submit"]'].disabled, true);
  await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/intake');
  assert.equal(f.calls[0].payload.kind, 'membership');
  assert.equal(f.regions['[data-intake-success]'].style.display, 'block');
  assert.match(f.regions['[data-intake-success]'].textContent, /request is saved/);
  assert.equal(f.regions['[data-intake-success]'].focusCount, 1);
  assert.equal(f.regions['[data-intake-routing]'].style.display, 'block');
  assert.equal(f.regions['[data-membership-pending]'].hidden, true);
  assert.equal(f.form.ariaBusy, 'false');
  assert.equal(f.timers.size, 0);
  f.context.closeMembership(); f.context.openMembership();
  f.inputs.memEmail.value = 'another@example.invalid';
  f.submit();
  await settle();
  assert.equal(f.calls.length, 1, 'acknowledged save cannot become a new intake or login request');
  assert.equal(f.regions['[type="submit"]'].disabled, true);
});

test('membership duplicate acknowledgment describes the earlier request rather than claiming edited details were saved', async () => {
  const f = fixture({ fetchImpl: async () => response(200, { ok: true, duplicate: true }) });
  f.submit(); await settle();
  assert.match(f.regions['[data-intake-success]'].textContent, /already received from this browser session/);
  assert.match(f.regions['[data-intake-success]'].textContent, /email used for that request/);
  assert.equal(f.regions['[data-intake-routing]'].style.display, 'block');
  assert.equal(f.calls.length, 1);
});

test('membership storage read/write errors are visible before any request; no memory-only replacement key', async () => {
  for (const storageFailure of ['get', 'set']) {
    const f = fixture({ storageFailure });
    assert.doesNotThrow(f.submit);
    await settle();
    assert.equal(f.calls.length, 0);
    assert.equal(f.timers.size, 0);
    assert.match(f.regions['[data-intake-error]'].textContent, /has not been sent/);
    assert.equal(f.regions['[data-intake-error]'].focusCount, 1);
    assert.equal(f.regions['[data-intake-routing]'].style.display, 'none');
    assert.equal(f.regions['[type="submit"]'].disabled, false);
  }
});

test('a definite membership rejection shows error and preserves the key for an explicit corrected submission', async () => {
  let status = 400;
  const f = fixture({ fetchImpl: async () => response(status, { ok: status === 201 }) });
  f.submit(); await settle();
  assert.equal(f.regions['[data-intake-error]'].style.display, 'block');
  assert.equal(f.regions['[data-intake-routing]'].style.display, 'none');
  assert.equal(f.regions['[type="submit"]'].disabled, false);
  status = 201;
  f.submit(); await settle();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].payload.external_ref, f.calls[1].payload.external_ref);
});

test('non-JSON refusal is visible, while network/server/malformed success outcomes do not invite a replay', async () => {
  const modes = [
    { uncertain: false, fetchImpl: async () => ({ status: 403, ok: false, json: async () => { throw new Error('not JSON'); } }) },
    { uncertain: true, fetchImpl: async () => { throw new Error('connection lost'); } },
    { uncertain: true, fetchImpl: () => { throw new Error('synchronous fetch failure'); } },
    { uncertain: true, fetchImpl: async () => response(500, { ok: false }) },
    { uncertain: true, fetchImpl: async () => response(408, { ok: false }) },
    { uncertain: true, fetchImpl: async () => response(409, { ok: false }) },
    { uncertain: true, fetchImpl: async () => response(200, {}) }
  ];
  for (const mode of modes) {
    const f = fixture(mode);
    f.submit(); await settle();
    assert.equal(f.regions['[data-intake-error]'].style.display, 'block');
    assert.equal(f.regions['[data-intake-routing]'].style.display, 'none');
    assert.equal(f.regions['[type="submit"]'].disabled, mode.uncertain);
    assert.equal(f.timers.size, 0);
    if (mode.uncertain) {
      assert.match(f.regions['[data-intake-error]'].textContent, /can't confirm/);
      f.context.closeMembership(); f.context.openMembership(); f.submit(); await settle();
      assert.equal(f.calls.length, 1);
    }
  }
});

test('a stalled membership request becomes visibly uncertain without cancellation or replay; late acknowledgment resolves it', async () => {
  let resolve;
  const f = fixture({ fetchImpl: () => new Promise(done => { resolve = done; }) });
  f.submit(); f.submit(); await settle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.regions['[data-membership-pending]'].hidden, false);
  f.expire();
  assert.match(f.regions['[data-intake-error]'].textContent, /don't submit it again/);
  assert.equal(f.regions['[data-membership-pending]'].hidden, true);
  assert.equal(f.regions['[data-intake-routing]'].style.display, 'none');
  f.context.closeMembership(); f.context.openMembership(); f.submit(); await settle();
  assert.equal(f.calls.length, 1);
  resolve(response(201, { ok: true })); await settle();
  assert.equal(f.regions['[data-intake-success]'].style.display, 'block');
  assert.equal(f.regions['[data-intake-error]'].style.display, 'none');
  assert.equal(f.regions['[data-intake-routing]'].style.display, 'block');
  assert.equal(f.calls.length, 1);
});

test('all generated membership forms offer a same-origin continuation without email/token transfer or automatic login', () => {
  for (const path of ['templates/_membership-modal.html.j2', 'index.html', 'programs.html', 'donate.html', 'wellness-passport.html']) {
    const html = read(path);
    const form = html.match(/<form id="membershipForm"[\s\S]*?<\/form>/)?.[0];
    assert.ok(form);
    assert.match(form, /data-membership-pending[^>]*hidden/);
    assert.match(form, /data-intake-success[^>]*tabindex="-1"/);
    assert.match(form, /data-intake-error[^>]*tabindex="-1"/);
    assert.match(form, /data-intake-routing>[\s\S]*href="\/portal"/);
    assert.match(form, /does not sign you in or send a sign-in email/);
    assert.doesNotMatch(form, /href="\/portal[?#]/);
  }
  const membership = source.slice(source.indexOf('function submitMembership'), source.indexOf('/* ---------- Virtual support group:'));
  assert.doesNotMatch(membership, /portal\/login|portal_session|location\.(?:assign|href)|localStorage/);
});

test('a NEW saved membership hands the email to the portal via sessionStorage (never the URL) and navigates to /portal', async () => {
  const assigned = [];
  const f = fixture();
  f.context.window = { location: { assign: url => assigned.push(url) } };
  f.submit();
  await settle();
  assert.deepEqual(assigned, ['/portal'], 'goes straight to the portal sign-in');
  const handoff = JSON.parse(f.store.get('legacy-portal-handoff'));
  assert.equal(handoff.email, 'fictional@example.invalid');
  assert.ok(!assigned[0].includes('@'), 'the email is not placed in the URL');
  assert.equal(f.calls.length, 1, 'the membership page itself sends no sign-in request');
});

test('no portal hand-off for a duplicate, a refused or an uncertain membership save', async () => {
  for (const fetchImpl of [
    () => Promise.resolve(response(200, { ok: true, duplicate: true })),
    () => Promise.resolve(response(400, { ok: false, error: 'bad' })),
    () => Promise.resolve(response(503, { ok: false })),
  ]) {
    const assigned = [];
    const f = fixture({ fetchImpl });
    f.context.window = { location: { assign: url => assigned.push(url) } };
    f.submit();
    await settle();
    assert.deepEqual(assigned, []);
    assert.equal(f.store.get('legacy-portal-handoff'), undefined);
  }
});

// Portal-side slice: the one-time hand-off helpers plus the portal sign-in functions.
const between = (start, end) => { const i = app.indexOf(start); const j = app.indexOf(end, i); assert.ok(i >= 0 && j > i, start); return app.slice(i, j); };
const portalSource = between('const PORTAL_HANDOFF_KEY', 'function submitMembership(')
  + between('function continueMembershipHandoff()', 'function submitPortalLogin(')
  + between('function submitPortalLogin(', '\nfunction ', ) ;

test('portal consumes a fresh hand-off once: prefills the email and requests exactly one sign-in link', () => {
  const store = new Map([['legacy-portal-handoff', JSON.stringify({ email: 'fictional@example.invalid', at: 1000 })]]);
  const posted = [];
  const nodes = { loginEmail: { value: '' }, loginStatus: { style: {}, textContent: '', appendChild() {} }, loginBtn: { disabled: false },
    membershipWelcome: { hidden: true } };
  const context = {
    document: { getElementById: id => nodes[id], createElement: () => ({ style: {} }) },
    sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    Date: { now: () => 1000 + 60 * 1000 },
    fetch: (url, options) => { posted.push({ url, body: JSON.parse(options.body) }); return new Promise(() => {}); },
  };
  vm.runInNewContext(portalSource + '\n;globalThis.__handoff = continueMembershipHandoff;', context);
  context.__handoff();
  assert.equal(nodes.loginEmail.value, 'fictional@example.invalid');
  assert.equal(nodes.membershipWelcome.hidden, false);
  assert.deepEqual(posted, [{ url: '/api/portal/login', body: { email: 'fictional@example.invalid' } }]);
  assert.equal(store.has('legacy-portal-handoff'), false, 'the hand-off is one-time');
  context.__handoff();
  assert.equal(posted.length, 1, 'a reload does not request another link');
});

test('a stale or malformed hand-off is discarded without requesting a link', () => {
  for (const raw of [JSON.stringify({ email: 'fictional@example.invalid', at: 0 }), '{not json', JSON.stringify({ email: 'no-at-sign', at: 1000 })]) {
    const store = new Map([['legacy-portal-handoff', raw]]);
    const posted = [];
    const nodes = { loginEmail: { value: '' }, loginStatus: { style: {} }, loginBtn: {}, membershipWelcome: { hidden: true } };
    const context = {
      document: { getElementById: id => nodes[id] },
      sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
      Date: { now: () => 1000 + 11 * 60 * 1000 },
      fetch: (url) => { posted.push(url); return new Promise(() => {}); },
    };
    vm.runInNewContext(portalSource + '\n;globalThis.__handoff = continueMembershipHandoff;', context);
    context.__handoff();
    assert.deepEqual(posted, []);
    assert.equal(nodes.loginEmail.value, '');
    assert.equal(store.has('legacy-portal-handoff'), false);
  }
});
