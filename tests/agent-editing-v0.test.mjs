// Slice 07 tests — Site-builder agent editing loop v0.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_4 = readFileSync(new URL('../schema/0004_content_types.sql', import.meta.url), 'utf8');

function d1(db) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              return db.prepare(sql).get(...params) ?? null;
            },
            async run() {
              return db.prepare(sql).run(...params);
            },
            async all() {
              return { results: db.prepare(sql).all(...params) };
            }
          };
        },
        async first() {
          return db.prepare(sql).get() ?? null;
        },
        async run() {
          return db.prepare(sql).run();
        },
        async all() {
          return { results: db.prepare(sql).all() };
        }
      };
    }
  };
}

let raw;
let env;

// Deterministic mock LLM mapper backend
const mockBackend = ({ request, contentType }) => {
  if (request.includes('tamper code') || request.includes('injection')) {
    return { ok: false, refusal: 'Refused request to edit routing code' };
  }
  if (contentType.id === 'resource') {
    if (request.includes('invalid link')) {
      return { ok: true, change: { title: 'Help', description: 'desc', category: 'crisis', link_or_file: 9999 } }; // Invalid link type
    }
    return { ok: true, change: { title: 'Crisis Helpline', description: 'Call 988', category: 'crisis' } };
  }
  if (contentType.id === 'page_section') {
    if (request.includes('invalid heading')) {
      return { ok: true, change: { section_key: 'home_hero', heading: 12345, body: 'Valid body' } }; // heading type must be string
    }
    return { ok: true, change: { section_key: 'home_hero', heading: 'Welcome Hero', body: 'This is the hero body' } };
  }
  return { ok: false, refusal: 'Unknown content type' };
};

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_4);
  env = {
    LEGACY_DB: d1(raw),
    AGENT_MAPPER_BACKEND: mockBackend
  };
});

test('POST /api/agent/draft maps NL request to draft and returns preview', async () => {
  const req = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      request: 'Add a crisis resource for the helpline',
      type_id: 'resource'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ok);
  assert.ok(data.draft_id);
  assert.equal(data.preview.title, 'Crisis Helpline');

  const item = raw.prepare(`SELECT * FROM content_item WHERE id = ?`).get(data.draft_id);
  assert.ok(item);
  assert.equal(item.status, 'draft');
  assert.equal(JSON.parse(item.data).title, 'Crisis Helpline');
});

test('POST /api/agent/draft rejects schema-invalid proposals', async () => {
  const req = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      request: 'Add resource with invalid link',
      type_id: 'resource'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.ok(data.refusal.includes('fails schema validation'));

  // Ensure no draft was created
  const count = raw.prepare(`SELECT COUNT(*) AS n FROM content_item`).get();
  assert.equal(count.n, 0);
});

test('POST /api/agent/draft handles agent refusal', async () => {
  const req = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      request: 'tamper code',
      type_id: 'resource'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.refusal, 'Refused request to edit routing code');
});

test('POST /api/agent/confirm requires staff identity and publishes + audits', async () => {
  // Let's create a draft first
  const draftId = 'ci_test_draft';
  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES ('ci_test_draft', 'resource', '{"title":"Helpline","description":"988","category":"crisis"}', 'draft', 'agent')
  `).run();

  // Try to confirm without staff_id -> reject with 400
  const reqFail = new Request('http://localhost/api/agent/confirm', {
    method: 'POST',
    body: JSON.stringify({ draft_id: draftId })
  });
  const resFail = await postAgent({ request: reqFail, env });
  assert.equal(resFail.status, 400);

  // Confirm with staff_id -> success
  const reqSuccess = new Request('http://localhost/api/agent/confirm', {
    method: 'POST',
    body: JSON.stringify({ draft_id: draftId, staff_id: 'st_jacob' })
  });
  const resSuccess = await postAgent({ request: reqSuccess, env });
  assert.equal(resSuccess.status, 200);

  const item = raw.prepare(`SELECT status, updated_by FROM content_item WHERE id = ?`).get(draftId);
  assert.equal(item.status, 'published');
  assert.equal(item.updated_by, 'staff_st_jacob');

  const audit = raw.prepare(`SELECT * FROM audit_log WHERE entity = 'content_item' AND entity_id = ?`).get(draftId);
  assert.ok(audit);
  assert.equal(audit.actor, 'st_jacob');
  assert.equal(audit.action, 'content_item.publish');
});

test('POST /api/agent/discard archives draft + audits', async () => {
  const draftId = 'ci_test_draft';
  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES ('ci_test_draft', 'resource', '{"title":"Helpline","description":"988","category":"crisis"}', 'draft', 'agent')
  `).run();

  const req = new Request('http://localhost/api/agent/discard', {
    method: 'POST',
    body: JSON.stringify({ draft_id: draftId })
  });
  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);

  const item = raw.prepare(`SELECT status FROM content_item WHERE id = ?`).get(draftId);
  assert.equal(item.status, 'archived');

  const audit = raw.prepare(`SELECT * FROM audit_log WHERE entity = 'content_item' AND entity_id = ?`).get(draftId);
  assert.ok(audit);
  assert.equal(audit.action, 'content_item.discard');
});

