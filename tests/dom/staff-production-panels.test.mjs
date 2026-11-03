// [pc2-codex-42] Local actual-HTML DOM controls; no browser, layout, network or customer state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../../staff.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../staff.js', import.meta.url), 'utf8');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const panels = block('// Staff section disclosures:', '// End staff section disclosures.');
const team = block('let staffMe = null;', 'function renderStaffTeam()');
const followups = block('async function loadFollowups()', 'async function resolveFollowup(');
const events = block('function eventsCountText(', 'function renderNewEventForm()');
const wait = () => new Promise(resolve => setTimeout(resolve, 0));
const me = { email: 'synthetic.staff@example.invalid', role: 'staff', status: 'active' };
const ids = ['needsAttentionPanel', 'eventsPanel', 'grantsPanel', 'wellnessPanel', 'peopleManagementPanel', 'recentChangesPanel', 'siteContentPanel'];

async function page({ origin = 'https://fixture.example.invalid', saved = {}, width = 1280, queue = [{ id: 1, caregiver_id: 'cg_fixture', caregiver_first_name: 'Fictional', caregiver_last_name: 'Example', kind: 'support_request', detail: 'Synthetic request', status: 'open' }] } = {}) {
  const dom = new JSDOM(html, { url: origin + '/staff', runScripts: 'outside-only' });
  const w = dom.window;
  Object.defineProperty(w, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(w.crypto, 'subtle', { value: webcrypto.subtle, configurable: true });
  w.TextEncoder = TextEncoder;
  for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
  const calls = [];
  let currentMe = me, identityFails = false, listFails = false;
  w.fetch = async (url, options) => {
    assert.equal(options?.method ?? 'GET', 'GET', 'panel test must never mutate a service');
    calls.push(url);
    if (listFails && (url === '/api/staff/queue' || url === '/api/staff/events')) throw Error('synthetic unavailable');
    if (url === '/api/staff/me') return { ok: !identityFails, json: async () => identityFails ? { ok: false } : { ok: true, me: currentMe } };
    if (url === '/api/staff/team') return { ok: true, json: async () => ({ ok: true, team: [] }) };
    if (url === '/api/staff/queue') return { ok: true, json: async () => ({ ok: true, queue }) };
    if (url === '/api/staff/events') return { ok: true, json: async () => ({ ok: true, events: [{ id: 'ev_fixture', title: 'Fictional event', starts_at: '2026-11-10 10:00', publish_state: 'draft', registered_count: 0 }] }) };
    throw Error('Unexpected fixture route: ' + url);
  };
  w.console.error = () => {};
  w.escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  w.renderStaffTeam = () => {};
  w.currentEventId = null;
  w.eval(panels + '\n' + team + '\n' + followups + '\n' + events);
  // Match real page startup: register before DOMContentLoaded; do not flush parser toggles.
  await new Promise(resolve => w.document.addEventListener('DOMContentLoaded', () => {
    w.initStaffPanels();
    resolve();
  }, { once: true }));
  const storage = () => Object.fromEntries(Object.keys(w.localStorage).map(key => [key, w.localStorage.getItem(key)]));
  return { w, dom, calls, storage, setIdentity: value => { currentMe = value; }, failIdentity: () => { identityFails = true; }, failLists: () => { listFails = true; }, close: () => w.close() };
}

for (const width of [1280, 390]) test(`actual summary clicks, synthetic rows and same-person reload (${width}px DOM context; no layout claim)`, async () => {
  const p = await page({ width });
  try {
    await p.w.loadStaffTeam(); await wait();
    await p.w.loadFollowups(); await p.w.loadEvents(); await wait();
    for (const [id, label, rowSelector] of [['needsAttentionPanel', 'Alerts', '#needsAttentionBody tr'], ['eventsPanel', 'Events', '#upcomingEventsBody tr']]) {
      const panel = p.w.document.getElementById(id), heading = panel.querySelector('summary h4');
      assert.ok(heading.textContent.includes(label));
      assert.equal(panel.open, true);
      assert.ok(panel.querySelector(rowSelector).textContent.includes('Fictional'));
      const before = p.calls.length;
      // Actual DOM click/default activation on the visible heading, not a stub assigning open.
      heading.click(); await wait(); assert.equal(panel.open, false, 'summary default activation closes the disclosure');
      heading.click(); await wait(); assert.equal(panel.open, true, 'same heading reopens it');
      heading.click(); await wait(); assert.equal(panel.open, false);
      assert.equal(p.calls.length, before, 'clicking a summary never makes an API call');
    }
    const saved = p.storage();
    assert.equal(Object.keys(saved).length, 1);
    assert.ok(!Object.keys(saved)[0].includes(me.email));
    const choices = JSON.parse(Object.values(saved)[0]);
    assert.equal(choices.needsAttentionPanel, false); assert.equal(choices.eventsPanel, false);
    const reloaded = await page({ saved, width });
    try {
      await reloaded.w.loadStaffTeam(); await wait();
      await reloaded.w.loadFollowups(); await reloaded.w.loadEvents(); await wait();
      assert.equal(reloaded.w.document.getElementById('needsAttentionPanel').open, false, 'saved closed wins even with open requests');
      assert.equal(reloaded.w.document.getElementById('eventsPanel').open, false);
    } finally { reloaded.close(); }
  } finally { p.close(); }
});

test('all main sections toggle via real summaries; controls remain in their panel bodies and Assistant is excluded', async () => {
  const p = await page();
  try {
    for (const id of ids) {
      const panel = p.w.document.getElementById(id); assert.equal(panel.tagName, 'DETAILS');
      const summary = panel.querySelector(':scope > summary'); assert.ok(summary);
      assert.equal(summary.querySelectorAll('button,input,select').length, 0);
      const initial = panel.open; summary.click(); await wait(); assert.equal(panel.open, !initial);
      summary.click(); await wait(); assert.equal(panel.open, initial);
    }
    for (const id of ['newEventToggleBtn','grantsStatusFilter','refreshWellnessBtn','needsAttentionBody','upcomingEventsBody','attendanceContent']) assert.equal(p.w.document.querySelectorAll('#' + id).length, 1);
    const attendance = p.w.document.getElementById('attendancePanel');
    assert.equal(attendance.tagName, 'DETAILS'); assert.ok(attendance.classList.contains('d-none-mt-24'));
    attendance.style.display = 'block'; attendance.querySelector('summary').click(); await wait(); assert.equal(attendance.open, false);
    assert.equal(p.w.document.getElementById('staffAssistantPanel').hidden, true);
    const permitted = JSON.parse(panels.match(/Object\.freeze\((\[[^\]]+\])/)[1].replaceAll("'", '"')); assert.ok(!permitted.includes('staffAssistantPanel')); assert.ok(!permitted.includes('attendancePanel')); assert.ok(!permitted.includes('staffHelpPanel'));
    assert.equal(p.calls.length, 0);
  } finally { p.close(); }
});

test('preferences are separated by verified person and origin; malformed/extra fields never become content storage', async () => {
  const p = await page();
  try {
    await p.w.loadStaffTeam(); await wait(); p.w.document.querySelector('#eventsPanel summary').click(); await wait();
    const saved = p.storage();
    for (const different of [{ identity: { ...me, email: 'other.staff@example.invalid' } }, { origin: 'https://other.example.invalid' }]) {
      const q = await page({ saved, origin: different.origin });
      try { if (different.identity) q.setIdentity(different.identity); await q.w.loadStaffTeam(); await wait(); assert.equal(q.w.document.getElementById('eventsPanel').open, true); } finally { q.close(); }
    }
    const key = Object.keys(saved)[0]; const q = await page({ saved: { [key]: JSON.stringify({ eventsPanel: false, staffAssistantPanel: false, arbitrary: 'no content', needsAttentionPanel: 'false' }) } });
    try { await q.w.loadStaffTeam(); await wait(); q.w.document.querySelector('#grantsPanel summary').click(); await wait(); const values = JSON.parse(q.storage()[key]); assert.ok(!('arbitrary' in values)); assert.ok(!('staffAssistantPanel' in values)); assert.ok(!('needsAttentionPanel' in values)); assert.equal(values.eventsPanel, false); } finally { q.close(); }
  } finally { p.close(); }
});

test("failed identity refresh revokes writes and in-flight hashes without deleting the previous person's preferences", async () => {
  const p = await page();
  try {
    await p.w.loadStaffTeam(); await wait(); p.w.document.querySelector('#eventsPanel summary').click(); await wait();
    const before = p.storage(); p.failIdentity(); await p.w.loadStaffTeam();
    p.w.document.querySelector('#grantsPanel summary').click(); await wait(); assert.deepEqual(p.storage(), before);
    let release; const held = new Promise(resolve => { release = resolve; });
    Object.defineProperty(p.w.crypto, 'subtle', { value: { digest: () => held }, configurable: true });
    const pending = p.w.rememberStaffPanelsFor({ ...me, email: 'pending@example.invalid' }); p.w.forgetStaffPanelIdentity(); release(new Uint8Array(32).buffer); await pending;
    p.w.document.querySelector('#wellnessPanel summary').click(); await wait(); assert.deepEqual(p.storage(), before);
  } finally { p.close(); }
});

test('choices made before identity arrives are kept; service/unknown identity and throwing storage are safe', async () => {
  const p = await page();
  try {
    p.w.document.querySelector('#eventsPanel summary').click(); await wait(); assert.deepEqual(p.storage(), {});
    await p.w.loadStaffTeam(); await wait(); assert.equal(JSON.parse(Object.values(p.storage())[0]).eventsPanel, false);
    p.w.forgetStaffPanelIdentity(); await p.w.rememberStaffPanelsFor({ email: 'service@example.invalid' }); p.w.document.querySelector('#grantsPanel summary').click(); await wait();
    assert.equal(Object.keys(p.storage()).length, 1, 'service actor gets no preference namespace');
    Object.defineProperty(p.w, 'localStorage', { get() { throw Error('blocked'); } });
    await p.w.rememberStaffPanelsFor(me); p.w.document.querySelector('#eventsPanel summary').click(); await wait();
  } finally { p.close(); }
});

test('empty Alerts default closes once without persistence; list failures show uncertainty instead of stale rows', async () => {
  const p = await page({ queue: [] });
  try {
    await p.w.loadFollowups(); await wait(); assert.equal(p.w.document.getElementById('needsAttentionPanel').open, false); assert.deepEqual(p.storage(), {});
    p.w.document.querySelector('#needsAttentionPanel summary').click(); await wait(); await p.w.loadFollowups(); assert.equal(p.w.document.getElementById('needsAttentionPanel').open, true, 'refresh does not reapply default');
    p.failLists(); await p.w.loadFollowups(); await p.w.loadEvents();
    assert.equal(p.w.document.getElementById('needsAttentionCount').textContent, '(could not load)'); assert.ok(p.w.document.querySelector('#needsAttentionBody [role=alert]'));
    assert.equal(p.w.document.getElementById('eventsCount').textContent, '(could not load)'); assert.ok(p.w.document.querySelector('#upcomingEventsBody [role=alert]'));
  } finally { p.close(); }
});


test('cold DOMContentLoaded: parser toggles do not override first empty Alerts or saved closed choices', async () => {
  const empty = await page({ queue: [] });
  try {
    await empty.w.loadStaffTeam();
    await empty.w.loadFollowups();
    await wait(); await wait();
    assert.equal(empty.w.document.getElementById('needsAttentionPanel').open, false);
    assert.deepEqual(empty.storage(), {}, 'markup and empty defaults never become user preferences');
  } finally { empty.close(); }

  const first = await page(); let saved;
  try {
    await first.w.loadStaffTeam();
    first.w.document.querySelector('#needsAttentionPanel summary h4').click();
    await wait(); saved = first.storage();
    assert.equal(JSON.parse(Object.values(saved)[0]).needsAttentionPanel, false);
  } finally { first.close(); }
  const returning = await page({ saved });
  try {
    // Keep the actual parse/init schedule. Identity and queue completion can race.
    await Promise.all([returning.w.loadFollowups(), returning.w.loadStaffTeam()]);
    await wait(); await wait();
    assert.equal(returning.w.document.getElementById('needsAttentionPanel').open, false);
    assert.deepEqual(returning.storage(), saved, 'startup never overwrites the returning choice');
  } finally { returning.close(); }
});

test('programmatic and canceled activations do not persist; genuine early summary activation still does', async () => {
  const p = await page();
  try {
    await p.w.loadStaffTeam(); await wait();
    const panel = p.w.document.getElementById('eventsPanel');
    panel.open = false; await wait(); assert.deepEqual(p.storage(), {});
    panel.open = true; await wait();
    panel.querySelector('summary').addEventListener('click', event => event.preventDefault(), { once: true });
    panel.querySelector('summary h4').click(); await wait();
    assert.equal(panel.open, true); assert.deepEqual(p.storage(), {});
  } finally { p.close(); }
  const early = await page();
  try {
    early.w.document.querySelector('#needsAttentionPanel summary h4').click();
    await early.w.loadFollowups();
    await early.w.loadStaffTeam(); await wait();
    assert.equal(early.w.document.getElementById('needsAttentionPanel').open, false);
    assert.equal(JSON.parse(Object.values(early.storage())[0]).needsAttentionPanel, false);
  } finally { early.close(); }
});
