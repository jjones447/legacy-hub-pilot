import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernedAgentTools, GOVERNED_TOOLS } from '../functions/_lib/governed-agent-tools.mjs';

// Fictional source100 targets. Grant77 stands for a returned synthetic ID, never provisioning.
const scope = { applicationId: 'synthetic-app-only', actorId: 'staff@example.invalid', threadId: 'synthetic-thread' };
const targets = [
  { area: 'content', targetId: 'ps_home.hero', typeId: 'page_section', before: { title: 'Synthetic baseline' }, fields: ['title'] },
  { area: 'forms', targetId: 'ps_form.request_support', typeId: 'page_section', before: { name_label: 'Synthetic baseline label' }, fields: ['name_label'] },
  { area: 'caregiver', targetId: 'cg_d7_synthetic_13', fields: ['segment_tags'] },
  { area: 'event', targetId: 'ev_d7_synthetic_13', fields: ['title', 'publish_state'] },
  { area: 'grant', targetId: '77', fields: ['status', 'review_notes'] },
];
const changes = {
  content: { title: 'Synthetic content verified' }, forms: { name_label: 'Synthetic participant name' },
  caregiver: { segment_tags: '["d7_verified"]' }, event: { title: 'Synthetic event verified', publish_state: 'draft' },
  grant: { status: 'in_review', review_notes: 'Synthetic review verified' },
};
const content = area => ['content', 'forms'].includes(area);
function responseFor(target) {
  const id = `synthetic_draft_${target.area}`;
  const before = target.before ?? (target.area === 'grant' ? { status: 'submitted', review_notes: null }
    : target.area === 'event' ? { title: 'Synthetic event baseline', publish_state: 'draft' } : { segment_tags: '[]' });
  const after = changes[target.area];
  return { status: 200, body: content(target.area)
    ? { ok: true, draft_id: id, draft: { id, type_id: 'page_section', status: 'draft', draft_of: target.targetId, data: after }, preview: after }
    : { ok: true, change_id: id, change: { id, area: target.area, target_id: target.targetId, status: 'draft', before, after }, preview: { before, after } } };
}
function setup(overrides = {}) {
  const sent = [];
  let discardIntent = null;
  const options = { scope, targets,
    authorize: async ({ scope: bound, ...intent }) => {
      if (intent.action === 'discard' && !assertionEquals(intent, discardIntent)) return null;
      return { actorKind: 'staff', scope: bound, intent, opaqueCredential: 'fictional-never-exposed' };
    },
    transport: async (_cap, request) => {
      sent.push(structuredClone(request));
      if (request.path.endsWith('/discard')) return { status: 200, body: { ok: true } };
      return responseFor(targets.find(t => t.targetId === request.body.target_id));
    }, ...overrides };
  return { adapter: createGovernedAgentTools(options), sent,
    approveDiscard(target, receipt, request = 'Fictional change') {
      discardIntent = { action: 'discard', area: target.area, targetId: target.targetId,
        draftId: receipt.draft_id, request, preview: receipt.preview };
    } };
}
function assertionEquals(a, b) { try { assert.deepEqual(a, b); return true; } catch { return false; } }
const argsFor = target => ({ area: target.area, target_id: target.targetId, request: 'Fictional change' });

for (const target of targets) {
  test(`${target.area}: exact API fields, original preview and trusted discard only`, async () => {
    const f = setup();
    const receipt = await f.adapter.execute('app_draft', argsFor(target), 'draft-turn');
    assert.equal(receipt.state, 'draft');
    assert.deepEqual(receipt.application, responseFor(target).body);
    assert.deepEqual(f.sent[0], { method: 'POST', path: content(target.area) ? '/api/agent/draft' : '/api/agent/change/draft',
      body: { ...(content(target.area) ? { type_id: 'page_section' } : { area: target.area }), target_id: target.targetId, request: 'Fictional change' } });
    const preview = await f.adapter.execute('app_preview', { draft_id: receipt.draft_id }, 'preview-turn');
    assert.deepEqual(preview.preview, receipt.preview);
    assert.equal(f.sent.length, 1, 'preview does not enumerate other drafts');
    assert.equal((await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'model-no-human')).state, 'refused');
    assert.equal(f.sent.length, 1);
    f.approveDiscard(target, receipt);
    const discarded = await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'staff-discard');
    assert.equal(discarded.state, 'discarded');
    assert.deepEqual(discarded.application, { ok: true });
    assert.deepEqual(f.sent[1].body, { [content(target.area) ? 'draft_id' : 'change_id']: receipt.draft_id });
    assert.equal((await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'second-discard')).state, 'refused');
    assert.equal(f.sent.length, 2);
  });
}

