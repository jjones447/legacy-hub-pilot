// [pc2-claude-ct-2] Staff console collapsible sections, follow-up wording and lifecycle
// discoverability. Source + synthetic DOM only: no browser, database, provider or hosted call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const html = readFileSync(new URL('../staff.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
const staffRoute = readFileSync(new URL('../functions/api/staff/[[path]].js', import.meta.url), 'utf8');
const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const slice = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} .. ${to}`);
  return source.slice(start, end);
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const PANELS = ['staffHelpPanel', 'needsAttentionPanel', 'eventsPanel', 'grantsPanel', 'wellnessPanel', 'peopleManagementPanel', 'recentChangesPanel', 'siteContentPanel'];
const OPEN_BY_DEFAULT = ['needsAttentionPanel', 'eventsPanel', 'grantsPanel', 'wellnessPanel'];

const STAFF_PANEL_SOURCE_IDS = () => JSON.parse(source.match(/const STAFF_PANEL_IDS = Object\.freeze\((\[[^\]]*\])\)/)[1].replaceAll("'", '"'));

function details(id) {
  const match = html.match(new RegExp(`<details\\b([^>]*\\bid="${id}"[^>]*)>([\\s\\S]*?)</details>`));
  assert.ok(match, `${id} is a native details element`);
  const summary = match[2].match(/^\s*<summary>([\s\S]*?)<\/summary>/);
  assert.ok(summary, `${id} starts with a summary`);
  return { attrs: match[1], body: match[2], summary: summary[1], open: /\bopen(?:\s|=|$)/.test(match[1]) };
}

test('every main Staff section is a native details/summary with preserved IDs, controls and visible counts', () => {
  for (const id of PANELS) {
    const panel = details(id);
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} appears once`);
    assert.doesNotMatch(panel.summary, /<(?:button|select|input|a|textarea)\b/, `${id} summary has no nested interactive control`);
    assert.equal(panel.open, OPEN_BY_DEFAULT.includes(id), `${id} keeps its current default`);
  }
  const owned = {
    needsAttentionPanel: ['needsAttentionBody', 'needsAttentionCount', 'needsAttentionHelp', 'needsAttentionMessage'],
    eventsPanel: ['eventsCount', 'newEventToggleBtn', 'newEventContainer', 'upcomingEventsBody', 'editEventContainer', 'eventLifecycleHelp'],
    grantsPanel: ['grantsCount', 'grantsStatusFilter', 'grantsTableBody', 'grantActionsHelp'],
    wellnessPanel: ['wellnessCount', 'refreshWellnessBtn', 'wellnessCaregiverSearch', 'wellnessCaregivers', 'wellnessRange', 'wellnessChart'],
  };
  for (const [id, children] of Object.entries(owned)) {
    const panel = details(id);
    for (const child of children) {
      assert.match(panel.body, new RegExp(`id="${child}"`), `${child} stays inside ${id}`);
      assert.equal(html.split(`id="${child}"`).length - 1, 1, `${child} appears once`);
    }
    assert.match(panel.summary, /<h4 class="staff-section-heading">[^<]+<\/h4>/, `${id} keeps a visible heading`);
    assert.match(panel.summary, /<span class="staff-section-count[^"]*" id="\w+Count">/, `${id} count is in the summary`);
  }
  for (const id of ['newEventToggleBtn', 'grantsStatusFilter', 'refreshWellnessBtn']) {
    assert.match(source, new RegExp(`getElementById\\('${id}'\\)`), `${id} keeps its listener`);
  }
  assert.match(details('peopleManagementPanel').body, /data-action="search-caregivers"/);
  assert.match(details('needsAttentionPanel').summary, /Needs attention/);
  assert.match(details('eventsPanel').summary, /Upcoming events/);
  assert.match(details('grantsPanel').summary, /Wellness Grants/);
  assert.match(details('wellnessPanel').summary, /Caregiver wellness/);
  // Attendance is a disclosure too, still hidden until an event is chosen (review item 4).
  const attendance = details('attendancePanel');
  assert.match(attendance.attrs, /class="panel staff-section d-none-mt-24"/);
  assert.equal(attendance.open, true);
  assert.match(attendance.summary, /<h4 class="staff-section-heading">👥 Event Attendance<\/h4>/);
  assert.match(attendance.body, /id="attendanceContent"/);
  assert.match(slice('async function loadRegistrations(', '} catch (e)'), /panel\.style\.display = 'block';\n    panel\.open = true;/);
  assert.ok(!STAFF_PANEL_SOURCE_IDS().includes('attendancePanel'), 'the conditional panel is not persisted');
  // The assistant keeps its own disclosure.
  assert.match(html, /<section id="staffAssistantPanel"[^>]* hidden>/);
});

