import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_CAREGIVER_UPDATE_FIELDS } from '../functions/_lib/domain/caregivers.js';
import {
  DEFAULT_WORKERS_AI_MODEL,
  WORKERS_AI_MAX_REQUEST_CHARS,
  WORKERS_AI_MAX_TOKENS,
  mapRequestToChange,
  mapRequestToWorkflowChange
} from '../functions/api/agent/_mapper.mjs';

const contentType = {
  id: 'resource',
  json_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' }
    },
    required: ['title'],
    additionalProperties: false
  }
};

function fakeAi(responses, calls = []) {
  return {
    calls,
    async run(model, options) {
      calls.push({ model, options });
      const next = responses.shift();
      return typeof next === 'function' ? next(model, options) : next;
    }
  };
}

test('backend precedence is function, explicit gateway, then Workers AI', async () => {
  let functionCalls = 0;
  const functionBackend = () => {
    functionCalls += 1;
    return { ok: true, change: { title: 'function' } };
  };
  const calls = [];
  const ai = fakeAi([{ response: JSON.stringify({ change: { title: 'ai' } }) }], calls);

  const result = await mapRequestToChange({
    request: 'update title',
    contentType,
    current: null,
    backend: functionBackend,
    gatewayUrl: 'https://gateway.invalid',
    ai
  });

  assert.deepEqual(result, { ok: true, change: { title: 'function' } });
  assert.equal(functionCalls, 1);
  assert.equal(calls.length, 0);
});

