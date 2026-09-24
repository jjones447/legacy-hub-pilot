import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(calls[0].options.response_format.json_schema.strict, true);
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
  assert.equal(calls[0].options.response_format.json_schema.schema.oneOf[0].properties.change.properties.operation.enum[0], 'review');
});