// ---- Persistence harness: real module source, fake details, fake storage, real WebCrypto.
function panelNode(id, open) {
  const node = { id, state: Boolean(open), listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  Object.defineProperty(node, 'open', {
    get() { return this.state; },
    set(value) {
      const next = Boolean(value);
      if (next === this.state) return;
      this.state = next;
      queueMicrotask(() => this.listeners.toggle?.()); // browsers fire toggle asynchronously
    },
  });
  return node;
}

function memoryStorage() {
  const map = new Map();
  return { map, writes: 0, getItem: key => (map.has(key) ? map.get(key) : null), setItem(key, value) { this.writes++; map.set(key, String(value)); } };
}

function panelPage({ storage = memoryStorage(), origin = 'https://staging.example.invalid', windowOverrides = {} } = {}) {
  const nodes = Object.fromEntries(PANELS.map(id => [id, panelNode(id, details(id).open)]));
  const window = { localStorage: storage, crypto: globalThis.crypto, location: { origin } };
  Object.defineProperties(window, Object.getOwnPropertyDescriptors(windowOverrides));
  const context = createContext({
    document: { getElementById: id => nodes[id] ?? null }, window, TextEncoder, queueMicrotask,
    fetch() { throw new Error('collapsing or remembering a section must not call an API'); },
  });
  runInContext(slice('// Staff section disclosures:', '// End staff section disclosures.'), context);
  context.initStaffPanels();
  const user = async (id) => { nodes[id].open = !nodes[id].open; await flush(); };
  return { context, nodes, storage, user };
}

const openState = nodes => Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, node.open]));

test('Needs attention opens only when the first load has open items; later reloads never re-toggle it', async () => {
  const empty = panelPage();
  empty.context.noteNeedsAttentionActionable(false);
  await flush();
  assert.equal(empty.nodes.needsAttentionPanel.open, false);
  empty.context.noteNeedsAttentionActionable(true);
  await flush();
  assert.equal(empty.nodes.needsAttentionPanel.open, false, 'a reload after Mark complete does not reopen');
  for (const id of PANELS.filter(id => id !== 'needsAttentionPanel')) assert.equal(empty.nodes[id].open, details(id).open);

  const busy = panelPage();
  busy.context.noteNeedsAttentionActionable(true);
  await flush();
  assert.equal(busy.nodes.needsAttentionPanel.open, true);
  assert.equal(busy.storage.writes, 0, 'defaults are never persisted');
});

test('choices persist per signed-in person and origin, as booleans only, without the email in the key', async () => {
  const storage = memoryStorage();
  const a = panelPage({ storage });
  await a.user('eventsPanel');
  assert.equal(storage.writes, 0, 'nothing is stored before the person is known');
  await a.context.rememberStaffPanelsFor({ email: 'Person.A@Example.invalid', role: 'staff' });
  await a.user('recentChangesPanel');
  a.context.noteNeedsAttentionActionable(false);
  await flush();
  assert.equal(storage.map.size, 1);
  const [[key, raw]] = [...storage.map];
  assert.match(key, /^staff-console-panels-v1:https:\/\/staging\.example\.invalid:[0-9a-f]{32}$/);
  assert.doesNotMatch(key, /person|example\.invalid:.*@/i);
  assert.deepEqual(JSON.parse(raw), { eventsPanel: false, recentChangesPanel: true }, 'only touched booleans; the automatic Needs attention default is not saved');

  const again = panelPage({ storage });
  again.context.noteNeedsAttentionActionable(true);
  await again.context.rememberStaffPanelsFor({ email: 'person.a@example.invalid' });
  await flush();
  assert.equal(again.nodes.eventsPanel.open, false);
  assert.equal(again.nodes.recentChangesPanel.open, true);
  assert.equal(again.nodes.needsAttentionPanel.open, true);

  const other = panelPage({ storage });
  await other.context.rememberStaffPanelsFor({ email: 'person.b@example.invalid' });
  await flush();
  assert.deepEqual(openState(other.nodes), Object.fromEntries(PANELS.map(id => [id, details(id).open])), 'another person on this device gets defaults');
  await other.user('grantsPanel');
  assert.equal(storage.map.size, 2);
  assert.deepEqual(JSON.parse(storage.map.get(key)), { eventsPanel: false, recentChangesPanel: true }, 'person A is untouched');

  const elsewhere = panelPage({ storage, origin: 'https://www.example.invalid' });
  await elsewhere.context.rememberStaffPanelsFor({ email: 'person.a@example.invalid' });
  await flush();
  assert.equal(elsewhere.nodes.eventsPanel.open, true, 'a different origin does not reuse the choice');
});