test('model confirmation, direct edits and forged authority are never tools', async () => {
  const f = setup();
  for (const tool of ['confirm', 'app_confirm', 'direct', '/api/agent/confirm']) {
    assert.equal((await f.adapter.execute(tool, { draft_id: 'arbitrary', actorId: scope.actorId }, tool)).reason, 'tool_not_allowed');
  }
  for (const property of ['actor', 'staff_id', 'jwt', 'headers', 'url', 'type_id', 'role', 'sensitivity', 'data', 'audit', 'confirmed']) {
    assert.equal((await f.adapter.execute('app_draft', { ...argsFor(targets[0]), [property]: 'forged' }, property)).state, 'refused');
  }
  assert.deepEqual(GOVERNED_TOOLS.map(t => t.name), ['app_draft', 'app_preview', 'app_discard']);
  assert.equal(f.sent.length, 0);
});

test('unknown target, new target, noncanonical grant and arbitrary drafts refuse', async () => {
  const f = setup();
  for (const target_id of ['other_customer', 'new', 'https://redirect.invalid', '77junk']) {
    assert.equal((await f.adapter.execute('app_draft', { ...argsFor(targets[4]), target_id }, target_id)).state, 'refused');
  }
  for (const tool of ['app_preview', 'app_discard']) assert.equal((await f.adapter.execute(tool, { draft_id: 'other-thread-draft' }, tool)).state, 'refused');
  assert.equal(f.sent.length, 0);
});

for (const bad of ['actor', 'thread', 'application', 'service', 'intent', 'absent']) {
  test(`${bad}: independent authority mismatch refuses before transport`, async () => {
    const f = setup({ authorize: async ({ scope: bound, ...intent }) => {
      if (bad === 'absent') return null;
      return { actorKind: bad === 'service' ? 'service' : 'staff', scope: { ...bound,
        ...(bad === 'actor' ? { actorId: 'other@example.invalid' } : {}),
        ...(bad === 'thread' ? { threadId: 'other-thread' } : {}),
        ...(bad === 'application' ? { applicationId: 'other-app' } : {}) },
        intent: bad === 'intent' ? { ...intent, targetId: 'redirect' } : intent };
    } });
    assert.equal((await f.adapter.execute('app_draft', argsFor(targets[0]), 'call')).state, 'refused');
    assert.equal(f.sent.length, 0);
  });
}

test('sequential and simultaneous same-call delivery awaits exactly one attempt', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let count = 0;
  const f = setup({ transport: async () => { count++; await barrier; return responseFor(targets[0]); } });
  const a = f.adapter.execute('app_draft', argsFor(targets[0]), 'one-call');
  const b = f.adapter.execute('app_draft', argsFor(targets[0]), 'one-call');
  release();
  assert.deepEqual(await a, await b);
  const receipt = await f.adapter.execute('app_draft', argsFor(targets[0]), 'one-call');
  assert.equal(count, 1);
  receipt.preview.after.title = 'tampered';
  assert.equal((await f.adapter.execute('app_draft', argsFor(targets[0]), 'one-call')).preview.after.title, 'Synthetic content verified');
  assert.equal((await f.adapter.execute('app_draft', { ...argsFor(targets[0]), request: 'different' }, 'one-call')).reason, 'call_identity_conflict');
});

test('different concurrent calls cannot race to create two drafts', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let count = 0;
  const f = setup({ authorize: async ({ scope: bound, ...intent }) => { await barrier; return { actorKind: 'staff', scope: bound, intent }; },
    transport: async () => { count++; return responseFor(targets[0]); } });
  const a = f.adapter.execute('app_draft', argsFor(targets[0]), 'first');
  assert.equal((await f.adapter.execute('app_draft', argsFor(targets[1]), 'second')).reason, 'another_operation_pending');
  release(); await a;
  assert.equal(count, 1);
  assert.equal((await f.adapter.execute('app_draft', argsFor(targets[1]), 'replacement')).state, 'refused');
});

for (const mode of ['timeout', 'http500', 'missing-preview', 'redirect-target', 'outside-fields']) {
  test(`${mode}: uncertain persisted draft latches HOLD, without retry/replacement/discard`, async () => {
    let count = 0;
    const f = setup({ transport: async () => {
      count++;
      if (mode === 'timeout') throw new Error('never leak private exception');
      const response = responseFor(targets[0]);
      if (mode === 'http500') response.status = 500;
      if (mode === 'missing-preview') delete response.body.draft.data;
      if (mode === 'redirect-target') response.body.draft.draft_of = 'other-customer';
      if (mode === 'outside-fields') response.body.draft.data = { ...response.body.draft.data, contact: 'forbidden' };
      return response;
    } });
    assert.equal((await f.adapter.execute('app_draft', argsFor(targets[0]), 'draft')).state, 'hold');
    for (const call of [['app_draft', argsFor(targets[0]), 'draft'], ['app_draft', argsFor(targets[1]), 'replacement'], ['app_discard', { draft_id: 'synthetic_draft_content' }, 'discard']]) {
      assert.equal((await f.adapter.execute(...call)).state, 'hold');
    }
    assert.equal(count, 1);
  });
}

