import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../functions/api/agent/[[path]].js';
import { confirmationBinding, setVerifiedAccessStaffActor } from '../functions/_lib/agent-confirmation.mjs';

// These server-context fixtures model the already-verified middleware seam, not JWT proof.
const actor = 'initiator@example.invalid';
function fixture(area) {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0003_grant_award.sql', '0008_agent_change.sql']) {
    db.exec(readFileSync(new URL(`../schema/${file}`, import.meta.url), 'utf8'));
  }
  db.exec('ALTER TABLE content_item ADD COLUMN draft_of TEXT');
  const schema = { oneOf: ['home.hero', 'form.request_support'].map(section_key => ({
    properties: { section_key: { const: section_key, type: 'string' }, title: { type: 'string' }, name_label: { type: 'string' } },
    required: ['section_key'], additionalProperties: false,
  })) };
  db.prepare('INSERT INTO content_type(id,json_schema) VALUES(?,?)').run('page_section', JSON.stringify(schema));
  const content = area === 'content' || area === 'forms';
  const id = area === 'content' ? 'ps_home.hero' : area === 'forms' ? 'ps_form.request_support'
    : area === 'caregiver' ? 'cg_fixture' : area === 'event' ? 'ev_fixture' : '1';
  const initial = area === 'forms' ? { section_key: 'form.request_support', name_label: 'Before' } : { section_key: 'home.hero', title: 'Before' };
  if (content) db.prepare("INSERT INTO content_item(id,type_id,data,status,updated_by) VALUES(?,'page_section',?,'published','prior_staff')").run(id, JSON.stringify(initial));
  db.exec("INSERT INTO caregiver(id,first_name,email) VALUES('cg_fixture','Fictional','fixture@example.invalid')");
  db.exec("INSERT INTO event(id,title,type,starts_at,publish_state) VALUES('ev_fixture','Before','other','2099-01-01','draft')");
  db.exec("INSERT INTO grant_application(id,caregiver_id,status,source) VALUES(1,'cg_fixture','submitted','synthetic')");
  let beforeBatch = null;
  const d1 = { prepare(sql) {
    return { bind(...params) { return { sql, params,
      first: async () => db.prepare(sql).get(...params) ?? null,
      run: async () => db.prepare(sql).run(...params),
      all: async () => ({ results: db.prepare(sql).all(...params) }) }; } };
  }, async batch(statements) {
    const hook = beforeBatch; beforeBatch = null; await hook?.();
    db.exec('BEGIN');
    try {
      const results = statements.map(({ sql, params }) => {
        const stmt = db.prepare(sql);
        if (stmt.columns().length) return { success: true, results: stmt.all(...params) };
        stmt.run(...params); return { success: true, results: [] };
      });
      db.exec('COMMIT'); return results;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
  const env = { LEGACY_DB: d1, AGENT_MAPPER_BACKEND: () => content
    ? { ok: true, change: area === 'forms' ? { section_key: 'form.request_support', name_label: 'After' } : { section_key: 'home.hero', title: 'After' } }
    : { ok: true, operation: area === 'grant' ? 'review' : 'update', payload: area === 'grant' ? { review_notes: 'Fictional review' }
      : area === 'event' ? { title: 'After' } : { segment_tags: ['verified'] } } };
  const path = content ? '/api/agent/' : '/api/agent/change/';
  async function call(action, body, identity = actor, origin = 'https://synthetic.invalid') {
    const data = { agentStaffActor: actor }; // Wire-like assertion is deliberately insufficient.
    if (identity) setVerifiedAccessStaffActor(data, identity);
    return onRequestPost({ request: new Request(origin + path + action, { method: 'POST', body: JSON.stringify(body) }), env,
      data });
  }
  const snapshot = () => Object.fromEntries(['content_item', 'agent_change', 'caregiver', 'event', 'grant_application', 'audit_log']
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
  async function draft(identity = actor) {
    const response = await call('draft', { ...(content ? { type_id: 'page_section' } : { area }), target_id: id, request: 'Fictional change' }, identity);
    assert.equal(response.status, 200); return response.json();
  }
  const confirmBody = receipt => ({ [content ? 'draft_id' : 'change_id']: receipt.draft_id || receipt.change_id, preview_version: receipt.preview_version });
  return { db, d1, call, draft, confirmBody, snapshot, id, content, path,
    race(callback) { beforeBatch = callback; } };
}

for (const area of ['content', 'forms', 'caregiver', 'event', 'grant']) {
  test(`${area}: initiating human confirms exact server preview, once, with original audit`, async () => {
    const f = fixture(area);
    try {
      const receipt = await f.draft();
      assert.match(receipt.preview_version, /^[a-f0-9]{64}$/);
      const response = await f.call('confirm', f.confirmBody(receipt));
      assert.equal(response.status, 200);
      const audits = f.snapshot().audit_log;
      assert.equal(audits.length, f.content ? 1 : 2);
      assert.ok(audits.every(row => row.actor === actor));
      const published = f.snapshot();
      assert.equal((await f.call('confirm', f.confirmBody(receipt))).status, 409);
      assert.deepEqual(f.snapshot(), published);
    } finally { f.db.close(); }
  });
  for (const refusal of ['other-actor', 'no-human-proof', 'wrong-version', 'origin-change', 'slack-context', 'target-change', 'proposal-change']) {
    test(`${area}: ${refusal} refuses without confirmation mutation/audit`, async () => {
      const f = fixture(area);
      try {
        const receipt = await f.draft();
        const body = f.confirmBody(receipt);
        if (refusal === 'wrong-version') body.preview_version = '0'.repeat(64);
        if (refusal === 'slack-context') body.thread_id = 'model-asserted-thread';
        if (refusal === 'target-change') {
          if (f.content) f.db.prepare('UPDATE content_item SET data=? WHERE id=?').run('{"title":"Concurrent"}', f.id);
          else if (area === 'grant') f.db.exec("UPDATE grant_application SET review_notes='Concurrent' WHERE id=1");
          else f.db.prepare(`UPDATE ${area} SET ${area === 'event' ? 'title' : 'first_name'}='Concurrent' WHERE id=?`).run(f.id);
        }
        if (refusal === 'proposal-change') {
          if (f.content) f.db.prepare('UPDATE content_item SET data=? WHERE id=?').run('{"title":"Changed draft"}', receipt.draft_id);
          else f.db.prepare('UPDATE agent_change SET after_json=? WHERE id=?').run('{}', receipt.change_id);
        }
        const before = f.snapshot();
        const response = await f.call('confirm', body, refusal === 'other-actor' ? 'other@example.invalid'
          : refusal === 'no-human-proof' ? null : actor, refusal === 'origin-change' ? 'https://other.invalid' : undefined);
        assert.ok([403, 409].includes(response.status));
        assert.deepEqual(f.snapshot(), before);
      } finally { f.db.close(); }
    });
  }
  test(`${area}: post-read target race aborts complete transaction via original audit guard`, async () => {
    const f = fixture(area);
    const previousError = console.error; console.error = () => {};
    try {
      const receipt = await f.draft();
      let raced;
      f.race(() => {
        if (f.content) f.db.prepare("UPDATE content_item SET updated_by='concurrent_staff' WHERE id=?").run(f.id);
        else if (area === 'grant') f.db.exec("UPDATE grant_application SET requested_for='Concurrent' WHERE id=1");
        else f.db.prepare(`UPDATE ${area} SET ${area === 'event' ? 'title' : 'first_name'}='Concurrent' WHERE id=?`).run(f.id);
        raced = f.snapshot();
      });
      assert.equal((await f.call('confirm', f.confirmBody(receipt))).status, 500);
      assert.deepEqual(f.snapshot(), raced, 'concurrent writer remains; no partial target/status/audit from confirmation');
    } finally { console.error = previousError; f.db.close(); }
  });
}

test('legacy literal agent owner and unverified/service-origin draft are never upgraded to human proof', async () => {
  const f = fixture('content');
  try {
    const receipt = await f.draft(null);
    assert.equal(receipt.preview_version, null);
    const before = f.snapshot();
    assert.equal((await f.call('confirm', f.confirmBody(receipt))).status, 403);
    assert.deepEqual(f.snapshot(), before);
    const row = f.db.prepare('SELECT * FROM content_item WHERE id=?').get(receipt.draft_id);
    const guessed = await confirmationBinding(f.d1, 'content', row, 'https://synthetic.invalid');
    assert.equal((await f.call('confirm', { draft_id: row.id, preview_version: guessed.version })).status, 403);
  } finally { f.db.close(); }
});

for (const area of ['content', 'caregiver']) {
  test(`${area}: competing confirmations serialize to one original result/audit`, async () => {
    const f = fixture(area);
    const previousError = console.error; console.error = () => {};
    try {
      const receipt = await f.draft();
      let winner;
      f.race(async () => { winner = await f.call('confirm', f.confirmBody(receipt)); });
      const loser = await f.call('confirm', f.confirmBody(receipt));
      assert.equal(winner.status, 200);
      assert.equal(loser.status, 500);
      assert.equal(f.snapshot().audit_log.length, f.content ? 1 : 2);
    } finally { console.error = previousError; f.db.close(); }
  });
}

for (const timing of ['before-read', 'after-read']) {
  test(`Grant secondary award ${timing} drift cannot bypass preview/transaction fence`, async () => {
    const f = fixture('grant');
    const previousError = console.error; console.error = () => {};
    try {
      const receipt = await f.draft();
      const change = () => f.db.exec("INSERT INTO award(grant_application_id,outcome) VALUES(1,'Fictional concurrent outcome')");
      let expected;
      if (timing === 'before-read') { change(); expected = f.snapshot(); }
      else f.race(() => { change(); expected = f.snapshot(); });
      assert.equal((await f.call('confirm', f.confirmBody(receipt))).status, timing === 'before-read' ? 409 : 500);
      assert.deepEqual(f.snapshot(), expected);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM award').get().n, 1);
    } finally { console.error = previousError; f.db.close(); }
  });
}

// Governed discard uses the SAME original staff/preview fence, not general Access.
for (const area of ['content', 'forms', 'caregiver', 'event', 'grant']) {
  test(`${area}: initiating human discards exact preview once with named original audit and no domain mutation`, async () => {
    const f = fixture(area);
    try {
      const receipt = await f.draft(), before = f.snapshot();
      assert.equal((await f.call('discard', f.confirmBody(receipt))).status, 200);
      const after = f.snapshot();
      for (const table of ['caregiver', 'event', 'grant_application']) assert.deepEqual(after[table], before[table]);
      if (f.content) {
        assert.deepEqual(after.content_item.find(row => row.id === f.id), before.content_item.find(row => row.id === f.id));
        const draft = after.content_item.find(row => row.id === receipt.draft_id);
        assert.equal(draft.status, 'archived');
        assert.equal(draft.updated_by, `staff_${actor}`);
      } else assert.equal(after.agent_change[0].status, 'discarded');
      assert.equal(after.audit_log.length, before.audit_log.length + 1);
      assert.deepEqual(after.audit_log.slice(0, -1), before.audit_log);
      const audit = after.audit_log.at(-1);
      assert.equal(audit.actor, actor);
      assert.equal(audit.action, f.content ? 'content_item.discard' : 'agent_change.discard');
      assert.equal(audit.entity_id, receipt.draft_id || receipt.change_id);
      assert.equal((await f.call('discard', f.confirmBody(receipt))).status, 409);
      assert.equal((await f.call('confirm', f.confirmBody(receipt))).status, 409);
      assert.deepEqual(f.snapshot(), after);
    } finally { f.db.close(); }
  });
  for (const refusal of ['other-actor', 'no-human-proof', 'service-proof', 'missing-version', 'wrong-version', 'origin-change', 'slack-context', 'proposal-change', 'target-change', 'legacy-owner']) {
    test(`${area}: discard ${refusal} refuses with no status/domain/audit mutation`, async () => {
      const f = fixture(area);
      try {
        const receipt = await f.draft(), body = f.confirmBody(receipt);
        if (refusal === 'missing-version') delete body.preview_version;
        if (refusal === 'wrong-version') body.preview_version = '0'.repeat(64);
        if (refusal === 'slack-context') body.conversation_id = 'model-asserted';
        if (refusal === 'legacy-owner') {
          f.db.prepare(`UPDATE ${f.content ? 'content_item' : 'agent_change'} SET ${f.content ? 'updated_by' : 'requested_by'}='agent' WHERE id=?`).run(receipt.draft_id || receipt.change_id);
        }
        if (refusal === 'proposal-change') {
          f.db.prepare(`UPDATE ${f.content ? 'content_item' : 'agent_change'} SET ${f.content ? 'data' : 'payload_json'}='{}' WHERE id=?`).run(receipt.draft_id || receipt.change_id);
        }
        if (refusal === 'target-change') {
          const table = f.content ? 'content_item' : area === 'grant' ? 'grant_application' : area;
          const field = f.content ? 'updated_by' : area === 'grant' ? 'review_notes' : area === 'event' ? 'title' : 'first_name';
          f.db.prepare(`UPDATE ${table} SET ${field}='Concurrent' WHERE id=?`).run(f.id);
        }
        const before = f.snapshot();
        const response = await f.call('discard', body, refusal === 'other-actor' ? 'other@example.invalid' : refusal === 'no-human-proof' ? null : refusal === 'service-proof' ? 'service:fixture@example.invalid' : actor,
          refusal === 'origin-change' ? 'https://other.invalid' : undefined);
        assert.ok([403, 409].includes(response.status));
        assert.deepEqual(f.snapshot(), before);
      } finally { f.db.close(); }
    });
  }
  for (const [first, second] of [['discard', 'confirm'], ['confirm', 'discard'], ['discard', 'discard']]) {
    test(`${area}: racing ${first} cannot overwrite winning ${second} or its original audits`, async () => {
      const f = fixture(area), previousError = console.error; console.error = () => {};
      try {
        const receipt = await f.draft();
        let winner, expected;
        f.race(async () => { winner = await f.call(second, f.confirmBody(receipt)); expected = f.snapshot(); });
        const loser = await f.call(first, f.confirmBody(receipt));
        assert.equal(winner.status, 200);
        assert.equal(loser.status, 500, 'original audit precondition aborts losing batch');
        assert.deepEqual(f.snapshot(), expected);
      } finally { console.error = previousError; f.db.close(); }
    });
  }
  for (const fault of ['audit', 'status']) {
    test(`${area}: discard ${fault} failure rolls back the complete original audit/status batch`, async () => {
      const f = fixture(area), previousError = console.error; console.error = () => {};
      try {
        const receipt = await f.draft(), before = f.snapshot();
        const trigger = fault === 'audit' ? `BEFORE INSERT ON audit_log WHEN NEW.action='${f.content ? 'content_item' : 'agent_change'}.discard'`
          : `BEFORE UPDATE ON ${f.content ? 'content_item' : 'agent_change'}`;
        f.db.exec(`CREATE TRIGGER discard_fault ${trigger} BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_DISCARD_FAILURE'); END`);
        const response = await f.call('discard', f.confirmBody(receipt));
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { ok: false, error: 'internal_error' });
        assert.deepEqual(f.snapshot(), before);
      } finally { console.error = previousError; f.db.close(); }
    });
  }
  test(`${area}: post-read target drift aborts discard before its original audit/status writes`, async () => {
    const f = fixture(area), previousError = console.error; console.error = () => {};
    try {
      const receipt = await f.draft();
      let expected;
      f.race(() => {
        const table = f.content ? 'content_item' : area === 'grant' ? 'grant_application' : area;
        const field = f.content ? 'updated_by' : area === 'grant' ? 'review_notes' : area === 'event' ? 'title' : 'first_name';
        f.db.prepare(`UPDATE ${table} SET ${field}='Concurrent' WHERE id=?`).run(f.id);
        expected = f.snapshot();
      });
      assert.equal((await f.call('discard', f.confirmBody(receipt))).status, 500);
      assert.deepEqual(f.snapshot(), expected);
    } finally { console.error = previousError; f.db.close(); }
  });
}

for (const timing of ['before-read', 'after-read']) {
  test(`Grant discard secondary award ${timing} drift retains the draft and original audits`, async () => {
    const f = fixture('grant'), previousError = console.error; console.error = () => {};
    try {
      const receipt = await f.draft();
      const change = () => f.db.exec("INSERT INTO award(grant_application_id,outcome) VALUES(1,'Fictional concurrent outcome')");
      let expected;
      if (timing === 'before-read') { change(); expected = f.snapshot(); }
      else f.race(() => { change(); expected = f.snapshot(); });
      assert.equal((await f.call('discard', f.confirmBody(receipt))).status, timing === 'before-read' ? 409 : 500);
      assert.deepEqual(f.snapshot(), expected);
    } finally { console.error = previousError; f.db.close(); }
  });
}