test('a saved Needs attention choice wins over the automatic default', async () => {
  const storage = memoryStorage();
  const first = panelPage({ storage });
  await first.context.rememberStaffPanelsFor({ email: 'reader@example.invalid' });
  await first.user('needsAttentionPanel');
  const later = panelPage({ storage });
  await later.context.rememberStaffPanelsFor({ email: 'reader@example.invalid' });
  later.context.noteNeedsAttentionActionable(true);
  await flush();
  assert.equal(later.nodes.needsAttentionPanel.open, false);
});

test('storage failures, missing identity and service actors fall back to defaults without throwing', async () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  const blocked = panelPage({ storage: throwing });
  await blocked.context.rememberStaffPanelsFor({ email: 'reader@example.invalid' });
  await blocked.user('eventsPanel');
  assert.equal(blocked.nodes.eventsPanel.open, false, 'the in-page choice still applies');

  const getterThrows = panelPage({ windowOverrides: { get localStorage() { throw new Error('SecurityError'); } } });
  await getterThrows.context.rememberStaffPanelsFor({ email: 'reader@example.invalid' });
  await getterThrows.user('siteContentPanel');
  assert.equal(getterThrows.nodes.siteContentPanel.open, true);

  for (const me of [null, {}, { email: 'anonymous_staff' }, { email: 'service-token' }]) {
    const page = panelPage();
    await page.context.rememberStaffPanelsFor(me);
    await page.user('grantsPanel');
    assert.equal(page.storage.writes, 0, `no persistence for ${JSON.stringify(me)}`);
  }

  const noCrypto = panelPage({ windowOverrides: { crypto: undefined } });
  await noCrypto.context.rememberStaffPanelsFor({ email: 'reader@example.invalid' });
  await noCrypto.user('grantsPanel');
  assert.equal(noCrypto.storage.writes, 0);
});

test('a failed identity refresh stops writing the previous person\'s choices and cancels a pending identity (review P2-2)', async () => {
  const storage = memoryStorage();
  const page = panelPage({ storage });
  await page.context.rememberStaffPanelsFor({ email: 'person.a@example.invalid', role: 'staff' });
  await page.user('eventsPanel');
  const written = storage.writes;
  assert.equal(written, 1);
  const saved = [...storage.map];
  page.context.forgetStaffPanelIdentity();
  await page.user('grantsPanel');
  await page.user('eventsPanel');
  assert.equal(storage.writes, written, 'unknown identity writes nothing');
  assert.deepEqual([...storage.map], saved, "the previous person's stored choices are kept, not deleted");
  // A hash still in flight when identity is lost never installs a key afterwards.
  const pending = page.context.rememberStaffPanelsFor({ email: 'person.b@example.invalid', role: 'staff' });
  page.context.forgetStaffPanelIdentity();
  await pending;
  await page.user('wellnessPanel');
  assert.equal(storage.writes, written);
});

test('loadStaffTeam revokes the preference identity only when /me cannot be established (review P2-2)', async () => {
  const run = async (meOk, teamOk) => {
    const forgot = []; const remembered = [];
    const context = createContext({
      document: { getElementById: () => ({ innerHTML: '' }) }, escapeHtml,
      fetch: async (url) => url.endsWith('/me')
        ? { ok: meOk, json: async () => (meOk ? { ok: true, me: { email: 'person.a@example.invalid', role: 'staff' } } : { ok: false, error: 'unknown' }) }
        : { ok: teamOk, json: async () => (teamOk ? { ok: true, team: [] } : { ok: false, error: 'team down' }) },
      rememberStaffPanelsFor: me => { remembered.push(me.email); },
      forgetStaffPanelIdentity: () => { forgot.push(true); },
      renderStaffTeam: () => {},
    });
    runInContext(slice('let staffMe = null;', 'function renderStaffTeam()'), context);
    await context.loadStaffTeam();
    return { forgot: forgot.length, remembered };
  };
  assert.deepEqual(await run(false, true), { forgot: 1, remembered: [] });
  assert.deepEqual(await run(true, false), { forgot: 0, remembered: ['person.a@example.invalid'] });
  assert.deepEqual(await run(true, true), { forgot: 0, remembered: ['person.a@example.invalid'] });
});

test('the Legacy Assistant is excluded from section persistence and keeps its own closed-by-default disclosure', () => {
  const page = panelPage();
  const ids = runInContext('STAFF_PANEL_IDS', page.context);
  assert.deepEqual([...ids], PANELS);
  const module = slice('// Staff section disclosures:', '// End staff section disclosures.');
  assert.doesNotMatch(module, /staffAssistant|chatInput|sessionStorage|agent-confirmation/);
  const assistant = slice('// Presentation only:', '// Extend the browser chat controls');
  assert.match(assistant, /panel\.hidden = true;/);
  assert.match(assistant, /if \(!expanded && isRecording\)/);
  assert.doesNotMatch(assistant, /localStorage|rememberStaffPanelsFor/);
});

