// Markup and browser-function stubs only: no handler, database or hosted writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const html = readFileSync(new URL('../staff.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

test('Change log and Site content use native default-closed details at the end', () => {
  const log = html.match(/<details\b([^>]*id="recentChangesPanel"[^>]*)>([\s\S]*?)<\/details>/);
  const content = html.match(/<details\b([^>]*id="siteContentPanel"[^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(log && content);
  assert.doesNotMatch(log[1] + content[1], /\bopen(?:\s|=|$)/);
  assert.match(log[2], /<summary><strong>Change log<\/strong><\/summary>/);
  assert.match(content[2], /<summary><strong>Site content<\/strong><\/summary>/);
  assert.ok(html.indexOf('id="caregiverSearchPanel"') < html.indexOf('id="staffTeamPanel"'));
  assert.ok(html.indexOf('id="staffTeamPanel"') < html.indexOf('id="recentChangesPanel"'));
  assert.ok(html.indexOf('id="recentChangesPanel"') < html.indexOf('id="siteContentPanel"'));
  assert.doesNotMatch(html.slice(html.indexOf(content[0]) + content[0].length), /class="panel"/);
  assert.ok(content[2].indexOf('id="siteContentEditor"') < content[2].indexOf('id="siteContentList"'));
  for (const id of ['siteContentList', 'siteContentEditor', 'recentChangesList', 'refreshRecentChangesBtn', 'staffTeamMessage']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
  }
});

test('wording distinguishes staff, selected caregiver records and portal check-ins', () => {
  assert.match(html, /Staff accounts are for the team who manage the Hub/);
  assert.match(html, /Caregivers use the Caregiver Portal for their own membership and wellness information/);
  assert.match(html, /Results appear after you search; select a name/);
  assert.match(html, /href="#caregiverSearchQuery">Search caregiver records/);
  assert.match(html, /Only caregivers with recorded check-ins appear in this list/);
  assert.match(html, /adding a staff account does not add a caregiver here/);
  assert.doesNotMatch(html, /100 means doing well/);
  assert.match(html, /id="staffTeamMessage" role="status" aria-live="polite"/);
});

function editor() {
  const heading = { calls: 0, focus() { this.calls++; } };
  const panel = { open: false };
  const classes = new Set(['d-none']);
  const editor = { innerHTML: '', classList: { remove: (key) => classes.delete(key), add: (key) => classes.add(key) } };
  const list = { innerHTML: '' };
  const nodes = { siteContentPanel: panel, siteContentEditor: editor, contentEditorHeading: heading, siteContentList: list };
  const item = { id: 'ps_example.heading', type_id: 'page_section', data: { heading: 'A <readable> title', layout: 'preserve' } };
  const schema = { properties: { heading: { type: 'string' }, layout: { type: 'string', readOnly: true } } };
  const context = createContext({
    document: { getElementById: (id) => nodes[id] }, escapeHtml,
    siteContentItems: [item], siteContentTypes: { page_section: schema },
    alert: (message) => assert.fail(message),
  });
  runInContext(source.slice(source.indexOf('function renderSiteContent('), source.indexOf('async function submitDirectContent(')), context);
  return { context, heading, panel, editor, list, classes, schema };
}

test('Edit wording names its target, opens the existing editor and focuses its title', () => {
  const h = editor();
  h.context.renderSiteContent();
  assert.match(h.list.innerHTML, /aria-label="Edit wording: A &lt;readable> title"/);
  assert.match(h.list.innerHTML, />Edit wording<\/button>/);
  h.context.openContentEditor('ps_example.heading');
  assert.equal(h.panel.open, true);
  assert.equal(h.classes.has('d-none'), false);
  assert.equal(h.heading.calls, 1);
  assert.match(h.editor.innerHTML, /id="contentEditorHeading" tabindex="-1">Edit wording: A &lt;readable> title/);
  assert.match(h.editor.innerHTML, /data-content-id="ps_example.heading"/);
  assert.doesNotMatch(h.editor.innerHTML, /name="layout"/);
  assert.match(h.editor.innerHTML, />Save published changes<\/button>/);
});

test('an unsupported editor schema still refuses an editable form', () => {
  const h = editor();
  const result = h.context.generateSchemaFormHtml({ oneOf: [] }, {}, 'page_section', 'ps_example.heading');
  assert.doesNotMatch(result, /<form/);
  assert.match(result, /This section cannot be edited here/);
  assert.match(result, /id="contentEditorHeading" tabindex="-1"/);
});

function team({ patch, refreshOk = true } = {}) {
  const message = { textContent: '', dataset: {} };
  let rowMessage = { textContent: '', dataset: {} };
  let listHtml = '';
  const list = {};
  Object.defineProperty(list, 'innerHTML', {
    get: () => listHtml,
    set(value) { listHtml = value; rowMessage = value.includes('<table') ? { textContent: '', dataset: {} } : null; },
  });
  const calls = [];
  let recentLoads = 0;
  const context = createContext({
    escapeHtml, CSS: { escape: (value) => value },
    document: { getElementById: (id) => id === 'staffTeamMessage' ? message : list, querySelector: () => rowMessage },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options?.method === 'PATCH') return patch ? patch() : { ok: true, json: async () => ({ ok: true }) };
      if (url.endsWith('/me')) return { ok: true, json: async () => ({ ok: true, me: { email: 'admin@example.invalid', role: 'admin', status: 'active' } }) };
      return { ok: refreshOk, json: async () => refreshOk
        ? { ok: true, team: [{ email: 'member@example.invalid', display_name: 'Example', role: 'staff', status: 'active' }] }
        : { ok: false, error: 'List unavailable' } };
    },
    loadRecentChanges() { recentLoads++; },
  });
  runInContext(source.slice(source.indexOf('let staffMe = null;'), source.indexOf('/* ---------- Caregiver wellness chart')), context);
  const button = { disabled: false, textContent: 'Save', attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; } };
  return { context, button, message, calls, list, row: () => rowMessage, recentLoads: () => recentLoads };
}

