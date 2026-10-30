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
  assert.ok(html.indexOf('id="staffTeamPanel"') < html.indexOf('id="caregiverSearchPanel"'));
  assert.ok(html.indexOf('id="caregiverSearchPanel"') < html.indexOf('id="recentChangesPanel"'));
  const search = html.match(/<details\b([^>]*id="peopleManagementPanel"[^>]*)>/);
  assert.ok(search);
  assert.doesNotMatch(search[1], /\bopen(?:\s|=|$)/);
  assert.ok(html.indexOf('id="staffTeamPanel"') < html.indexOf('id="recentChangesPanel"'));
  assert.ok(html.indexOf('id="recentChangesPanel"') < html.indexOf('id="siteContentPanel"'));
  assert.doesNotMatch(html.slice(html.indexOf(content[0]) + content[0].length, html.indexOf('id="caregiverDetailView"')), /class="panel"/);
  assert.ok(content[2].indexOf('id="siteContentEditor"') < content[2].indexOf('id="siteContentList"'));
  for (const id of ['siteContentList', 'siteContentEditor', 'recentChangesList', 'refreshRecentChangesBtn', 'staffTeamMessage']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
  }
});

test('wording distinguishes staff, selected caregiver records and portal check-ins', () => {
  assert.match(html, /Staff accounts are for the team who manage the Hub/);
  assert.match(html, /Caregivers use the Caregiver Portal for their own membership and wellness information/);
  assert.match(html, /Choose Open\/Edit to open a focused caregiver view/);
  assert.match(html, /data-action="caregiver-back"/);
  assert.match(html, /id="caregiverDetailView" class="staff-workspace d-none"/);
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

function team({ patch, refreshOk = true, query = '', roleFilter = 'all' } = {}) {
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
    document: { getElementById: (id) => id === 'staffTeamMessage' ? message
      : id === 'caregiverSearchQuery' ? { value: query }
      : id === 'peopleRoleFilter' ? { value: roleFilter } : list, querySelector: () => rowMessage },
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


function focusedCaregiver({ reply, fetchError = false } = {}) {
  const makeNode = (extra = {}) => {
    const classes = new Set();
    return { classes, classList: { add: key => classes.add(key), remove: key => classes.delete(key) },
      dataset: {}, innerHTML: '', focusCalls: 0, focus() { this.focusCalls++; }, ...extra };
  };
  const opener = makeNode({ tagName: 'BUTTON', isConnected: true });
  const nodes = {
    staffDashboardView: makeNode(), caregiverDetailView: makeNode(), caregiverRecordPanel: makeNode(),
    caregiverDetailHeading: makeNode(), staffDashboardHeading: makeNode(),
    caregiverSearchPanel: makeNode({ open: true }), caregiverSearchQuery: makeNode({ value: 'DEMO' }),
    caregiverSearchSegment: makeNode({ value: 'general' }), caregiverSearchStatus: makeNode({ value: 'inactive' }),
    caregiverSearchResultsBody: makeNode({ innerHTML: 'retained results' }),
  };
  nodes.caregiverDetailView.classes.add('d-none');
  const calls = [], scrolls = [];
  const context = createContext({ document: { getElementById: id => nodes[id], activeElement: opener },
    window: { scrollY: 456, scrollTo: (...args) => scrolls.push(args) },
    currentCaregiverId: null, currentGrantId: null, currentSearchOffset: 20,
    escapeHtml, localDateTimeValue: () => '2026-10-29T09:00', formatContactTime: value => value,
    console: { error() {} }, fetch: async (url, options) => {
      calls.push({ url, options });
      if (fetchError) throw new Error('No read response');
      return { ok: true, json: async () => reply ? await reply(url) : ({ ok: true,
        profile: { id: 'cg_demo', first_name: '<Demo>', last_name: 'Example', status: 'inactive', sanctuary_member: 0 },
        grants: [], registrations: [], notes: [], contact_history: [], followups: [] }) };
    } });
  runInContext(source.slice(source.indexOf('// A focused caregiver view'), source.indexOf('async function loadEvents(')), context);
  return { context, nodes, opener, calls, scrolls };
}

test('caregiver Open uses a focused read-only view and Back preserves exact search DOM, filters, paging and focus', async () => {
  const h = focusedCaregiver();
  const originalResults = h.nodes.caregiverSearchResultsBody;
  await h.context.viewCaregiver('cg_demo');
  assert.equal(h.nodes.staffDashboardView.classes.has('d-none'), true);
  assert.equal(h.nodes.caregiverDetailView.classes.has('d-none'), false);
  assert.match(h.nodes.caregiverRecordPanel.innerHTML, /Caregiver record — &lt;Demo> Example/);
  for (const action of ['submit-edit-caregiver', 'submit-add-contact', 'submit-add-note']) assert.match(h.nodes.caregiverRecordPanel.innerHTML, new RegExp(action));
  assert.equal(h.context.currentCaregiverId, 'cg_demo');
  assert.equal(h.nodes.caregiverDetailHeading.focusCalls, 1);
  h.context.backToStaffDashboard();
  assert.equal(h.nodes.staffDashboardView.classes.has('d-none'), false);
  assert.equal(h.nodes.caregiverDetailView.classes.has('d-none'), true);
  assert.equal(h.nodes.caregiverSearchResultsBody, originalResults);
  assert.equal(originalResults.innerHTML, 'retained results');
  assert.deepEqual([h.nodes.caregiverSearchQuery.value, h.nodes.caregiverSearchSegment.value, h.nodes.caregiverSearchStatus.value], ['DEMO', 'general', 'inactive']);
  assert.equal(h.nodes.caregiverSearchPanel.open, true);
  assert.equal(h.context.currentSearchOffset, 20);
  assert.equal(h.context.currentCaregiverId, null);
  assert.equal(h.nodes.caregiverRecordPanel.innerHTML, '');
  assert.equal(h.opener.focusCalls, 1);
  assert.deepEqual(h.scrolls[0], [0, 456]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/api/staff/caregiver/cg_demo');
  assert.equal(h.calls[0].options, undefined);
});

test('Back during a pending caregiver read cannot reopen or populate a stale detail view', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = focusedCaregiver({ reply: () => pending });
  const read = h.context.viewCaregiver('cg_demo');
  h.context.backToStaffDashboard();
  resolve({ ok: true, profile: { first_name: 'Late' }, registrations: [], grants: [] });
  await read;
  assert.equal(h.nodes.caregiverDetailView.classes.has('d-none'), true);
  assert.equal(h.nodes.staffDashboardView.classes.has('d-none'), false);
  assert.equal(h.nodes.caregiverRecordPanel.innerHTML, '');
  assert.equal(h.context.currentCaregiverId, null);
});

test('caregiver read failure leaves an accessible error and working Back without mutating records', async () => {
  const h = focusedCaregiver({ fetchError: true });
  await h.context.viewCaregiver('cg_demo');
  assert.match(h.nodes.caregiverRecordPanel.innerHTML, /role="alert"/);
  h.context.backToStaffDashboard();
  assert.equal(h.nodes.staffDashboardView.classes.has('d-none'), false);
  assert.equal(h.calls.length, 1);
});

test('staff rows offer explicit Edit before showing controls; Cancel is local and never opens a caregiver', () => {
  const h = team();
  runInContext("staffMe = {email:'admin@example.invalid',role:'admin',status:'active'}; staffTeam = [{email:'member@example.invalid',display_name:'Example',role:'staff',status:'active'}]; renderStaffTeam();", h.context);
  assert.match(h.list.innerHTML, /data-action="staff-edit"/);
  assert.match(h.list.innerHTML, /aria-label="Edit staff account: Example"/);
  assert.doesNotMatch(h.list.innerHTML, /data-staff-name=|data-action="staff-save"/);
  const target = { getAttribute: () => 'member@example.invalid' };
  h.context.staffTeamAction('edit', target);
  assert.match(h.list.innerHTML, /data-staff-name="member@example.invalid"/);
  assert.match(h.list.innerHTML, /data-action="staff-save"/);
  assert.match(h.list.innerHTML, /data-action="staff-deactivate"/);
  assert.match(h.list.innerHTML, /data-action="staff-cancel"/);
  assert.doesNotMatch(h.list.innerHTML, /view-caregiver|data-caregiver-id/);
  h.context.staffTeamAction('cancel', target);
  assert.doesNotMatch(h.list.innerHTML, /data-staff-name=|data-action="staff-save"/);
  assert.equal(h.calls.length, 0);
});


test('actual caregiver search renderer offers a named native Open/Edit button with escaped ID and no row-click requirement', async () => {
  const nodes = Object.fromEntries(['caregiverSearchQuery', 'caregiverSearchSegment', 'caregiverSearchStatus', 'caregiverSearchResultsBody', 'caregiverSearchPagingInfo', 'caregiverSearchPrevBtn', 'caregiverSearchNextBtn'].map(id => [id, { value: '', innerHTML: '', textContent: '' }]));
  nodes.caregiverSearchQuery.value = 'DEMO';
  const calls = [];
  const context = createContext({ document: {getElementById: id => nodes[id]}, URLSearchParams, escapeHtml,
    currentSearchOffset: 0, totalSearchResults: 0, searchLimit: 10, caregiverSearchEpoch: 0, renderStaffTeam() {}, console: {error() {}},
    fetch: async (url, options) => { calls.push({url, options}); return {ok:true,json:async()=>({ok:true,total:1,caregivers:[{id:'cg_"demo',first_name:'<Demo>',last_name:'Example',status:'inactive'}]})}; } });
  runInContext(source.slice(source.indexOf('async function searchCaregivers('), source.indexOf('async function loadStaffConsole(')), context);
  await context.searchCaregivers(0);
  assert.match(nodes.caregiverSearchResultsBody.innerHTML, /<button type="button"[^>]+data-action="view-caregiver"[^>]+data-caregiver-id="cg_&quot;demo"/);
  assert.match(nodes.caregiverSearchResultsBody.innerHTML, /aria-label="Open or edit caregiver: &lt;Demo> Example">Open\/Edit<\/button>/);
  assert.doesNotMatch(nodes.caregiverSearchResultsBody.innerHTML, /<tr[^>]+data-action/);
  assert.equal(calls[0].options, undefined);
  assert.match(calls[0].url, /q=DEMO/);
});

test('a slower previous caregiver read cannot replace the latest selected caregiver', async () => {
  let finishA;
  const pendingA = new Promise(resolve => { finishA = resolve; });
  const make = name => ({ok:true,profile:{first_name:name,status:'inactive'},registrations:[],grants:[],notes:[],contact_history:[]});
  const h = focusedCaregiver({reply:url => url.endsWith('/cg_a') ? pendingA : make('Latest')});
  const first = h.context.viewCaregiver('cg_a');
  await h.context.viewCaregiver('cg_b');
  finishA(make('Old'));
  await first;
  assert.match(h.nodes.caregiverRecordPanel.innerHTML, /Latest/);
  assert.doesNotMatch(h.nodes.caregiverRecordPanel.innerHTML, /Old/);
  assert.equal(h.context.currentCaregiverId, 'cg_b');
});

test('staff Edit preserves self-access protections and ignores forged nonadmin edit attempts', () => {
  const h = team();
  runInContext("staffMe = {email:'admin@example.invalid',role:'admin',status:'active'}; staffTeam = [{email:'admin@example.invalid',display_name:'Admin',role:'admin',status:'active'}];",h.context);
  h.context.staffTeamAction('edit',{getAttribute:()=> 'admin@example.invalid'});
  assert.match(h.list.innerHTML,/data-staff-name=/);
  assert.doesNotMatch(h.list.innerHTML,/data-staff-role=|staff-deactivate|staff-reactivate/);
  runInContext("staffMe.role='staff'; editingStaffEmail=null; renderStaffTeam();",h.context);
  h.context.staffTeamAction('edit',{getAttribute:()=> 'admin@example.invalid'});
  assert.doesNotMatch(h.list.innerHTML,/data-staff-name=|staff-save|staff-edit/);
  assert.equal(h.calls.length,0);
});


test('focused caregiver Edit opens the existing form and focuses its first field without a write', () => {
  const field = { calls: 0, focus() { this.calls++; } };
  const details = {open:false, querySelector: selector => {assert.equal(selector, '[name="first_name"]');return field;}};
  const context = createContext({document:{getElementById:id => {assert.equal(id,'caregiverEditDetails');return details;}}});
  runInContext(source.slice(source.indexOf('function openCaregiverEditor('),source.indexOf('function backToStaffDashboard(')),context);
  context.openCaregiverEditor();
  assert.equal(details.open,true);
  assert.equal(field.calls,1);
  assert.match(source,/data-action="caregiver-edit">Edit caregiver details/);
});


test('one collapsed People area contains staff and caregiver lists, shared search and role filter', () => {
  const people = html.match(/<details\b([^>]*id="peopleManagementPanel"[^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(people);
  assert.doesNotMatch(people[1], /\bopen(?:\s|=|$)/);
  for (const id of ['staffTeamPanel', 'caregiverSearchPanel', 'caregiverSearchQuery', 'peopleRoleFilter']) {
    assert.match(people[2], new RegExp(`id="${id}"`));
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  }
  assert.match(people[2], /value="caregiver"/);
  assert.match(people[2], /value="admin"/);
  assert.match(people[2], /A caregiver record never grants staff access/);
  assert.match(people[2], /inactive records can still sign in/);
});

test('staff filtering combines shared name/email query with exact role without giving edit rights', () => {
  const h = team({ query: 'EXAMPLE', roleFilter: 'admin' });
  runInContext("staffMe={email:'reader@example.invalid',role:'staff',status:'active'}; staffTeam=[{email:'admin@example.invalid',display_name:'Found Admin',role:'admin',status:'active'},{email:'staff@example.invalid',display_name:'Hidden Staff',role:'staff',status:'active'},{email:'other@else.invalid',display_name:'Different Admin',role:'admin',status:'active'}];renderStaffTeam();",h.context);
  assert.match(h.list.innerHTML,/Found Admin/);
  assert.doesNotMatch(h.list.innerHTML,/Hidden Staff|Different Admin|staff-edit|staff-save|submit-add-staff/);
  assert.equal(h.calls.length,0);
});

test('an empty search preserves admin Add staff access without automatically opening the form', () => {
  const h = team({query:'no matching person'});
  runInContext("staffMe={email:'admin@example.invalid',role:'admin',status:'active'};staffTeam=[{email:'admin@example.invalid',display_name:'Admin',role:'admin',status:'active'}];renderStaffTeam();",h.context);
  assert.match(h.list.innerHTML,/No staff match this search and role/);
  assert.match(h.list.innerHTML,/<details class="mb-12"><summary>Add staff member/);
  assert.doesNotMatch(h.list.innerHTML,/<details[^>]*\bopen\b/);
  assert.equal(h.calls.length,0);
});

function searchHarness(fetch) {
  const nodes=Object.fromEntries(['caregiverSearchQuery','caregiverSearchSegment','caregiverSearchStatus','caregiverSearchResultsBody','caregiverSearchPagingInfo','caregiverSearchPrevBtn','caregiverSearchNextBtn'].map(id=>[id,{value:'',innerHTML:'',textContent:'',disabled:false}]));
  const context=createContext({document:{getElementById:id=>nodes[id]},URLSearchParams,escapeHtml,currentSearchOffset:0,totalSearchResults:0,searchLimit:10,caregiverSearchEpoch:0,renderStaffTeam(){},fetch});
  runInContext(source.slice(source.indexOf('async function searchCaregivers('),source.indexOf('function filterBySegment(')),context);
  return {nodes,context};
}

test('a slower search cannot replace results for the latest shared query', async () => {
  let finish;
  const slow=new Promise(resolve=>{finish=resolve;});
  const reply=name=>({ok:true,json:async()=>({ok:true,total:1,caregivers:[{id:name,first_name:name,status:'active'}]})});
  const h=searchHarness(url=>url.includes('q=old')?slow:Promise.resolve(reply('Current')));
  h.nodes.caregiverSearchQuery.value='old';
  const first=h.context.searchCaregivers(0);
  h.nodes.caregiverSearchQuery.value='new';
  await h.context.searchCaregivers(0);
  finish(reply('Stale'));await first;
  assert.match(h.nodes.caregiverSearchResultsBody.innerHTML,/Current/);
  assert.doesNotMatch(h.nodes.caregiverSearchResultsBody.innerHTML,/Stale/);
});

test('failed caregiver search clears stale results and disables misleading paging',async()=>{
  const h=searchHarness(async()=>{throw new Error('Offline <retry>');});
  h.nodes.caregiverSearchResultsBody.innerHTML='Old matches';
  await h.context.searchCaregivers(0);
  assert.match(h.nodes.caregiverSearchResultsBody.innerHTML,/role="alert"/);
  assert.match(h.nodes.caregiverSearchResultsBody.innerHTML,/&lt;retry>/);
  assert.doesNotMatch(h.nodes.caregiverSearchResultsBody.innerHTML,/Old matches/);
  assert.equal(h.nodes.caregiverSearchNextBtn.disabled,true);
  assert.equal(h.nodes.caregiverSearchPrevBtn.disabled,true);
});


test('a failed staff refresh cannot revive stale admin controls when filtering',async()=>{
  const h=team({refreshOk:false});
  runInContext("staffMe={email:'old@example.invalid',role:'admin',status:'active'};staffTeam=[{email:'old@example.invalid',display_name:'Stale Admin',role:'admin',status:'active'}];",h.context);
  assert.equal(await h.context.loadStaffTeam(),false);
  h.context.renderStaffTeam();
  assert.match(h.list.innerHTML,/Could not load staff/);
  assert.doesNotMatch(h.list.innerHTML,/Stale Admin|staff-edit|submit-add-staff/);
});

test('People role choices show exactly one group and retain the shared search', () => {
  const nodes = { peopleRoleFilter: { value: 'caregiver' } };
  for (const id of ['staffTeamPanel', 'caregiverSearchPanel']) {
    nodes[id] = { hidden: false, classList: { toggle(_class, hidden) { nodes[id].hidden = hidden; } } };
  }
  let searches = 0;
  const context = createContext({ document: { getElementById: id => nodes[id] }, editingStaffEmail: 'old', searchCaregivers(offset) { assert.equal(offset, 0); searches++; } });
  runInContext(source.slice(source.indexOf('function filterPeopleByRole('), source.indexOf('function filterBySegment(')), context);
  for (const role of ['caregiver', 'team', 'staff', 'admin']) {
    nodes.peopleRoleFilter.value = role;
    context.filterPeopleByRole();
    assert.equal(nodes.staffTeamPanel.hidden, role === 'caregiver');
    assert.equal(nodes.caregiverSearchPanel.hidden, role !== 'caregiver');
    assert.equal(context.editingStaffEmail, null);
  }
  assert.equal(searches, 4);
  const filter = html.match(/id="peopleRoleFilter"[\s\S]*?<\/select>/)[0];
  assert.doesNotMatch(filter, /value="all"/);
  assert.match(html, /id="staffTeamPanel" class="d-none"/);
  assert.match(html, /class="people-results-scroll" tabindex="0" role="region" aria-label="Caregiver search results"/);
});

function wellnessHarness(fetchOverride) {
  let options = [];
  let value = '';
  const select = {
    disabled: false,
    get options() { return options; },
    get value() { return value; },
    set value(next) { value = options.some(o => o.value === next) ? next : ''; },
    set textContent(_) { options = []; value = ''; },
    appendChild(option) { options.push(option); },
  };
  const nodes = { wellnessCaregivers: select, wellnessCaregiverSearch: { value: '' }, wellnessRange: { value: 'quarter' }, wellnessPickerStatus: { textContent: '' }, wellnessChart: { innerHTML: '' } };
  const calls = [];
  const draws = [];
  const caregivers = [{ id: 'one', first_name: 'Example', last_name: 'Alpha', checkins: 3 }, { id: 'two', first_name: 'Example', last_name: 'Beta', checkins: 2 }];
  const reply = data => ({ ok: true, json: async () => ({ ok: true, ...data }) });
  const context = createContext({
    document: { getElementById: id => nodes[id], createElement: () => ({}) },
    URLSearchParams, escapeHtml,
    drawWellnessChart(_chart, data) { draws.push(data); nodes.wellnessChart.innerHTML = data.label || 'chart'; },
    fetch: async url => { calls.push(url); return fetchOverride ? fetchOverride(url, reply) : reply({ caregivers }); },
  });
  runInContext(source.slice(source.indexOf('let wellnessCaregivers = [];'), source.indexOf('function drawWellnessChart(')), context);
  return { context, nodes, select, calls, draws, caregivers, reply };
}

test('wellness name search preserves a visible selection, clears hidden selections and handles no matches', async () => {
  const h = wellnessHarness();
  await h.context.loadWellnessCaregivers();
  assert.equal(h.select.options.length, 2);
  assert.equal(h.select.value, '');
  assert.equal(h.calls.length, 1, 'loading a list does not silently choose a person');
  h.select.value = 'two';
  h.nodes.wellnessCaregiverSearch.value = 'BETA';
  await h.context.filterWellnessCaregivers();
  assert.equal(h.select.options.length, 1);
  assert.equal(h.select.value, 'two');
  assert.match(h.calls.at(-1), /caregiver=two&range=quarter/);
  h.nodes.wellnessCaregiverSearch.value = 'nobody';
  await h.context.filterWellnessCaregivers();
  assert.equal(h.select.value, '');
  assert.equal(h.select.disabled, true);
  assert.match(h.nodes.wellnessPickerStatus.textContent, /No caregivers match/);
  assert.match(h.nodes.wellnessChart.innerHTML, /Choose a caregiver/);
  assert.equal(h.calls.length, 2, 'no result does not fetch an unselected chart');
  h.nodes.wellnessCaregiverSearch.value = '';
  await h.context.filterWellnessCaregivers();
  assert.equal(h.select.disabled, false);
  assert.equal(h.select.options.length, 2);
});

test('wellness selection and range changes ignore slower results for the previous person', async () => {
  let finish;
  const slow = new Promise(resolve => { finish = resolve; });
  const h = wellnessHarness((url, reply) => url === '/api/staff/wellness'
    ? reply({ caregivers: [{ id: 'one' }, { id: 'two' }] })
    : url.includes('caregiver=one') ? slow : reply({ label: 'Current person' }));
  await h.context.loadWellnessCaregivers();
  h.select.value = 'one';
  const first = h.context.showWellnessChart();
  h.select.value = 'two';
  h.nodes.wellnessRange.value = 'month';
  await h.context.showWellnessChart();
  finish(h.reply({ label: 'Previous person' }));
  await first;
  assert.equal(h.nodes.wellnessChart.innerHTML, 'Current person');
  assert.equal(h.draws.length, 1);
  assert.match(h.calls.at(-1), /caregiver=two&range=month/);
});

test('failed wellness refresh clears stale list and chart without automatic retry', async () => {
  let fail = false;
  const h = wellnessHarness((_url, reply) => {
    if (fail) throw new Error('Offline <error>');
    return reply({ caregivers: [{ id: 'one' }] });
  });
  await h.context.loadWellnessCaregivers();
  h.select.value = 'one';
  fail = true;
  await h.context.loadWellnessCaregivers();
  assert.equal(h.select.options.length, 0);
  assert.equal(h.select.disabled, true);
  assert.match(h.nodes.wellnessPickerStatus.textContent, /list unavailable/);
  assert.match(h.nodes.wellnessChart.innerHTML, /Offline &lt;error>/);
  assert.equal(h.calls.length, 2);
});

test('wellness uses native single selection with immediate change handlers and no Show step', () => {
  const picker = html.match(/<select id="wellnessCaregivers"[^>]*>/)[0];
  assert.match(picker, /size="6"/);
  assert.doesNotMatch(picker, /multiple/);
  assert.doesNotMatch(html, /data-action="wellness-show"/);
  for (const id of ['wellnessCaregivers', 'wellnessRange']) {
    assert.ok(source.includes(`getElementById('${id}')?.addEventListener('change', showWellnessChart)`));
  }
  assert.ok(source.includes("getElementById('wellnessCaregiverSearch')?.addEventListener('input', filterWellnessCaregivers)"));
});