// ---- Needs attention: Open / Mark complete.
function followups({ fetchImpl }) {
  const message = { textContent: '', classes: new Set(), classList: { toggle(name, on) { on ? message.classes.add(name) : message.classes.delete(name); } } };
  const nodes = {
    needsAttentionBody: { innerHTML: '' }, needsAttentionCount: { textContent: '' }, needsAttentionMessage: message,
    caregiverRecordPanel: { dataset: {} },
  };
  const calls = [];
  const notes = [];
  const context = createContext({
    document: { getElementById: id => nodes[id] ?? null }, escapeHtml, console: { error() {} },
    noteNeedsAttentionActionable: value => notes.push(value), viewCaregiver: async () => {},
    fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); },
  });
  runInContext(slice('// Follow-ups: "Mark complete"', '// A focused caregiver view preserves'), context);
  return { context, nodes, calls, notes, message };
}

const queueReply = queue => ({ ok: true, json: async () => ({ ok: true, queue }) });
const QUEUE = [{ id: 7, caregiver_id: 'cg_one', caregiver_first_name: '<Fictional>', caregiver_last_name: 'Example', kind: 'support_request', detail: 'Call back', status: 'open' }];

function button() {
  return { disabled: false, textContent: 'Mark complete', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    closest(selector) { assert.equal(selector, '[data-action="resolve-followup"]'); return this; } };
}

test('open follow-ups say Open and Mark complete with an explained effect, and the count is in the summary', async () => {
  const h = followups({ fetchImpl: async () => queueReply(QUEUE) });
  await h.context.loadFollowups();
  const body = h.nodes.needsAttentionBody.innerHTML;
  assert.match(body, /<span class="badge badge-plum">Open<\/span>/);
  assert.match(body, /data-action="resolve-followup" data-followup-id="7" aria-describedby="needsAttentionHelp">Mark complete<\/button>/);
  assert.match(body, /data-action="view-caregiver" data-caregiver-id="cg_one"/);
  assert.match(body, /&lt;Fictional&gt; Example/);
  assert.doesNotMatch(body, /Queued|>Resolve</);
  assert.equal(h.nodes.needsAttentionCount.textContent, '(1 open)');
  assert.deepEqual(h.notes, [true]);
  const help = details('needsAttentionPanel').body;
  assert.match(help, /<strong>Mark complete<\/strong> records that the follow-up is done and removes it from this open list\. It does not send an email and does not delete the caregiver or any history\./);
  assert.doesNotMatch(html + source, /Queued/);
});

test('Mark complete posts the unchanged done transition once, shows pending, and blocks duplicate clicks', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = followups({ fetchImpl: (url) => (url.endsWith('/resolve') ? pending : queueReply([])) });
  const btn = button();
  const first = h.context.resolveFollowup(7, { target: btn, stopPropagation() {} });
  assert.equal(btn.disabled, true);
  assert.equal(btn.textContent, 'Marking complete…');
  assert.equal(btn.attrs['aria-busy'], 'true');
  assert.match(h.message.textContent, /Marking the follow-up complete/);
  await h.context.resolveFollowup(7, { target: btn, stopPropagation() {} });
  assert.equal(h.calls.length, 1, 'a second click while pending sends nothing');
  finish({ ok: true, json: async () => ({ ok: true }) });
  await first;
  assert.equal(h.calls[0].url, '/api/staff/followup/7/resolve');
  assert.equal(h.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { status: 'done' });
  assert.equal(h.calls[1].url, '/api/staff/queue');
  assert.match(h.message.textContent, /Marked complete and removed from the open list\. No email was sent\./);
  assert.equal(h.message.classes.has('is-error'), false);
  assert.equal(h.nodes.needsAttentionCount.textContent, '(nothing open)');
});

test('Mark complete failures are visible, re-enable the button and do not reload or retry', async () => {
  const refused = followups({ fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'cannot resolve from status done' }) }) });
  const btn = button();
  await refused.context.resolveFollowup(7, { target: btn, stopPropagation() {} });
  assert.equal(refused.calls.length, 1);
  assert.equal(btn.disabled, false);
  assert.equal(btn.textContent, 'Mark complete');
  assert.equal(btn.attrs['aria-busy'], undefined);
  assert.match(refused.message.textContent, /^Could not mark this follow-up complete: cannot resolve from status done\./);
  assert.equal(refused.message.classes.has('is-error'), true);

  const offline = followups({ fetchImpl: async () => { throw new Error('offline'); } });
  await offline.context.resolveFollowup(7, { target: button(), stopPropagation() {} });
  assert.match(offline.message.textContent, /the request did not finish/);
  await offline.context.loadFollowups();
  assert.match(offline.nodes.needsAttentionBody.innerHTML, /role="alert">Could not load follow-ups/);
  assert.equal(offline.nodes.needsAttentionCount.textContent, '(could not load)');
  assert.deepEqual(offline.notes, [], 'an unknown queue does not decide the default');
});

