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

function harness({ area = 'content', target = 'resource_one', event = 'event_one', reply, httpOK = true, failFetch = false, storage = new Map(), fetchReply } = {}) {
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
  const context = vm.createContext({ window: { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } }, document: { getElementById: id => nodes[id], createElement: create, querySelector: () => null },
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    currentEventId: event, currentCaregiverId: 'caregiver_one', currentGrantId: 7,
    loadStaffConsole: async () => {}, viewCaregiver: async () => {}, setTimeout: callback => callback(),
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); if (fetchReply) return fetchReply(url, options); if (failFetch) throw new Error('synthetic timeout'); return { ok: httpOK, json: async () => reply || { ok: true, draft_id: 'draft_one', draft: { data: { title: '<After>' } }, change_id: 'change_one', preview: { before: {}, after: {} }, confirmation_preview: { before: { title: 'Before' }, after: { title: '<After>' } }, preview_version: 'a'.repeat(64) } }; },
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

for (const [area, target] of [['content', 'ps_form.membership'], ['form', 'resource_one'], ['form', 'ps_form.draft'], ['auto', 'ps_form.draft']]) {
  test(`wrong/unpublished explicit target is refused locally: ${area}/${target}`, async () => {
    const h = harness({ area, target }); await h.send();
    assert.equal(h.calls.length, 0); assert.doesNotMatch(h.html(), /Confirm &amp; publish/);
  });
}

test('conversation-first default (auto or untargeted area) sends request without mandatory target selection and renders staging preview link', async () => {
  const h = harness({
    area: 'auto',
    target: '',
    reply: {
      ok: true,
      draft_id: 'cid_auto_hero',
      resolved_target_id: 'ps_home.hero',
      target_label: 'Homepage — Hero Banner',
      staging_preview_url: 'https://staging.caregiversanctuary.org/index.html?preview_draft=cid_auto_hero',
      preview_path: '/index.html?preview_draft=cid_auto_hero',
      draft: { data: { section_key: 'home.hero', title: 'New Hero' } },
      confirmation_preview: { before: { section_key: 'home.hero', title: 'Old Hero' }, after: { section_key: 'home.hero', title: 'New Hero' } },
      preview_version: 'b'.repeat(64),
    },
  });
  await h.send();
  assert.deepEqual(h.calls, [{ url: '/api/agent/draft', body: { request: 'Update the title' } }]);
  assert.match(h.html(), /ps_home\.hero/);
  assert.match(h.html(), /Open staging preview ↗/);
  assert.match(h.html(), /https:\/\/staging\.caregiversanctuary\.org\/index\.html\?preview_draft=cid_auto_hero/);
  assert.match(h.html(), /Confirm &amp; publish/);
});

test('ambiguous untargeted request renders clarification candidates without confirmation controls or HOLD', async () => {
  const storage = new Map();
  const h = harness({
    area: 'content',
    target: '',
    storage,
    reply: {
      ok: true,
      clarification_needed: true,
      reason: 'ambiguous_target',
      message: 'Your request matches more than one website section.',
      candidates: [
        { id: 'ps_home.hero', area: 'content', label: 'Homepage — Hero Banner' },
        { id: 'ps_about.hero', area: 'content', label: 'About Page — Hero Banner' },
      ],
    },
  });
  await h.send();
  assert.deepEqual(h.calls, [{ url: '/api/agent/draft', body: { request: 'Update the title', area: 'content' } }]);
  assert.match(h.html(), /Which section should I update\?/);
  assert.match(h.html(), /data-action="agent-select-candidate"/);
  assert.match(h.html(), /Homepage — Hero Banner/);
  assert.doesNotMatch(h.html(), /Confirm &amp; publish/);
  assert.equal(storage.get('agent-confirmation-hold'), undefined);

  // Clicking a candidate populates target selection and restores the request text
  h.nodes.chatInput.value = '';
  h.context.selectAgentCandidateTarget({
    getAttribute: (name) => name === 'data-target-id' ? 'resource_one' : name === 'data-area' ? 'content' : null,
  });
  assert.equal(h.nodes.chatAreaSelect.value, 'content');
  assert.equal(h.nodes.chatContentTarget.value, 'resource_one');
  assert.equal(h.nodes.chatInput.value, 'Update the title');
});

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