test('staff Save announces pending state, prevents a repeated click, and reports success after rerender', async () => {
  let resolvePatch;
  const pending = new Promise((resolve) => { resolvePatch = resolve; });
  const h = team({ patch: () => pending });
  const save = h.context.saveStaffMember('member@example.invalid', { display_name: 'Updated', role: 'staff' }, h.button);
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.textContent, 'Saving…');
  assert.equal(h.button.attrs['aria-busy'], 'true');
  assert.match(h.message.textContent, /^Saving changes for member@example.invalid/);
  assert.equal(h.row().dataset.state, 'saving');
  await h.context.saveStaffMember('member@example.invalid', {}, h.button);
  assert.equal(h.calls.length, 1);
  resolvePatch({ ok: true, json: async () => ({ ok: true }) });
  await save;
  assert.match(h.message.textContent, /^Saved changes for member@example.invalid\.$/);
  assert.equal(h.message.dataset.state, 'success');
  assert.equal(h.row().textContent, h.message.textContent);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'Save');
  assert.equal(h.button.attrs['aria-busy'], undefined);
  assert.deepEqual(JSON.parse(h.calls[0].options.body), { email: 'member@example.invalid', display_name: 'Updated', role: 'staff' });
  assert.equal(h.recentLoads(), 1);
  assert.doesNotMatch(h.list.innerHTML, /id="staffTeamMessage"/);
});

test('a confirmed staff save followed by readback failure remains a saved result, not a retry invitation', async () => {
  const h = team({ refreshOk: false });
  await h.context.saveStaffMember('member@example.invalid', { display_name: 'Updated' }, h.button);
  assert.match(h.message.textContent, /were saved, but the staff list could not refresh/);
  assert.match(h.message.textContent, /do not save again/);
  assert.equal(h.message.dataset.state, 'warning');
  assert.equal(h.row(), null);
  assert.equal(h.calls.filter((call) => call.options?.method === 'PATCH').length, 1);
  assert.equal(h.button.disabled, false);
});

for (const [kind, patch] of [
  ['refusal', async () => ({ ok: false, json: async () => ({ ok: false, error: '<b>Not allowed</b>' }) })],
  ['network uncertainty', async () => { throw new Error('Connection lost'); }],
  ['unreadable acknowledgement', async () => ({ ok: true, json: async () => { throw new Error('Invalid response'); } })],
]) {
  test(`staff ${kind} shows contextual error without replay or false saved claim`, async () => {
    const h = team({ patch });
    await h.context.saveStaffMember('member@example.invalid', { role: 'staff' }, h.button);
    assert.match(h.message.textContent, /^Save was not confirmed for member@example.invalid:/);
    assert.match(h.message.textContent, /administrator to check what was saved/);
    assert.equal(h.message.dataset.state, 'error');
    assert.equal(h.row().textContent, h.message.textContent);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, 'Save');
    assert.equal(h.calls.length, 1);
    assert.equal(h.recentLoads(), 0);
  });
}

test('normal staff still get read-only team rows, with no add or role/save controls', () => {
  const h = team();
  runInContext("staffMe = { email: 'member@example.invalid', role: 'staff', status: 'active' }; staffTeam = [{email:'member@example.invalid',display_name:'<Example>',role:'staff',status:'active'}]; renderStaffTeam();", h.context);
  assert.doesNotMatch(h.list.innerHTML, /data-action="staff-save"|submit-add-staff|data-staff-role=/);
  assert.match(h.list.innerHTML, /&lt;Example>/);
});