test('Mark complete reports completion only on an explicit {ok:true}; anything else is unconfirmed and re-read (review P2-1)', async () => {
  for (const reply of [
    { ok: true, status: 200, json: async () => { throw new SyntaxError('not JSON'); } },
    { ok: true, status: 200, json: async () => ({}) },
    { ok: true, status: 200, json: async () => ({ ok: 'yes' }) },
    { ok: true, status: 200, json: async () => null },
  ]) {
    const h = followups({ fetchImpl: async (url) => (url.endsWith('/resolve') ? reply : queueReply(QUEUE)) });
    const btn = button();
    await h.context.resolveFollowup(7, { target: btn, stopPropagation() {} });
    assert.doesNotMatch(h.message.textContent, /Marked complete/);
    assert.match(h.message.textContent, /could not confirm whether this follow-up was marked complete/);
    assert.equal(h.message.classes.has('is-error'), true);
    assert.equal(h.calls.filter(c => c.url.endsWith('/resolve')).length, 1, 'no automatic retry');
    assert.equal(h.calls.at(-1).url, '/api/staff/queue', 'the queue is re-read before any new attempt');
    assert.equal(h.nodes.needsAttentionCount.textContent, '(1 open)');
    assert.match(h.nodes.needsAttentionBody.innerHTML, /data-action="resolve-followup" data-followup-id="7"/);
  }
});