test('trusted uncertain-confirm latch blocks all operations and cannot be reset by model', async () => {
  const f = setup();
  const receipt = await f.adapter.execute('app_draft', argsFor(targets[0]), 'draft');
  f.approveDiscard(targets[0], receipt);
  f.adapter.holdForReconciliation();
  for (const tool of ['app_draft', 'app_preview', 'app_discard', 'app_confirm']) {
    assert.equal((await f.adapter.execute(tool, tool === 'app_draft' ? argsFor(targets[0]) : { draft_id: receipt.draft_id }, tool)).state, 'hold');
  }
  assert.equal(f.sent.length, 1);
  assert.equal(JSON.stringify(receipt).includes('fictional-never-exposed'), false);
});

test('HOLD during asynchronous admission prevents the admitted write', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const f = setup({ authorize: async ({ scope: bound, ...intent }) => { await barrier; return { actorKind: 'staff', scope: bound, intent }; } });
  const pending = f.adapter.execute('app_draft', argsFor(targets[0]), 'draft');
  f.adapter.holdForReconciliation(); release();
  assert.equal((await pending).state, 'hold');
  assert.equal(f.sent.length, 0);
});

test('application refusal stays original evidence without fabricated draft/audit', async () => {
  const original = { ok: false, refusal: 'Synthetic schema refuses request' };
  const f = setup({ transport: async () => ({ status: 200, body: original }) });
  assert.deepEqual(await f.adapter.execute('app_draft', argsFor(targets[0]), 'call'), {
    ok: false, state: 'refused', reason: 'application_refusal', application: original,
  });
});

test('public tool descriptions cannot mutate the executable area allowlist', () => {
  assert.throws(() => GOVERNED_TOOLS[0].parameters.properties.area.enum.push('secret-admin'), TypeError);
  assert.throws(() => { GOVERNED_TOOLS[0].parameters.additionalProperties = true; }, TypeError);
});

test('discard authorization must bind exact request and preview, not just a yes', async () => {
  const f = setup();
  const receipt = await f.adapter.execute('app_draft', argsFor(targets[0]), 'draft');
  f.approveDiscard(targets[0], { ...receipt, preview: { before: {}, after: {} } });
  assert.equal((await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'wrong-preview')).state, 'refused');
  f.approveDiscard(targets[0], receipt, 'Different original request');
  assert.equal((await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'wrong-request')).state, 'refused');
  assert.equal(f.sent.length, 1);
});

for (const mismatch of ['actorId', 'threadId', 'applicationId', 'targetId']) {
  test(`discard ${mismatch} mismatch cannot use an otherwise valid draft ID`, async () => {
    let corrupted = false;
    const f = setup({ authorize: async ({ scope: bound, ...intent }) => ({ actorKind: 'staff',
      scope: { ...bound, ...(corrupted && mismatch !== 'targetId' ? { [mismatch]: 'other' } : {}) },
      intent: { ...intent, ...(corrupted && mismatch === 'targetId' ? { targetId: 'other' } : {}) } }) });
    const receipt = await f.adapter.execute('app_draft', argsFor(targets[0]), 'draft');
    corrupted = true;
    assert.equal((await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'discard')).state, 'refused');
    assert.equal(f.sent.length, 1);
  });
}

test('uncloneable response after a write becomes HOLD instead of escaping to retry', async () => {
  let count = 0;
  const f = setup({ transport: async () => { count++; return { status: 200, body: { ok: true, invalid: () => {} } }; } });
  assert.equal((await f.adapter.execute('app_draft', argsFor(targets[0]), 'first')).state, 'hold');
  assert.equal((await f.adapter.execute('app_draft', argsFor(targets[0]), 'replacement')).state, 'hold');
  assert.equal(count, 1);
});

test('uncertain discard blocks duplicate discard and replacement draft', async () => {
  let count = 0;
  const f = setup({ transport: async (_cap, request) => { count++;
    if (request.path.endsWith('/discard')) throw new Error('discard outcome unknown');
    return responseFor(targets[0]);
  } });
  const receipt = await f.adapter.execute('app_draft', argsFor(targets[0]), 'draft');
  f.approveDiscard(targets[0], receipt);
  assert.equal((await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'discard')).state, 'hold');
  assert.equal((await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'discard')).state, 'hold');
  assert.equal((await f.adapter.execute('app_draft', argsFor(targets[0]), 'replacement')).state, 'hold');
  assert.equal(count, 2);
});

test('server cannot rebind a previously discarded ID to a different request', async () => {
  const f = setup();
  const receipt = await f.adapter.execute('app_draft', argsFor(targets[0]), 'first');
  f.approveDiscard(targets[0], receipt);
  await f.adapter.execute('app_discard', { draft_id: receipt.draft_id }, 'discard');
  assert.equal((await f.adapter.execute('app_draft', { ...argsFor(targets[0]), request: 'Another change' }, 'second')).state, 'hold');
});
