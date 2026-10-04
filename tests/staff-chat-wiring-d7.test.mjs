// Browser-function execution with synthetic DOM/fetch only; no D1, provider or native runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const source = process.env.STAFF_CHAT_TEST_REF
  ? execFileSync('git', ['show', `${process.env.STAFF_CHAT_TEST_REF}:staff.js`], { encoding: 'utf8' })
  : fs.readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
const start = source.includes('function initStaffChatTargets()')
  ? source.indexOf('function initStaffChatTargets()') : source.indexOf('async function confirmAgentChange(');
const code = source.slice(start, source.indexOf('let siteContentItems ='));
const items = [
  { id: 'resource_one', type_id: 'resource', status: 'published', data: '{"title":"Before"}' },
  { id: 'ps_form.membership', type_id: 'page_section', status: 'published', data: '{"heading":"Join"}' },
  { id: 'ps_form.draft', type_id: 'page_section', status: 'draft', data: '{}' },
];

function harness({ area = 'content', target = 'resource_one', event = 'event_one', reply, httpOK = true } = {}) {
  const calls = [], messages = [], nodes = {};
  const create = () => ({ dataset: {}, children: [], innerHTML: '', value: '', options: [],
    appendChild(child) { this.children.push(child); if (child.id) nodes[child.id] = child; if (child.value) this.options.push(child); },
    addEventListener(name, callback) { this[name] = callback; },
  });
  nodes.chatInput = { value: 'Update the title' };
  nodes.chatBody = { appendChild: child => messages.push(child) };
  nodes.chatAreaSelect = { value: area, options: ['content', 'grant', 'caregiver', 'event'].map(value => ({ value })),
    parentElement: create(), appendChild(child) { this.options.push(child); }, addEventListener(name, fn) { this[name] = fn; } };
  nodes.chatContentTarget = { value: target, dataset: { area } };
  const context = vm.createContext({ window: {}, document: { getElementById: id => nodes[id], createElement: create, querySelector: () => null },
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    currentEventId: event, currentCaregiverId: 'caregiver_one', currentGrantId: 7,
    loadStaffConsole: async () => {}, viewCaregiver: async () => {}, setTimeout: callback => callback(),
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: httpOK, json: async () => reply || { ok: true, draft_id: 'draft_one', draft: { data: { title: '<After>' } }, change_id: 'change_one', preview: { before: {}, after: {} } } }; },
  });
  vm.runInContext(`let siteContentItems = ${JSON.stringify(items)};\n${code}`, context);
  return { context, calls, nodes, messages, send: () => context.window.agentSend(), html: () => messages.map(m => m.innerHTML || m.textContent || '').join('') };
}

test('Content drafts the explicitly selected published item through the existing API', async () => {
  const h = harness(); await h.send();
  assert.deepEqual(h.calls, [{ url: '/api/agent/draft', body: { type_id: 'resource', target_id: 'resource_one', request: 'Update the title' } }]);
  assert.match(h.html(), /data-draft-id="draft_one"/);
  assert.match(h.html(), /&lt;After>/);
  assert.doesNotMatch(h.html(), /data-action="agent-confirm"/);
});

test('Forms uses the page_section content pipeline, not the unsupported workflow form area', async () => {
  const h = harness({ area: 'form', target: 'ps_form.membership' }); await h.send();
  assert.equal(h.calls[0].url, '/api/agent/draft');
  assert.deepEqual(h.calls[0].body, { type_id: 'page_section', target_id: 'ps_form.membership', request: 'Update the title' });
  assert.match(h.html(), /Form Copy Update/);
});

test('the existing shell gains a Forms choice and labeled content target without an HTML rewrite', () => {
  const h = harness(); delete h.nodes.chatContentTarget;
  h.context.initStaffChatTargets();
  assert.ok(h.nodes.chatAreaSelect.options.some(o => o.value === 'form'));
  assert.equal(h.nodes.chatContentTargetLabel.htmlFor, 'chatContentTarget');
  assert.match(h.nodes.chatContentTarget.innerHTML, /resource_one/);
  assert.doesNotMatch(h.nodes.chatContentTarget.innerHTML, /ps_form/);
  h.nodes.chatAreaSelect.value = 'form'; h.nodes.chatAreaSelect.change();
  assert.match(h.nodes.chatContentTarget.innerHTML, /ps_form.membership/);
  assert.doesNotMatch(h.nodes.chatContentTarget.innerHTML, /ps_form.draft|resource_one/);
});

for (const [area, target] of [['content', ''], ['content', 'ps_form.membership'], ['form', 'resource_one'], ['form', 'ps_form.draft']]) {
  test(`missing/wrong/unpublished target is refused locally: ${area}/${target}`, async () => {
    const h = harness({ area, target }); await h.send();
    assert.equal(h.calls.length, 0); assert.doesNotMatch(h.html(), /Confirm &amp; publish/);
  });
}

test('Event supplies the selected event ID and labels its preview correctly', async () => {
  const h = harness({ area: 'event' }); await h.send();
  assert.equal(h.calls[0].body.target_id, 'event_one');
  assert.match(h.html(), /Event Update/);
});
test('Event with no selection does not silently create or send a null target', async () => {
  const h = harness({ area: 'event', event: null }); await h.send();
  assert.equal(h.calls.length, 0); assert.match(h.html(), /Select an event/);
});
for (const area of ['caregiver', 'grant']) {
  test(`${area} keeps its existing workflow route and selected target`, async () => {
    const h = harness({ area }); await h.send();
    assert.equal(h.calls[0].url, '/api/agent/change/draft');
    assert.equal(h.calls[0].body.target_id, area === 'grant' ? 7 : 'caregiver_one');
  });
}
for (const reply of [{ ok: false, refusal: 'Unavailable' }, { ok: true }]) {
  test(`a refusal or missing durable draft ID cannot offer confirmation: ${JSON.stringify(reply)}`, async () => {
    const h = harness({ reply }); await h.send();
    assert.doesNotMatch(h.html(), /Confirm &amp; publish/);
  });
}

for (const kind of ['draft', 'change']) {
  for (const action of ['confirm', 'discard']) {
    test(`${kind} ${action} uses the corresponding durable ID and endpoint`, async () => {
      const h = harness(), row = {};
      const button = { getAttribute: name => name === `data-${kind}-id` ? 'saved_id' : null, closest: () => row };
      await h.context[action === 'confirm' ? 'confirmAgentChange' : 'discardAgentChange'](button);
      assert.deepEqual(h.calls, [{ url: `/api/agent/${kind === 'change' ? 'change/' : ''}${action}`, body: { [`${kind}_id`]: 'saved_id' } }]);
      assert.match(row.innerHTML, action === 'confirm' ? /Published/ : /Draft discarded/);
    });
  }
}
for (const kind of ['draft', 'change']) {
  test(`failed ${kind} discard is not presented as successful`, async () => {
    const h = harness({ httpOK: false, reply: { ok: false, error: 'Conflict' } }), row = {};
    await h.context.discardAgentChange({ getAttribute: name => name === `data-${kind}-id` ? 'saved_id' : null, closest: () => row });
    assert.match(row.innerHTML, /Failed: Conflict/); assert.doesNotMatch(row.innerHTML, /Draft discarded/);
  });
}