test('the follow-up route and its transition are unchanged (done/dismissed only, open-only queue)', () => {
  assert.match(staffRoute, /pathSegments\[2\] === 'followup' && pathSegments\[4\] === 'resolve'/);
  assert.match(staffRoute, /WHERE f\.status = 'open'/);
  assert.equal(source.match(/\/api\/staff\/followup\//g).length, 1);
  assert.doesNotMatch(source, /status: 'dismissed'|followup\/\$\{id\}\/reopen/);
});

// ---- Lifecycle discoverability with existing operations only.
test('Event Unpublish vs Archive effects are explained honestly, with no restore offered', () => {
  const help = html.match(/<p class="small muted mb-12" id="eventLifecycleHelp">([\s\S]*?)<\/p>/)[1];
  assert.match(help, /<strong>Unpublish<\/strong> hides a published event from the public calendar and returns it to draft\. Its details and registrations are kept, and you can publish it again\./);
  assert.match(help, /<strong>Archive<\/strong> retires the event for good: its details, registrations and history are kept and it stays off the public calendar, but it cannot be published again and there is no restore\./);
  assert.match(help, /If people are registered, you are asked to confirm first\. Neither action emails anyone or deletes anything\./);
  assert.match(source, /data-action="archive-event" data-event-id="\$\{escapeHtml\(ev\.id\)\}" aria-describedby="eventLifecycleHelp"/);
  assert.match(source, /data-action="unpublish-event" data-event-id="\$\{escapeHtml\(ev\.id\)\}" aria-describedby="eventLifecycleHelp"/);
  assert.match(source, /confirm\(`This event has \$\{data\.registration_count\} active registration\(s\)/);
  assert.doesNotMatch(source, /restore-event|\/event\/[^`'"]*\/restore/);
  const context = createContext({});
  runInContext(slice('function eventsCountText(', '// Archive / Restore reuse'), context);
  assert.equal(context.eventsCountText([{ publish_state: 'published' }, { publish_state: 'draft' }, { publish_state: 'archived' }, {}]), '(4 events: 2 published, 1 draft, 1 archived)');
  assert.equal(context.eventsCountText([]), '(0 events)');
});

test('Grants show where actions live, add only a client-side Active view, and never fake archive', () => {
  const help = html.match(/<p class="small muted mb-12" id="grantActionsHelp">([\s\S]*?)<\/p>/)[1];
  assert.match(help, /Choose <strong>Open application<\/strong> to go to the caregiver record\./);
  assert.match(help, /it is not an archive or delete\. Grant applications cannot be archived or deleted\./);
  assert.match(source, /data-action="view-caregiver" data-caregiver-id="\$\{escapeHtml\(g\.caregiver_id\)\}" aria-describedby="grantActionsHelp" aria-label="Open application: \$\{caregiverName\}">Open application<\/button>/);
  assert.match(html, /<option value="active">Active \(all except closed\)<\/option>/);
  const context = createContext({});
  runInContext(slice('function grantsRequestUrl(', 'async function loadGrants('), context);
  assert.equal(context.grantsRequestUrl('active'), '/api/grants', 'Active fetches the same full list');
  assert.equal(context.grantsRequestUrl(''), '/api/grants');
  assert.equal(context.grantsRequestUrl('in_review'), '/api/grants?status=in_review');
  const all = ['submitted', 'in_review', 'awarded', 'course_complete', 'declined', 'closed'].map(status => ({ status }));
  assert.deepEqual(context.visibleGrants(all, 'active').map(g => g.status), ['submitted', 'in_review', 'awarded', 'course_complete', 'declined']);
  assert.equal(context.visibleGrants(all, '').length, 6);
  assert.doesNotMatch(source, /\/api\/grants\/\$\{[^}]+\}\/(?:archive|restore|delete|withdraw)/);
});

function caregiverRecord({ status = 'active', patch = async () => ({ ok: true, json: async () => ({ ok: true }) }), confirmAnswer = true, get = null } = {}) {
  const make = (extra = {}) => ({ classList: { add() {}, remove() {} }, dataset: {}, innerHTML: '', focus() {}, ...extra });
  const message = { textContent: '', classes: new Set(), classList: { toggle(name, on) { on ? message.classes.add(name) : message.classes.delete(name); } } };
  const nodes = { staffDashboardView: make(), caregiverDetailView: make(), caregiverRecordPanel: make(), caregiverDetailHeading: make(), caregiverLifecycleMessage: message };
  const calls = [];
  const confirms = [];
  let profileStatus = status;
  const context = createContext({
    document: { getElementById: id => nodes[id], activeElement: null }, window: { scrollY: 0, scrollTo() {}, confirm: text => { confirms.push(text); return confirmAnswer; } },
    escapeHtml, localDateTimeValue: () => '2026-11-01T09:00', formatContactTime: value => value, console: { error() {} },
    currentCaregiverId: null, currentGrantId: null, currentSearchOffset: 0, searchCaregivers: async () => {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options?.method === 'PATCH') {
        const reply = await patch(url, options);
        if (reply.ok) profileStatus = JSON.parse(options.body).status;
        return reply;
      }
      if (get) { const held = get(url); if (held) await held; }
      return { ok: true, json: async () => ({ ok: true, profile: { id: 'cg_demo', first_name: 'Fictional', last_name: 'Example', status: profileStatus, sanctuary_member: 0 },
        grants: [], registrations: [], notes: [], contact_history: [], followups: [] }) };
    },
  });
  runInContext(slice('// A focused caregiver view', 'async function loadEvents('), context);
  return { context, nodes, calls, confirms, message };
}

test('caregiver record offers Archive caregiver with its portal effect, and Restore to active when archived', async () => {
  const active = caregiverRecord();
  await active.context.viewCaregiver('cg_demo');
  const panel = active.nodes.caregiverRecordPanel.innerHTML;
  assert.match(panel, /data-action="caregiver-archive" aria-describedby="caregiverLifecycleHelp">Archive caregiver<\/button>/);
  assert.doesNotMatch(panel, /caregiver-restore/);
  assert.match(panel, /An archived caregiver cannot sign in to the Caregiver Portal\. Archiving does not close their open follow-ups/);
  assert.match(panel, /nothing is deleted/);
  for (const nested of ['submit-add-contact', 'submit-add-note', 'submit-edit-caregiver', 'id="caregiverEditDetails"', 'Contact History']) assert.ok(panel.includes(nested), nested);

  const archived = caregiverRecord({ status: 'archived' });
  await archived.context.viewCaregiver('cg_demo');
  assert.match(archived.nodes.caregiverRecordPanel.innerHTML, /data-action="caregiver-restore" aria-describedby="caregiverLifecycleHelp">Restore to active<\/button>/);
  assert.doesNotMatch(archived.nodes.caregiverRecordPanel.innerHTML, /caregiver-archive/);
});

test('Archive/Restore reuse the existing caregiver PATCH with only status, confirm first and prevent duplicates', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = caregiverRecord({ patch: () => pending });
  await h.context.viewCaregiver('cg_demo');
  const target = { disabled: false };
  const run = h.context.setCaregiverRecordStatus('archived', target);
  assert.equal(target.disabled, true);
  assert.match(h.message.textContent, /Archiving/);
  await h.context.setCaregiverRecordStatus('archived', target);
  finish({ ok: true, json: async () => ({ ok: true }) });
  await run;
  const patches = h.calls.filter(call => call.options?.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url, '/api/staff/caregiver/cg_demo');
  assert.deepEqual(JSON.parse(patches[0].options.body), { status: 'archived' });
  assert.equal(h.confirms.length, 1);
  assert.match(h.confirms[0], /will not be able to sign in to the Caregiver Portal\. Open follow-ups stay open\./);
  assert.match(h.nodes.caregiverRecordPanel.innerHTML, /Restore to active/);

  const declined = caregiverRecord({ confirmAnswer: false });
  await declined.context.viewCaregiver('cg_demo');
  await declined.context.setCaregiverRecordStatus('archived', { disabled: false });
  assert.equal(declined.calls.filter(call => call.options?.method === 'PATCH').length, 0);

  const failed = caregiverRecord({ status: 'archived', patch: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: 'status must be one of: active, inactive, archived' }) }) });
  await failed.context.viewCaregiver('cg_demo');
  const restore = { disabled: false };
  await failed.context.setCaregiverRecordStatus('active', restore);
  assert.equal(restore.disabled, false);
  assert.match(failed.message.textContent, /^Could not change the status: status must be one of/);
  assert.equal(failed.message.classes.has('is-error'), true);
  await failed.context.setCaregiverRecordStatus('deleted', restore);
  assert.equal(failed.calls.filter(call => call.options?.method === 'PATCH').length, 1, 'only archived/active are offered');
});