// A durable ID alone is not a reviewable proposal. All cases use synthetic replies.
for (const area of ['content', 'form']) {
  for (const draft of [undefined, {}, { data: null }, { data: [] }, { data: 'opaque' }, { data: false }]) {
    test(`${area} missing or malformed after-copy cannot expose confirmation: ${JSON.stringify(draft)}`, async () => {
      const h = harness({ area, target: area === 'form' ? 'ps_form.membership' : 'resource_one',
        reply: { ok: true, draft_id: 'saved_draft', draft } });
      await h.send();
      assert.equal(h.calls.length, 1);
      assert.doesNotMatch(h.html(), /Confirm &amp; publish|data-action="agent-change-confirm"/);
      assert.match(h.html(), /Preview unavailable/);
      assert.match(h.html(), /draft may already exist/i);
      assert.match(h.html(), /Do not retry/);
    });
  }
}
for (const area of ['event', 'caregiver', 'grant']) {
  for (const preview of [undefined, {}, { before: {} }, { after: {} },
    { before: null, after: {} }, { before: {}, after: [] }, { before: 'opaque', after: {} }]) {
    test(`${area} incomplete or malformed workflow preview cannot expose confirmation: ${JSON.stringify(preview)}`, async () => {
      const h = harness({ area, reply: { ok: true, change_id: 'saved_change', preview } });
      await h.send();
      assert.equal(h.calls.length, 1);
      assert.doesNotMatch(h.html(), /Confirm &amp; publish|data-action="agent-change-confirm"/);
      assert.match(h.html(), /Preview unavailable/);
      assert.match(h.html(), /Do not retry/);
    });
  }
}
for (const area of ['content', 'form', 'event', 'caregiver', 'grant']) {
  test(`${area} valid object preview still offers explicit confirmation`, async () => {
    const h = harness({ area, target: area === 'form' ? 'ps_form.membership' : 'resource_one' });
    await h.send();
    assert.equal(h.calls.length, 1);
    assert.match(h.html(), /Confirm &amp; publish/);
    assert.match(h.html(), /data-action="agent-change-discard"/);
  });
}

for (const kind of ['draft', 'change']) {
  for (const action of ['confirm', 'discard']) {
    test(`${kind} ${action} uses the corresponding durable ID and endpoint`, async () => {
      const h = harness(), row = {};
      const button = { getAttribute: name => name === `data-${kind}-id` ? 'saved_id' : name === 'data-preview-version' ? 'a'.repeat(64) : null, closest: () => row };
      await h.context[action === 'confirm' ? 'confirmAgentChange' : 'discardAgentChange'](button);
      assert.deepEqual(h.calls, [{ url: `/api/agent/${kind === 'change' ? 'change/' : ''}${action}`, body: { [`${kind}_id`]: 'saved_id', preview_version: 'a'.repeat(64) } }]);
      assert.match(row.innerHTML, action === 'confirm' ? /Published/ : /Draft discarded/);
    });
  }
}

test('uncertain confirmation blocks repeat, discard, replacement and tab reload', async () => {
  const storage = new Map();
  const h = harness({ failFetch: true, storage });
  const row = {};
  const button = { getAttribute: key => key === 'data-draft-id' ? 'saved_id' : key === 'data-preview-version' ? 'a'.repeat(64) : null, closest: () => row };
  await h.context.confirmAgentChange(button);
  assert.match(row.innerHTML, /Confirmation on hold/);
  await h.context.confirmAgentChange(button);
  await h.context.discardAgentChange(button);
  await h.send();
  assert.equal(h.calls.length, 1);
  const resumed = harness({ storage });
  await resumed.send();
  assert.equal(resumed.calls.length, 0);
});

