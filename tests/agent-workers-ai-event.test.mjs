// [pc2-codex-13] Pure/mock Event mapping and handler tests. No native SQLite,
// provider inference, files, credentials or Cloudflare runtime operations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRequestToWorkflowChange } from '../functions/api/agent/_mapper.mjs';
import { validate } from '../functions/_lib/domain/events.js';
import { onRequestPost } from '../functions/api/agent/[[path]].js';

const event = { id: 'ev_synthetic', title: 'Before', type: 'wellness',
  starts_at: '2026-10-15T18:00:00Z', ends_at: null, location: null,
  capacity: 20, recurring: 0, publish_state: 'draft' };
function aiFor(change, calls = []) {
  return { async run(model, options) {
    calls.push({ model, options });
    return { response: JSON.stringify({ change }) };
  } };
}
function map(change, options = {}) {
  return mapRequestToWorkflowChange({ area: 'event', target_id: event.id,
    current: event, request: 'Update title to After', ai: aiFor(change), ...options });
}
function readDb(current = event, registrations = 0) {
  return { prepare(sql) { return { bind() { return this; }, async first() {
    return sql.includes('COUNT(*)') ? { count: registrations } : current;
  } }; } };
}

test('Workers AI maps existing-event update and advertises the constrained Event schema', async () => {
  const calls = [];
  const change = { operation: 'update', payload: { title: 'After', capacity: null } };
  const result = await map(change, { ai: aiFor(change, calls) });
  assert.deepEqual(result, { ok: true, ...change });
  assert.equal(calls.length, 1);
  const schema = calls[0].options.response_format.json_schema;
  assert.equal(schema.name, 'agent_event_workflow_change');
  const operations = schema.schema.oneOf[0].properties.change.oneOf;
  assert.deepEqual(operations.map(b => b.properties.operation.enum[0]), ['create', 'update', 'publish', 'archive']);
  assert.equal(operations[1].properties.payload.additionalProperties, false);
  assert.equal('publish_state' in operations[1].properties.payload.properties, false);
  assert.match(calls[0].options.messages[0].content, /Do not invent missing dates or IDs/);
  const checked = await validate(readDb(), { id: event.id, ...result });
  assert.equal(checked.ok, true);
  assert.equal(checked.projected.title, 'After');
});