test('an older Archive/Restore response never pulls staff back from a newer record (review P2-3)', async () => {
  for (const outcome of ['success', 'failure']) {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const h = caregiverRecord({ patch: () => pending });
    await h.context.viewCaregiver('cg_demo');
    const target = { disabled: false };
    const run = h.context.setCaregiverRecordStatus('archived', target);
    const before = h.calls.length;
    h.nodes.caregiverRecordPanel.dataset.caregiverId = 'cg_second'; // staff opened another record
    h.message.textContent = 'cg_second view';
    finish(outcome === 'success'
      ? { ok: true, json: async () => ({ ok: true }) }
      : { ok: false, status: 400, json: async () => ({ ok: false, error: 'refused' }) });
    await run;
    const views = h.calls.slice(before).filter(c => !c.options?.method && /\/api\/staff\/caregiver\/cg_demo/.test(c.url));
    assert.deepEqual(views, [], `${outcome}: no navigation back to the older record`);
    assert.equal(h.nodes.caregiverRecordPanel.dataset.caregiverId, 'cg_second');
    assert.equal(h.message.textContent, 'cg_second view', `${outcome}: no stale feedback on the newer record`);
  }
});

test('an Archive/Restore response is fenced by view generation: newer record still loading, leave, re-enter (review item 3)', async () => {
  const viewsOf = (h, from, id) => h.calls.slice(from).filter(c => !c.options?.method && c.url === `/api/staff/caregiver/${id}`);
  for (const outcome of ['success', 'failure']) {
    const reply = outcome === 'success'
      ? { ok: true, json: async () => ({ ok: true }) }
      : { ok: false, status: 400, json: async () => ({ ok: false, error: 'refused' }) };

    // A rendered -> A Archive pending -> B GET starts (panel still names A) -> A's PATCH returns.
    let finish, releaseB;
    const patchHeld = new Promise(resolve => { finish = resolve; });
    const bHeld = new Promise(resolve => { releaseB = resolve; });
    const h = caregiverRecord({ patch: () => patchHeld, get: url => url.endsWith('/cg_second') ? bHeld : null });
    await h.context.viewCaregiver('cg_demo');
    const target = { disabled: false };
    const run = h.context.setCaregiverRecordStatus('archived', target);
    const before = h.calls.length;
    const loadingB = h.context.viewCaregiver('cg_second');
    await flush();
    assert.equal(h.nodes.caregiverRecordPanel.dataset.caregiverId, 'cg_demo', 'B is still loading');
    finish(reply);
    await run;
    assert.deepEqual(viewsOf(h, before, 'cg_demo'), [], `${outcome}: no refresh of A while B loads`);
    assert.equal(h.message.textContent, 'Archiving…', `${outcome}: no stale A feedback`);
    assert.equal(target.disabled, true, `${outcome}: A's old button is not re-enabled into B's view`);
    releaseB();
    await loadingB;
    assert.equal(h.nodes.caregiverRecordPanel.dataset.caregiverId, 'cg_second', `${outcome}: B's pending load still renders`);

    // Leave for the dashboard while the PATCH is pending.
    let finishLeave;
    const leaveHeld = new Promise(resolve => { finishLeave = resolve; });
    const left = caregiverRecord({ patch: () => leaveHeld });
    await left.context.viewCaregiver('cg_demo');
    const leaveRun = left.context.setCaregiverRecordStatus('archived', { disabled: false });
    const leaveBefore = left.calls.length;
    left.context.backToStaffDashboard();
    finishLeave(reply);
    await leaveRun;
    assert.deepEqual(viewsOf(left, leaveBefore, 'cg_demo'), [], `${outcome}: leaving cancels the refresh`);
    assert.equal(left.message.textContent, 'Archiving…', `${outcome}: no feedback after leaving`);

    // Leave and re-enter the same record before the PATCH returns: only the re-entry GET runs.
    let finishAgain;
    const againHeld = new Promise(resolve => { finishAgain = resolve; });
    const again = caregiverRecord({ patch: () => againHeld });
    await again.context.viewCaregiver('cg_demo');
    const againRun = again.context.setCaregiverRecordStatus('archived', { disabled: false });
    const againBefore = again.calls.length;
    again.context.backToStaffDashboard();
    await again.context.viewCaregiver('cg_demo');
    finishAgain(reply);
    await againRun;
    assert.equal(viewsOf(again, againBefore, 'cg_demo').length, 1, `${outcome}: the re-entered view is not reloaded by the old response`);
    assert.equal(again.message.textContent, 'Archiving…', `${outcome}: no stale feedback on the re-entered view`);
  }

  // The refresh after a still-current success reports on its own generation.
  const current = caregiverRecord();
  await current.context.viewCaregiver('cg_demo');
  await current.context.setCaregiverRecordStatus('archived', { disabled: false });
  assert.match(current.message.textContent, /^Archived\./);
});