test('explicit gateway opt-in wins over a bound Workers AI backend', async () => {
  const calls = [];
  const ai = fakeAi([{ response: JSON.stringify({ change: { title: 'ai' } }) }], calls);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [{ message: { tool_calls: [{ function: { name: 'propose_change', arguments: JSON.stringify({ title: 'gateway' }) } }] } }]
      };
    }
  });
  try {
    const result = await mapRequestToChange({
      request: 'update title',
      contentType,
      current: null,
      backend: 'gateway',
      gatewayUrl: 'https://gateway.invalid',
      ai
    });
    assert.deepEqual(result, { ok: true, change: { title: 'gateway' } });
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Workers AI content backend returns a schema-envelope change', async () => {
  const calls = [];
  const ai = fakeAi([{ response: JSON.stringify({ change: { title: 'AI helpline' } }) }], calls);

  const result = await mapRequestToChange({
    request: 'add an AI helpline',
    contentType,
    current: null,
    ai,
    model: '@cf/test/model'
  });

  assert.deepEqual(result, { ok: true, change: { title: 'AI helpline' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, '@cf/test/model');
  assert.equal(calls[0].options.max_tokens, WORKERS_AI_MAX_TOKENS);
  assert.equal(calls[0].options.response_format.type, 'json_schema');
  assert.deepEqual(calls[0].options.response_format.json_schema, {
    oneOf: [
      { type: 'object', properties: { change: contentType.json_schema }, required: ['change'], additionalProperties: false },
      { type: 'object', properties: { refusal: { type: 'string' } }, required: ['refusal'], additionalProperties: false }
    ]
  });
});

test('Workers AI refusal is passed through without a second call', async () => {
  const calls = [];
  const ai = fakeAi([{ response: JSON.stringify({ refusal: 'out of scope' }) }], calls);

  const result = await mapRequestToChange({
    request: 'change the auth system',
    contentType,
    current: null,
    ai
  });

  assert.deepEqual(result, { ok: false, refusal: 'out of scope' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, DEFAULT_WORKERS_AI_MODEL);
});

test('malformed Workers AI JSON retries once and then refuses', async () => {
  const calls = [];
  const ai = fakeAi([{ response: 'not json' }, { response: '{"unexpected":true}' }], calls);

  const result = await mapRequestToChange({
    request: 'produce a resource',
    contentType,
    current: null,
    ai
  });

  assert.deepEqual(result, { ok: false, refusal: 'Workers AI returned malformed JSON after one retry' });
  assert.equal(calls.length, 2);
  assert.match(calls[1].options.messages.at(-1).content, /malformed/);
});

test('oversize Workers AI request is capped before invocation', async () => {
  const calls = [];
  const ai = fakeAi([{ response: JSON.stringify({ change: { title: 'capped' } }) }], calls);
  const request = 'x'.repeat(WORKERS_AI_MAX_REQUEST_CHARS + 5000);

  const result = await mapRequestToChange({ request, contentType, current: null, ai });

  assert.equal(result.ok, true);
  const userMessage = calls[0].options.messages.find((message) => message.role === 'user').content;
  assert.ok(userMessage.length < request.length);
  assert.match(userMessage, /request truncated by safety limit/);
  const requestPart = userMessage.split('Request: ')[1];
  assert.ok(requestPart.length <= WORKERS_AI_MAX_REQUEST_CHARS + 100);
});

test('Workers AI backend serves the workflow mapper through the same selection', async () => {
  const calls = [];
  const ai = fakeAi([{ response: JSON.stringify({ change: { operation: 'review', payload: { review_notes: 'verified' } } }) }], calls);

  const result = await mapRequestToWorkflowChange({
    area: 'grant',
    target_id: '1',
    request: 'review the grant',
    current: { status: 'submitted' },
    ai
  });

  assert.deepEqual(result, { ok: true, operation: 'review', payload: { review_notes: 'verified' } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.response_format.json_schema.oneOf[0].properties.change.properties.operation.enum,
    ['review', 'decision', 'course_complete', 'close']);
});

// Native Workers AI JSON Mode returns an object under response, unlike the
// separately configured gateway's tool-call contract. All inference is mocked.
for (const [name, envelope, expected] of [
  ['change', { change: { title: 'Native object' } }, { ok: true, change: { title: 'Native object' } }],
  ['refusal', { refusal: 'Out of scope' }, { ok: false, refusal: 'Out of scope' }]
]) {
  test(`native object ${name} is handled in one inference call`, async () => {
    const calls = [];
    const ai = fakeAi([{ response: envelope, usage: { total_tokens: 25 } }], calls);
    assert.deepEqual(await mapRequestToChange({ request: 'Update title', contentType, ai }), expected);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, DEFAULT_WORKERS_AI_MODEL);
    assert.equal(calls[0].options.max_tokens, 800);
  });
}

for (const [name, result] of [
  ['raw JSON string', '{"change":{"title":"Compatible"}}'],
  ['raw envelope', { change: { title: 'Compatible' } }],
  ['response string', { response: '{"change":{"title":"Compatible"}}' }],
  ['result string', { result: '{"change":{"title":"Compatible"}}' }],
  ['message string', { choices: [{ message: { content: '{"change":{"title":"Compatible"}}' } }] }]
]) {
  test(`existing ${name} compatibility is retained`, async () => {
    const calls = [];
    assert.deepEqual(await mapRequestToChange({ request: 'Update title', contentType, ai: fakeAi([result], calls) }),
      { ok: true, change: { title: 'Compatible' } });
    assert.equal(calls.length, 1);
  });
}

for (const [name, response] of [
  ['null', null], ['array', [{ change: { title: 'Wrong container' } }]],
  ['empty object', {}], ['dual keys', { change: { title: 'Ambiguous' }, refusal: 'No' }],
  ['extra envelope key', { change: { title: 'Extra' }, actor: 'invented' }],
  ['null change', { change: null }], ['array change', { change: [] }],
  ['empty refusal', { refusal: '   ' }], ['nonstring refusal', { refusal: {} }],
  ['nested response wrapper', { response: { change: { title: 'Too deeply wrapped' } } }]
]) {
  test(`native ${name} remains malformed with at most two inference calls`, async () => {
    const calls = [];
    const result = await mapRequestToChange({ request: 'Update title', contentType,
      ai: fakeAi([{ response }, { response }], calls) });
    assert.deepEqual(result, { ok: false, refusal: 'Workers AI returned malformed JSON after one retry' });
    assert.equal(calls.length, 2);
    assert.match(calls[1].options.messages.at(-1).content, /malformed/);
  });
}

test('malformed native object can recover on the one existing retry, never a third', async () => {
  const calls = [];
  const result = await mapRequestToChange({ request: 'Update title', contentType,
    ai: fakeAi([{ response: { unexpected: true } }, { response: { change: { title: 'Recovered' } } }], calls) });
  assert.deepEqual(result, { ok: true, change: { title: 'Recovered' } });
  assert.equal(calls.length, 2);
});

test('native provider exception refuses after one call without another backend', async () => {
  const calls = [];
  const result = await mapRequestToChange({ request: 'Update title', contentType,
    ai: fakeAi([() => { throw new Error('Mock inference unavailable'); }], calls) });
  assert.deepEqual(result, { ok: false, refusal: 'Workers AI inference failed: Mock inference unavailable' });
  assert.equal(calls.length, 1);
});

test('native grant object change retains the workflow operation and single call', async () => {
  const calls = [];
  const change = { operation: 'review', payload: { review_notes: 'Synthetic review' } };
  const result = await mapRequestToWorkflowChange({ area: 'grant', target_id: '1', request: 'Review the grant',
    current: { status: 'submitted' }, ai: fakeAi([{ response: { change } }], calls) });
  assert.deepEqual(result, { ok: true, ...change });
  assert.equal(calls.length, 1);
});

test('Workers AI caregiver mapper advertises constrained schema without id and strips echoed selected id/unchanged fields', async () => {
  const calls = [];
  const current = {
    id: 'cg_demo_thu_20261029_1',
    first_name: 'DEMO A',
    last_name: 'FICTIONAL',
    email: 'demo.a.20261029@example.invalid',
    phone: '555-0191',
    preferred_contact: 'email',
    sanctuary_member: 0,
    source: 'staff',
    caring_for: 'Spouse (Fictional Demo)',
    relationship: 'Spouse',
    segment_tags: '["fictional_demo","dementia"]',
    status: 'inactive',
    outcome_status: 'stable',
    outcome_notes: 'Fictional demonstration caregiver record.',
    created_at: '2026-10-27 18:36:08',
    updated_at: '2026-10-27 18:36:08'
  };
  const ai = fakeAi([{
    response: {
      change: {
        operation: 'update',
        payload: {
          id: 'cg_demo_thu_20261029_1',
          first_name: 'DEMO A PREVIEW ONLY',
          last_name: 'FICTIONAL',
          status: 'inactive',
          segment_tags: ['fictional_demo', 'dementia']
        }
      }
    }
  }], calls);

  const result = await mapRequestToWorkflowChange({
    area: 'caregiver',
    target_id: 'cg_demo_thu_20261029_1',
    request: 'For this selected fictional demonstration caregiver, propose changing only first_name from DEMO A to DEMO A PREVIEW ONLY. Leave every other field unchanged.',
    current,
    ai
  });

  assert.deepEqual(result, {
    ok: true,
    operation: 'update',
    payload: { first_name: 'DEMO A PREVIEW ONLY' }
  });
  assert.equal(calls.length, 1);
  const changeSchema = calls[0].options.response_format.json_schema.oneOf[0].properties.change;
  assert.deepEqual(changeSchema.properties.operation.enum, ['update']);
  assert.equal(changeSchema.properties.payload.additionalProperties, false);
  assert.deepEqual(Object.keys(changeSchema.properties.payload.properties), ALLOWED_CAREGIVER_UPDATE_FIELDS);
  assert.equal('id' in changeSchema.properties.payload.properties, false);
  const systemMessage = calls[0].options.messages[0].content;
  assert.match(systemMessage, /Selected caregiver ID: cg_demo_thu_20261029_1/);
  assert.match(systemMessage, /Do not include id, unchanged fields, or system metadata in payload/);
  assert.doesNotMatch(systemMessage, /"id":"cg_demo_thu_20261029_1"/);
  assert.doesNotMatch(systemMessage, /"created_at"/);
});

for (const [name, change, overrides] of [
  ['mismatched id in payload', { operation: 'update', payload: { id: 'cg_other', first_name: 'DEMO A PREVIEW ONLY' } }, {}],
  ['id-only payload without allowed changes', { operation: 'update', payload: { id: 'cg_demo_thu_20261029_1' } }, {}],
  ['unchanged-only payload', { operation: 'update', payload: { first_name: 'DEMO A' } }, {}],
  ['explicit id mutation request', { operation: 'update', payload: { id: 'cg_demo_thu_20261029_1', first_name: 'DEMO A PREVIEW ONLY' } }, { request: 'Change caregiver id to cg_demo_thu_20261029_1 and first_name to DEMO A PREVIEW ONLY' }],
  ['forbidden created_at field', { operation: 'update', payload: { first_name: 'DEMO A PREVIEW ONLY', created_at: '2020-01-01' } }, {}],
  ['forbidden actor field in payload', { operation: 'update', payload: { first_name: 'DEMO A PREVIEW ONLY', actor: 'spoofed' } }, {}],
  ['forbidden sanctuary_member field', { operation: 'update', payload: { first_name: 'DEMO A PREVIEW ONLY', sanctuary_member: 1 } }, {}],
  ['extra actor key on change envelope', { operation: 'update', payload: { first_name: 'DEMO A PREVIEW ONLY' }, actor: 'spoofed' }, {}],
  ['invalid caregiver operation', { operation: 'delete', payload: { first_name: 'DEMO A PREVIEW ONLY' } }, {}],
  ['empty first_name', { operation: 'update', payload: { first_name: '   ' } }, {}],
  ['mismatched current record id', { operation: 'update', payload: { first_name: 'DEMO A PREVIEW ONLY' } }, { current: { id: 'cg_other', first_name: 'DEMO A' } }],
  ['missing current record', { operation: 'update', payload: { first_name: 'DEMO A PREVIEW ONLY' } }, { current: null }]
]) {
  test(`Workers AI caregiver mapper refuses ${name}`, async () => {
    const calls = [];
    const result = await mapRequestToWorkflowChange({
      area: 'caregiver',
      target_id: 'cg_demo_thu_20261029_1',
      request: 'Update first_name to DEMO A PREVIEW ONLY',
      current: { id: 'cg_demo_thu_20261029_1', first_name: 'DEMO A' },
      ai: fakeAi([{ response: { change } }], calls),
      ...overrides
    });
    assert.equal(result.ok, false);
    assert.equal(calls.length, 1);
  });
}