test('explicit new-event request maps through existing validation as draft without mapper defaults', async () => {
  const payload = { title: 'Synthetic meeting', type: 'wellness', starts_at: '2026-10-15T18:00:00Z' };
  const result = await map({ operation: 'create', payload }, { target_id: 'new', current: null,
    request: 'Create Synthetic meeting, wellness, 2026-10-15T18:00:00Z' });
  assert.deepEqual(result, { ok: true, operation: 'create', payload });
  assert.equal('id' in result.payload, false);
  const checked = await validate(readDb(null), { id: 'new', ...result });
  assert.equal(checked.ok, true);
  assert.equal(checked.projected.publish_state, 'draft');
  assert.equal(checked.projected.starts_at, payload.starts_at);
});
test('optional new-event ID must be supplied in the request, not invented by the model', async () => {
  const payload = { title: 'Synthetic meeting', type: 'wellness', starts_at: event.starts_at, id: 'ev_explicit' };
  const options = { target_id: 'new', current: null };
  assert.equal((await map({ operation: 'create', payload }, options)).ok, false);
  assert.equal((await map({ operation: 'create', payload }, { ...options,
    request: 'Create Synthetic meeting wellness 2026-10-15T18:00:00Z id ev_explicit' })).ok, true);
});
test('Caregiver and configured gateway precedence remain unchanged', async () => {
  const change = { operation: 'update', payload: { first_name: 'Synthetic' } };
  assert.deepEqual(await mapRequestToWorkflowChange({ area: 'caregiver', target_id: 'cg_synthetic',
    request: 'Update name', current: {}, ai: aiFor(change) }), { ok: true, ...change });
  const originalFetch = globalThis.fetch;
  let gatewayCalls = 0;
  globalThis.fetch = async () => {
    gatewayCalls++;
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{
      function: { name: 'propose_event_update', arguments: '{"title":"Gateway"}' }
    }] } }] }) };
  };
  try {
    const result = await map({}, { gatewayUrl: 'https://gateway.invalid',
      ai: { run: async () => assert.fail('Configured gateway must win') } });
    assert.deepEqual(result, { ok: true, operation: 'update', payload: { title: 'Gateway' } });
    assert.equal(gatewayCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

for (const [operation, request] of [['publish', 'Publish the selected event'], ['archive', 'Archive the selected event']]) {
  test(`explicit ${operation} maps, but model cannot add implicit ${operation}`, async () => {
    const change = { operation, payload: {} };
    assert.equal((await map(change, { request })).ok, true);
    assert.equal((await map(change)).ok, false);
    assert.equal((await map(change, { request: `Do not ${operation} the selected event` })).ok, false);
  });
}

for (const change of [
  { operation: 'delete', payload: {} },
  { operation: 'update', payload: [] },
  { operation: 'update', payload: { id: 'ev_other' } },
  { operation: 'update', payload: { publish_state: 'published' } },
  { operation: 'update', payload: { schema: 'anything' } },
  { operation: 'update', payload: { recurring: 'false' } },
  { operation: 'archive', payload: { confirm_with_registrations: 'true' } },
  { operation: 'update', payload: { title: 'After' }, actor: 'invented' },
  { operation: 'publish', payload: { title: 'Extra' } },
]) {
  test(`invalid Event operation or field is refused: ${JSON.stringify(change)}`, async () => {
    assert.equal((await map(change, { request: 'Publish' })).ok, false);
  });
}
test('existing target cannot create; missing or mismatched selected record cannot update', async () => {
  assert.equal((await map({ operation: 'create', payload: { title: 'Wrong target' } })).ok, false);
  for (const current of [null, { ...event, id: 'ev_other' }]) {
    assert.equal((await map({ operation: 'update', payload: { title: 'After' } }, { current })).ok, false);
  }
});

test('registration override requires explicit token and still passes through domain guard', async () => {
  const change = { operation: 'archive', payload: { confirm_with_registrations: true } };
  assert.equal((await map(change, { request: 'Archive it' })).ok, false);
  assert.equal((await map(change, { request: 'Archive with confirm_with_registrations=false' })).ok, false);
  const approved = await map(change, { request: 'Archive with confirm_with_registrations=true' });
  assert.equal(approved.ok, true);
  assert.equal((await validate(readDb(event, 2), { id: event.id, operation: 'archive', payload: {} })).ok, false);
  assert.equal((await validate(readDb(event, 2), { id: event.id, ...approved })).ok, true);
});

test('shared event validator remains authoritative for dates, required create data and transitions', async () => {
  for (const payload of [{ title: 'Only title' }, { title: 'Bad date', type: 'wellness', starts_at: 'invalid' }]) {
    const result = await map({ operation: 'create', payload }, { target_id: 'new', current: null });
    assert.equal(result.ok, false);
    assert.equal((await validate(readDb(null), { id: 'new', operation: 'create', payload })).ok, false);
  }
  assert.equal((await validate(readDb(), { id: event.id, operation: 'update', payload: { capacity: -1 } })).ok, false);
  assert.equal((await validate(readDb({ ...event, publish_state: 'published' }), { id: event.id, operation: 'publish' })).ok, false);
});

test('model refusal and malformed responses retain existing fail-closed behavior', async () => {
  const refused = await map({}, { ai: { run: async () => ({ response: '{"refusal":"Out of scope"}' }) } });
  assert.deepEqual(refused, { ok: false, refusal: 'Out of scope' });
  let calls = 0;
  assert.equal((await map({}, { ai: { run: async () => { calls++; return { response: 'not JSON' }; } } })).ok, false);
  assert.equal(calls, 2);
});

// Narrow in-memory query mock exercises the unchanged real handler/domain
// pipeline, not actual SQL or Cloudflare D1 atomicity/authentication.
function workflowDb() {
  const state = { event: { ...event }, change: null, audits: [], writes: [] };
  return { state, prepare(sql) {
    let values = [];
    return { bind(...args) { values = args; return this; }, async first() {
      if (sql.includes('FROM event')) return { ...state.event };
      if (sql.includes('FROM agent_change')) return state.change && { ...state.change };
      throw new Error(`Unexpected mock query: ${sql}`);
    }, async run() {
      state.writes.push(sql);
      if (sql.includes('INSERT INTO agent_change')) {
        const [id, area, operation, target_id, payload_json, before_json, after_json, requested_by] = values;
        state.change = { id, area, operation, target_id, payload_json, before_json, after_json, requested_by, status: 'draft' };
      } else if (sql.includes('UPDATE event SET title = ?')) state.event.title = values[0];
      else if (sql.includes('INSERT INTO audit_log')) state.audits.push({ sql, values });
      else if (sql.includes("UPDATE agent_change SET status = 'published'")) state.change.status = 'published';
      else if (sql.includes("UPDATE agent_change SET status = 'discarded'")) state.change.status = 'discarded';
      else throw new Error(`Unexpected mock write: ${sql}`);
      return { success: true };
    } };
  } };
}
async function post(db, action, body, ai = aiFor({ operation: 'update', payload: { title: 'After' } })) {
  const response = await onRequestPost({ request: new Request(`https://synthetic.invalid/api/agent/change/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-dev-actor': 'synthetic@example.invalid' }, body: JSON.stringify(body)
  }), env: { LEGACY_DB: db, AI: ai, ALLOW_DEV_CONSOLE: '1' } });
  return { status: response.status, data: await response.json() };
}
test('Event draft only writes durable draft; confirmation applies selected record and both audit rows', async () => {
  const db = workflowDb();
  const drafted = await post(db, 'draft', { area: 'event', target_id: event.id, request: 'Update title to After' });
  assert.equal(drafted.data.ok, true);
  assert.equal(db.state.event.title, 'Before');
  assert.equal(db.state.audits.length, 0);
  assert.equal(db.state.writes.length, 1);
  assert.equal(drafted.data.preview.before.title, 'Before');
  assert.equal(drafted.data.preview.after.title, 'After');
  const confirmed = await post(db, 'confirm', { change_id: drafted.data.change_id });
  assert.equal(confirmed.data.ok, true);
  assert.equal(db.state.event.title, 'After');
  assert.equal(db.state.change.status, 'published');
  assert.equal(db.state.audits.length, 2);
  assert.ok(db.state.audits.every(a => a.values[0] === 'synthetic@example.invalid'));
  assert.ok(db.state.audits.some(a => a.sql.includes("'event.update'")));
  assert.ok(db.state.audits.some(a => a.sql.includes("'agent_change.confirm'")));
});
test('Event discard leaves domain unchanged; drift refuses confirmation before any apply', async () => {
  const db = workflowDb();
  const drafted = await post(db, 'draft', { area: 'event', target_id: event.id, request: 'Update title' });
  db.state.event.title = 'Changed by another staff member';
  const confirmed = await post(db, 'confirm', { change_id: drafted.data.change_id });
  assert.equal(confirmed.status, 409);
  assert.equal(db.state.audits.length, 0);
  assert.equal(db.state.change.status, 'draft');
  const discarded = await post(db, 'discard', { change_id: drafted.data.change_id });
  assert.equal(discarded.data.ok, true);
  assert.equal(db.state.event.title, 'Changed by another staff member');
  assert.equal(db.state.change.status, 'discarded');
});
test('Event domain validation refusal creates no durable draft or writes', async () => {
  const db = workflowDb();
  const result = await post(db, 'draft', { area: 'event', target_id: event.id, request: 'Set end date' }, aiFor({ operation: 'update', payload: { ends_at: '2026-10-14T18:00:00Z' } }));
  assert.equal(result.data.ok, false);
  assert.equal(db.state.writes.length, 0);
});