test('an Events load failure is visible in the count and the list (review item 5)', async () => {
  const nodes = { eventsCount: { textContent: '(3 events: 3 published)' }, upcomingEventsBody: { innerHTML: '<tr><td>stale row</td></tr>' } };
  const errors = [];
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => ({ ok: false, error: 'nope' }) }),
  ]) {
    const context = createContext({ document: { getElementById: id => nodes[id] }, fetch: fetchImpl, console: { error: e => errors.push(e) }, escapeHtml });
    runInContext(slice('async function loadEvents(', 'function renderNewEventForm('), context);
    await context.loadEvents();
    assert.equal(nodes.eventsCount.textContent, '(could not load)');
    assert.equal(nodes.upcomingEventsBody.innerHTML, '<tr><td colspan="5" class="text-center muted small" role="alert">Could not load events. Reload the page to try again.</td></tr>');
    nodes.eventsCount.textContent = 'stale';
  }
  assert.equal(errors.length, 2);
});

test('Event Archive confirms before the first POST and keeps the separate registration override (review item 6)', async () => {
  function archive({ answers, replies }) {
    const posts = [], confirms = [], alerts = [];
    let reloads = 0;
    const context = createContext({
      confirm: text => { confirms.push(text); return answers.shift(); },
      alert: text => alerts.push(text),
      fetch: async (url, options) => { posts.push({ url, body: JSON.parse(options.body), method: options.method }); return replies.shift(); },
      loadEvents: async () => { reloads++; }, loadRecentChanges: async () => {},
    });
    runInContext(slice('async function archiveEvent(', 'async function selectEvent('), context);
    return { context, posts, confirms, alerts, reloads: () => reloads };
  }
  const ok = { ok: true, status: 200, json: async () => ({ ok: true }) };
  const busy = { ok: false, status: 409, json: async () => ({ ok: false, registration_count: 2 }) };

  const declined = archive({ answers: [false], replies: [] });
  await declined.context.archiveEvent('ev_1');
  assert.equal(declined.posts.length, 0, 'declining the first question sends nothing');
  assert.equal(declined.confirms[0], 'Archive this event for good? Its details, registrations and history are kept and it stays off the public calendar, but it cannot be published again and there is no restore.');

  const plain = archive({ answers: [true], replies: [ok] });
  await plain.context.archiveEvent('ev_1');
  assert.deepEqual(plain.posts, [{ url: '/api/staff/event/ev_1/archive', body: {}, method: 'POST' }]);
  assert.equal(plain.confirms.length, 1);
  assert.equal(plain.reloads(), 1);

  const override = archive({ answers: [true, true], replies: [busy, ok] });
  await override.context.archiveEvent('ev_1');
  assert.deepEqual(override.posts.map(p => p.body), [{}, { confirm_with_registrations: true }]);
  assert.equal(override.confirms.length, 2, 'the registration question is asked once, separately');
  assert.match(override.confirms[1], /^This event has 2 active registration\(s\)/);

  const keep = archive({ answers: [true, false], replies: [busy] });
  await keep.context.archiveEvent('ev_1');
  assert.equal(keep.posts.length, 1, 'declining the registration override sends nothing more');
  assert.equal(keep.reloads(), 0);
});