test('workflow rejects illegal transitions with 409', async () => {
  const publishedId = 'ci_published';
  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES ('ci_published', 'resource', '{"title":"Helpline","description":"988","category":"crisis"}', 'published', 'staff')
  `).run();

  const req = new Request('http://localhost/api/agent/confirm', {
    method: 'POST',
    body: JSON.stringify({ draft_id: publishedId, staff_id: 'st_jacob' })
  });
  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 409);
});

test('GET /api/agent/drafts returns list of pending drafts only', async () => {
  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES 
      ('ci_draft_1', 'resource', '{"title":"Helpline 1","description":"988","category":"crisis"}', 'draft', 'agent'),
      ('ci_published_1', 'resource', '{"title":"Helpline 2","description":"988","category":"crisis"}', 'published', 'staff')
  `).run();

  const res = await getAgent({ request: new Request('http://localhost/api/agent/drafts'), env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.ok);
  assert.equal(data.drafts.length, 1);
  assert.equal(data.drafts[0].id, 'ci_draft_1');
});

test('gateway client returns graceful refusal when EMP_LLM_GATEWAY_URL is unset', async () => {
  const req = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      request: 'Add a helpline',
      type_id: 'resource'
    })
  });

  const noGatewayEnv = {
    LEGACY_DB: d1(raw)
  };

  const res = await postAgent({ request: req, env: noGatewayEnv });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.refusal, 'inference unavailable — gateway not configured');
});

test('gateway client POSTs OpenAI-shaped request to EMP_LLM_GATEWAY_URL and parses tool_calls', async () => {
  const originalFetch = globalThis.fetch;

  let fetchCalled = false;
  let requestHeaders = null;
  let requestBody = null;

  globalThis.fetch = async (url, options) => {
    fetchCalled = true;
    assert.equal(url, 'https://gateway.internal/v1/chat/completions');
    assert.equal(options.method, 'POST');
    requestHeaders = options.headers;
    requestBody = JSON.parse(options.body);

    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'propose_change',
                  arguments: JSON.stringify({
                    title: 'Gateway Helpline',
                    description: 'Direct call',
                    category: 'crisis'
                  })
                }
              }
            ]
          }
        }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const req = new Request('http://localhost/api/agent/draft', {
      method: 'POST',
      body: JSON.stringify({
        request: 'Add a gateway helpline',
        type_id: 'resource',
        role: 'bulk',
        sensitivity: 'low'
      })
    });

    const gatewayEnv = {
      LEGACY_DB: d1(raw),
      EMP_LLM_GATEWAY_URL: 'https://gateway.internal/v1/chat/completions',
      EMP_LLM_GATEWAY_KEY: 'test-key-123'
    };

    const res = await postAgent({ request: req, env: gatewayEnv });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.ok);
    assert.equal(data.preview.title, 'Gateway Helpline');

    assert.ok(fetchCalled);
    assert.equal(requestHeaders['authorization'], 'Bearer test-key-123');
    assert.equal(requestHeaders['x-emp-role'], 'bulk');
    assert.equal(requestHeaders['x-emp-sensitivity'], 'low');

    assert.equal(requestBody.role, 'bulk');
    assert.equal(requestBody.sensitivity, 'low');
    assert.ok(requestBody.messages);
    assert.equal(requestBody.tools[0].type, 'function');
    assert.equal(requestBody.tools[0].function.name, 'propose_change');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gateway client handles refuse_request tool call from gateway', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'refuse_request',
                  arguments: JSON.stringify({
                    reason: 'Refused: unsafe content detected'
                  })
                }
              }
            ]
          }
        }
      ]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const req = new Request('http://localhost/api/agent/draft', {
      method: 'POST',
      body: JSON.stringify({
        request: 'unsafe request',
        type_id: 'resource'
      })
    });

    const gatewayEnv = {
      LEGACY_DB: d1(raw),
      EMP_LLM_GATEWAY_URL: 'https://gateway.internal/v1/chat/completions'
    };

    const res = await postAgent({ request: req, env: gatewayEnv });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.refusal, 'Refused: unsafe content detected');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
