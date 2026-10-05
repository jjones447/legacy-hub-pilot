// Slice 07 tests — Site-builder agent editing loop v0.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';
import { getPublishedSections, _resetContentCache } from '../functions/_content.mjs';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_4 = readFileSync(new URL('../schema/0004_content_types.sql', import.meta.url), 'utf8');

function d1(db) {
  return {
    // Synthetic SQLite transaction/results model, not native D1 acceptance.
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params }) => {
          const statement = db.prepare(sql);
          if (statement.columns().length) return { success: true, results: statement.all(...params), meta: {} };
          const result = statement.run(...params);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    prepare(sql) {
      return {
        sql, params: [],
        bind(...params) {
          return {
            sql, params,
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
  raw.exec('ALTER TABLE content_item ADD COLUMN draft_of TEXT;');
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

  // Missing draft_id -> 400 (staff_id is no longer required — actor comes from identity)
  const reqFail = new Request('http://localhost/api/agent/confirm', {
    method: 'POST',
    body: JSON.stringify({})
  });
  const resFail = await postAgent({ request: reqFail, env });
  assert.equal(resFail.status, 400);

  // Confirm with a verified CF Access identity. The JWT is signature-verified by
  // _middleware.js before reaching here; the endpoint decodes it for the email.
  // SEC-2: a client-supplied staff_id in the body must be IGNORED (spoof attempt).
  const reqSuccess = new Request('http://localhost/api/agent/confirm', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': 'h.eyJlbWFpbCI6InN0YWZmQGV4YW1wbGUub3JnIn0.sig' }, // email: staff@example.org
    body: JSON.stringify({ draft_id: draftId, staff_id: 'attacker_spoof' })
  });
  const resSuccess = await postAgent({ request: reqSuccess, env });
  assert.equal(resSuccess.status, 200);

  const item = raw.prepare(`SELECT status, updated_by FROM content_item WHERE id = ?`).get(draftId);
  assert.equal(item.status, 'published');
  assert.equal(item.updated_by, 'staff_staff@example.org'); // from identity, NOT 'attacker_spoof'

  const audit = raw.prepare(`SELECT * FROM audit_log WHERE entity = 'content_item' AND entity_id = ?`).get(draftId);
  assert.ok(audit);
  assert.equal(audit.actor, 'staff@example.org'); // verified identity, not the body
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
      AGENT_MAPPER_BACKEND: 'gateway',
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
      AGENT_MAPPER_BACKEND: 'gateway',
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

// Regression home for the existing Content/Form editing mutation contract.
// All data and trigger failures are synthetic, in memory, with no provider I/O.
function atomicContentFixture(area, kind, fault = null) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_init.sql', '0003_grant_award.sql', '0004_content_types.sql', '0009_content_live.sql', '0010_page_section_forms.sql']) {
    db.exec(readFileSync(new URL(`../schema/${file}`, import.meta.url), 'utf8'));
  }
  const section = area === 'form' ? 'form.membership' : 'home.hero';
  const beforeData = area === 'form'
    ? { section_key: section, heading: 'Original synthetic heading', submit_label: 'Original label' }
    : { section_key: section, title: 'Original synthetic title', lede: 'Original lede' };
  const afterData = area === 'form'
    ? { section_key: section, heading: 'New synthetic heading', submit_label: 'New label' }
    : { section_key: section, title: 'New synthetic title', lede: 'New lede' };
  const target = `ps_${section}`;
  const draft = 'cid_synthetic';
  const actor = 'synthetic_staff@example.invalid';
  const token = `h.${Buffer.from(JSON.stringify({ email: actor })).toString('base64url')}.sig`;
  const insert = (id, data, status, draftOf, by) => db.prepare(`
    INSERT INTO content_item (id, type_id, data, status, draft_of, updated_by, updated_at)
    VALUES (?, 'page_section', ?, ?, ?, ?, '2000-01-01 00:00:00')
  `).run(id, JSON.stringify(data), status, draftOf, by);
  insert(target, beforeData, 'published', null, 'staff_original');
  if (kind !== 'direct') insert(draft, afterData, 'draft', kind === 'new' ? null : target, 'agent');
  db.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, at)
    VALUES ('fixture', 'fixture', 'fixture', 'unrelated', '2000-01-01 00:00:00')`).run();
  if (fault === 'audit') db.exec(`CREATE TRIGGER synthetic_content_audit_fault BEFORE INSERT ON audit_log
    BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_CONTENT_FAULT_NO_CLIENT_LEAK'); END;`);
  if (fault === 'archive') db.exec(`CREATE TRIGGER synthetic_content_archive_fault BEFORE UPDATE ON content_item
    WHEN OLD.id = 'cid_synthetic' AND NEW.status = 'archived'
    BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_CONTENT_FAULT_NO_CLIENT_LEAK'); END;`);
  const adapter = d1(db);
  const batch = adapter.batch;
  let batches = 0;
  adapter.batch = async statements => { batches++; return batch(statements); };
  const localEnv = { LEGACY_DB: adapter };
  const action = kind === 'direct' ? 'change/direct' : kind === 'discard' ? 'discard' : 'confirm';
  const body = kind === 'direct'
    ? { target_id: target, data: afterData, staff_id: 'spoof_synthetic' }
    : { draft_id: draft, staff_id: 'spoof_synthetic' };
  const deliver = () => postAgent({ env: localEnv, request: new Request(`http://localhost/api/agent/${action}`, {
    method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': token }, body: JSON.stringify(body),
  }) });
  const snapshot = () => ({
    content: db.prepare('SELECT * FROM content_item ORDER BY id').all(),
    audits: db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  });
  return { db, target, draft, actor, kind, beforeData, afterData, deliver, snapshot, localEnv, batches: () => batches };
}

function verifyAtomicContentSuccess(f, before, after) {
  const entityId = f.kind === 'new' || f.kind === 'discard' ? f.draft : f.target;
  const row = after.content.find(item => item.id === entityId);
  const prior = before.content.find(item => item.id === entityId);
  assert.equal(after.audits.length, before.audits.length + 1);
  assert.deepEqual(after.audits.slice(0, -1), before.audits, 'existing append-only audits must be untouched');
  const audit = after.audits.at(-1);
  assert.equal(audit.actor, f.kind === 'discard' ? 'staff' : f.actor);
  assert.equal(audit.entity, 'content_item');
  assert.equal(audit.entity_id, entityId);
  assert.equal(audit.action, f.kind === 'direct' ? 'content_item.direct_edit'
    : f.kind === 'discard' ? 'content_item.discard' : 'content_item.publish');
  assert.equal(row.status, f.kind === 'discard' ? 'archived' : 'published');
  assert.equal(row.updated_by, f.kind === 'discard' ? 'staff' : `staff_${f.actor}`);
  assert.notEqual(row.updated_at, prior.updated_at);
  if (f.kind === 'direct') {
    assert.deepEqual(JSON.parse(audit.before_json), JSON.parse(prior.data));
    assert.deepEqual(JSON.parse(audit.after_json), f.afterData);
  } else {
    assert.deepEqual(JSON.parse(audit.before_json), { status: prior.status, data: JSON.parse(prior.data) });
    assert.deepEqual(JSON.parse(audit.after_json), { status: row.status, data: JSON.parse(row.data) });
  }
  if (f.kind === 'targeted') {
    const draftRow = after.content.find(item => item.id === f.draft);
    assert.equal(draftRow.status, 'archived');
    assert.equal(draftRow.updated_by, 'agent');
    assert.equal(draftRow.data, before.content.find(item => item.id === f.draft).data);
  }
  if (f.kind === 'new' || f.kind === 'discard') {
    assert.deepEqual(after.content.find(item => item.id === f.target), before.content.find(item => item.id === f.target));
  }
}

async function withoutSyntheticContentErrorLog(run) {
  const original = console.error;
  console.error = () => {};
  try { return await run(); } finally { console.error = original; }
}

for (const area of ['page', 'form']) {
  for (const kind of ['targeted', 'new', 'direct', 'discard']) {
    test(`atomic Content/Form ${area} ${kind}: healthy mutation preserves original audit provenance`, async () => {
      const f = atomicContentFixture(area, kind);
      try {
        const before = f.snapshot();
        const response = await f.deliver();
        assert.equal(response.status, 200);
        assert.equal((await response.json()).ok, true);
        verifyAtomicContentSuccess(f, before, f.snapshot());
        assert.equal(f.batches(), 1, 'mutation set must use exactly one batch');
      } finally { f.db.close(); }
    });
    test(`atomic Content/Form ${area} ${kind}: audit failure rolls back complete snapshot; retry preserves original provenance`, async () => {
      const f = atomicContentFixture(area, kind, 'audit');
      try {
        const before = f.snapshot();
        const failed = await withoutSyntheticContentErrorLog(f.deliver);
        assert.equal(failed.status, 500);
        const errorText = await failed.text();
        assert.deepEqual(JSON.parse(errorText), { ok: false, error: 'internal_error' });
        assert.ok(!errorText.includes('SYNTHETIC_CONTENT_FAULT_NO_CLIENT_LEAK'));
        assert.deepEqual(f.snapshot(), before, 'content, actor, timestamp, draft and audit must all roll back');
        f.db.exec('DROP TRIGGER synthetic_content_audit_fault');
        const retry = await f.deliver();
        assert.equal(retry.status, 200);
        assert.equal((await retry.json()).ok, true);
        verifyAtomicContentSuccess(f, before, f.snapshot());
        assert.equal(f.batches(), 2, 'failed delivery and healthy retry each use one batch');
      } finally { f.db.close(); }
    });
  }
  test(`atomic Content/Form ${area} targeted: archive failure rolls back target and retains retry provenance`, async () => {
    const f = atomicContentFixture(area, 'targeted', 'archive');
    try {
      const before = f.snapshot();
      const failed = await withoutSyntheticContentErrorLog(f.deliver);
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), { ok: false, error: 'internal_error' });
      assert.deepEqual(f.snapshot(), before);
      f.db.exec('DROP TRIGGER synthetic_content_archive_fault');
      const retry = await f.deliver();
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).ok, true);
      verifyAtomicContentSuccess(f, before, f.snapshot());
      assert.equal(f.batches(), 2);
    } finally { f.db.close(); }
  });
  test(`atomic Content/Form ${area} direct: cache stays intact on failure and resets only after success`, async () => {
    const f = atomicContentFixture(area, 'direct', 'audit');
    _resetContentCache();
    try {
      const before = f.snapshot();
      const cached = await getPublishedSections(f.localEnv, 1000);
      const sectionKey = f.target.slice(3);
      assert.deepEqual(cached[sectionKey], f.beforeData);
      const failed = await withoutSyntheticContentErrorLog(f.deliver);
      assert.equal(failed.status, 500);
      assert.deepEqual(f.snapshot(), before);
      assert.equal(await getPublishedSections(f.localEnv, 1001), cached);
      f.db.exec('DROP TRIGGER synthetic_content_audit_fault');
      assert.equal((await f.deliver()).status, 200);
      const refreshed = await getPublishedSections(f.localEnv, 1002);
      assert.notEqual(refreshed, cached);
      assert.deepEqual(refreshed[sectionKey], f.afterData);
      verifyAtomicContentSuccess(f, before, f.snapshot());
    } finally { _resetContentCache(); f.db.close(); }
  });
  test(`atomic Content/Form ${area} historical archived draft: no mutation or audit repair`, async () => {
    const f = atomicContentFixture(area, 'targeted');
    try {
      f.db.prepare("UPDATE content_item SET status = 'archived' WHERE id = ?").run(f.draft);
      const before = f.snapshot();
      const response = await f.deliver();
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { ok: false, error: 'cannot confirm from status archived' });
      assert.deepEqual(f.snapshot(), before);
      assert.equal(f.batches(), 0);
    } finally { f.db.close(); }
  });
}