test('missing server preview version cannot offer a confirming control', async () => {
  const h = harness({ reply: { ok: true, draft_id: 'saved_id', draft: { data: {} }, confirmation_preview: { before: {}, after: {} } } });
  await h.send();
  assert.doesNotMatch(h.html(), /Confirm &amp; publish/);
  assert.match(h.html(), /Do not retry/);
});

for (const kind of ['draft', 'change']) {
  for (const action of ['confirm', 'discard']) {
  for (const outcome of ['success', 'refusal', 'timeout']) {
    test(`pending ${kind} ${action} reserves all caller mutations through ${outcome}`, async () => {
      let resolveFetch, rejectFetch, resolveJSON;
      const pendingFetch = new Promise((resolve, reject) => { resolveFetch = resolve; rejectFetch = reject; });
      const pendingJSON = new Promise(resolve => { resolveJSON = resolve; });
      const storage = new Map();
      const h = harness({ storage, fetchReply: () => pendingFetch });
      const row = {}, otherRow = {};
      const button = (id, ownerRow) => ({ getAttribute: key => key === `data-${kind}-id` ? id : key === 'data-preview-version' ? 'a'.repeat(64) : null, closest: () => ownerRow });
      const first = button('first_saved_id', row), other = button('other_saved_id', otherRow);
      const confirming = h.context[action === 'confirm' ? 'confirmAgentChange' : 'discardAgentChange'](first);
      const assertReserved = async () => {
        const attempts = [h.send(), h.context.discardAgentChange(first),
          h.context.discardAgentChange(other), h.context.confirmAgentChange(other)];
        assert.equal(h.calls.length, 1, 'no draft, discard or different-row confirm while pending');
        await Promise.all(attempts);
        assert.equal(h.messages.length, 0, 'no replacement preview or chat message');
        assert.equal(h.nodes.chatInput.value, 'Update the title', 'blocked draft preserves staff input');
        assert.equal(otherRow.innerHTML, undefined);
      };
      await assertReserved();
      if (outcome === 'timeout') rejectFetch(new Error('synthetic timeout'));
      else {
        resolveFetch({ ok: outcome === 'success', json: () => pendingJSON });
        await Promise.resolve();
        await assertReserved(); // HTTP arrival alone cannot release the reservation.
        resolveJSON({ ok: outcome === 'success', error: 'synthetic refusal' });
      }
      await confirming;
      if (outcome === 'success') {
        assert.match(row.innerHTML, action === 'confirm' ? /Published/ : /Draft discarded/);
        await h.context.discardAgentChange(other);
        assert.equal(h.calls.length, 2, 'qualified success releases the shared reservation');
        assert.equal(storage.get('agent-confirmation-hold'), undefined);
      } else {
        assert.match(row.innerHTML, /Confirmation on hold/);
        await assertReserved();
        assert.equal(storage.get('agent-confirmation-hold'), '1');
        const resumed = harness({ storage });
        await resumed.send();
        await resumed.context.confirmAgentChange(other);
        await resumed.context.discardAgentChange(other);
        assert.equal(resumed.calls.length, 0, 'uncertainty stays on HOLD across reload');
      }
    });
  }
  }
}
for (const kind of ['draft', 'change']) {
  test(`failed ${kind} discard is not presented as successful`, async () => {
    const h = harness({ httpOK: false, reply: { ok: false, error: 'Conflict' } }), row = {};
    await h.context.discardAgentChange({ getAttribute: name => name === `data-${kind}-id` ? 'saved_id' : name === 'data-preview-version' ? 'a'.repeat(64) : null, closest: () => row });
    assert.match(row.innerHTML, /Confirmation on hold/); assert.doesNotMatch(row.innerHTML, /Draft discarded/);
  });
}

test('discard without retained server version stays on HOLD without sending', async () => {
  const h = harness(), row = {};
  await h.context.discardAgentChange({ getAttribute: key => key === 'data-draft-id' ? 'saved_id' : null, closest: () => row });
  assert.equal(h.calls.length, 0);
  assert.match(row.innerHTML, /Confirmation on hold/);
  await h.send();
  assert.equal(h.calls.length, 0);
});
