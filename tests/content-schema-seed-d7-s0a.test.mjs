// Slice D7-S0a tests - Section schema generation, D1 seed, and draft-over-target fix.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';
import { generatePageSectionSchema } from '../scripts/gen-page-section-schema.mjs';
import { seedPageSections } from '../scripts/seed-page-sections.mjs';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_4 = readFileSync(new URL('../schema/0004_content_types.sql', import.meta.url), 'utf8');
const SCHEMA_9 = readFileSync(new URL('../schema/0009_content_live.sql', import.meta.url), 'utf8');
const COMMITTED_SCHEMA = JSON.parse(readFileSync(new URL('../schema/page_section.schema.json', import.meta.url), 'utf8'));

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

// Mock mapper backend
let mockMapperResult = null;
const mockBackend = ({ request, contentType }) => {
  if (mockMapperResult) {
    return mockMapperResult;
  }
  return {
    ok: true,
    change: {
      section_key: 'home.hero',
      title: 'Updated Home Hero Title',
      lede: 'Updated Home Hero Lede'
    }
  };
};

beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_4);
  raw.exec(SCHEMA_9);

  env = {
    LEGACY_DB: d1(raw),
    AGENT_MAPPER_BACKEND: mockBackend
  };
  mockMapperResult = null;
});

// 1. Schema drift guard
test('schema drift guard: generating schema matches committed schema/page_section.schema.json', () => {
  const generated = generatePageSectionSchema();
  assert.deepEqual(generated, COMMITTED_SCHEMA);
});

// 2. Seed idempotent and skips staff-edited rows
test('seed idempotent and skips staff-edited rows', async () => {
  // First run: inserts 20 sections
  const res1 = await seedPageSections({ db: raw });
  assert.equal(res1.inserted, 20);
  assert.equal(res1.unchanged, 0);
  assert.equal(res1.skipped, 0);

  // Second run: idempotent, all 20 unchanged
  const res2 = await seedPageSections({ db: raw });
  assert.equal(res2.inserted, 0);
  assert.equal(res2.unchanged, 20);
  assert.equal(res2.skipped, 0);

  // Mark one row staff-edited
  raw.prepare(`UPDATE content_item SET updated_by = 'staff_jacob@example.com' WHERE id = 'ps_home.hero'`).run();

  // Third run: skips the staff-edited row
  const res3 = await seedPageSections({ db: raw });
  assert.equal(res3.inserted, 0);
  assert.equal(res3.unchanged, 19);
  assert.equal(res3.skipped, 1);

  // Verify staff-edited row was not overwritten
  const item = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_home.hero'`).get();
  assert.equal(item.updated_by, 'staff_jacob@example.com');
});

// 3. Draft leaves published target unchanged (the bug)
test('draft leaves the published target unchanged (the bug)', async () => {
  // Seed the 17 sections first
  await seedPageSections({ db: raw });

  const beforeTarget = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_home.hero'`).get();
  assert.equal(beforeTarget.status, 'published');
  const beforeData = JSON.parse(beforeTarget.data);

  mockMapperResult = {
    ok: true,
    change: {
      section_key: 'home.hero',
      title: 'Draft Proposed Title',
      lede: 'Draft Proposed Lede'
    }
  };

  const req = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      target_id: 'ps_home.hero',
      type_id: 'page_section',
      request: 'Change the hero title to Draft Proposed Title'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.ok);
  assert.ok(json.draft_id.startsWith('cid_'), 'draft id should start with cid_');

  // Verify published target row remains completely untouched
  const afterTarget = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_home.hero'`).get();
  assert.equal(afterTarget.status, 'published', 'target status must remain published!');
  assert.deepEqual(JSON.parse(afterTarget.data), beforeData, 'target data must remain unchanged!');

  // Verify draft row was created with draft_of pointing to target
  const draftRow = raw.prepare(`SELECT * FROM content_item WHERE id = ?`).get(json.draft_id);
  assert.ok(draftRow);
  assert.equal(draftRow.status, 'draft');
  assert.equal(draftRow.draft_of, 'ps_home.hero');
  assert.equal(JSON.parse(draftRow.data).title, 'Draft Proposed Title');
});

// 4. Confirm updates the target and archives the draft
test('confirm updates the target and archives the draft', async () => {
  await seedPageSections({ db: raw });

  mockMapperResult = {
    ok: true,
    change: {
      section_key: 'home.hero',
      title: 'Confirmed Hero Title',
      lede: 'Confirmed Hero Lede'
    }
  };

  const draftReq = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      target_id: 'ps_home.hero',
      type_id: 'page_section',
      request: 'Update home hero'
    })
  });

  const draftRes = await postAgent({ request: draftReq, env });
  const draftJson = await draftRes.json();
  assert.ok(draftJson.ok);
  const draftId = draftJson.draft_id;

  // Confirm with staff actor
  const confirmReq = new Request('http://localhost/api/agent/confirm', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': 'h.eyJlbWFpbCI6InN0YWZmQGV4YW1wbGUub3JnIn0.sig' },
    body: JSON.stringify({ draft_id: draftId })
  });

  const confirmRes = await postAgent({ request: confirmReq, env });
  assert.equal(confirmRes.status, 200);
  const confirmJson = await confirmRes.json();
  assert.ok(confirmJson.ok);

  // Target row must now be updated with the draft data, status published, updated_by staff
  const target = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_home.hero'`).get();
  assert.equal(target.status, 'published');
  assert.equal(target.updated_by, 'staff_staff@example.org');
  const targetData = JSON.parse(target.data);
  assert.equal(targetData.title, 'Confirmed Hero Title');
  assert.equal(targetData.lede, 'Confirmed Hero Lede');

  // Draft row must now be archived
  const draftRow = raw.prepare(`SELECT * FROM content_item WHERE id = ?`).get(draftId);
  assert.equal(draftRow.status, 'archived');

  // Audit log must record content_item.publish for the target
  const audit = raw.prepare(`SELECT * FROM audit_log WHERE entity = 'content_item' AND entity_id = 'ps_home.hero'`).get();
  assert.ok(audit);
  assert.equal(audit.action, 'content_item.publish');
  assert.equal(audit.actor, 'staff@example.org');
  const afterAudit = JSON.parse(audit.after_json);
  assert.equal(afterAudit.status, 'published');
  assert.equal(afterAudit.data.title, 'Confirmed Hero Title');
});

// 5. Discard never touches the target
test('discard never touches the target', async () => {
  await seedPageSections({ db: raw });

  const beforeTarget = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_home.hero'`).get();
  const beforeData = JSON.parse(beforeTarget.data);

  mockMapperResult = {
    ok: true,
    change: {
      section_key: 'home.hero',
      title: 'Discardable Title',
      lede: 'Discardable Lede'
    }
  };

  const draftReq = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      target_id: 'ps_home.hero',
      type_id: 'page_section',
      request: 'Change title'
    })
  });

  const draftRes = await postAgent({ request: draftReq, env });
  const draftJson = await draftRes.json();
  const draftId = draftJson.draft_id;

  // Discard draft
  const discardReq = new Request('http://localhost/api/agent/discard', {
    method: 'POST',
    body: JSON.stringify({ draft_id: draftId })
  });

  const discardRes = await postAgent({ request: discardReq, env });
  assert.equal(discardRes.status, 200);

  // Target row remains published and untouched
  const afterTarget = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_home.hero'`).get();
  assert.equal(afterTarget.status, 'published');
  assert.deepEqual(JSON.parse(afterTarget.data), beforeData);

  // Draft row is archived
  const draftRow = raw.prepare(`SELECT * FROM content_item WHERE id = ?`).get(draftId);
  assert.equal(draftRow.status, 'archived');
});

// 6. A mapper output with a non-editable field is refused
test('a mapper output with a non-editable field is refused', async () => {
  await seedPageSections({ db: raw });

  // Attempt to modify tiles (non-editable in home.support)
  mockMapperResult = {
    ok: true,
    change: {
      section_key: 'home.support',
      heading: 'New Heading',
      tiles: [{ title: 'Hacked Tile' }]
    }
  };

  const req1 = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      target_id: 'ps_home.support',
      type_id: 'page_section',
      request: 'Modify tiles'
    })
  });

  const res1 = await postAgent({ request: req1, env });
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.ok, false);
  assert.ok(json1.refusal.includes('fails schema validation'));

  // Attempt to modify cta_href (non-editable in home.community_wellness_partners)
  mockMapperResult = {
    ok: true,
    change: {
      section_key: 'home.community_wellness_partners',
      heading: 'New Heading',
      cta_href: 'evil.html'
    }
  };

  const req2 = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      target_id: 'ps_home.community_wellness_partners',
      type_id: 'page_section',
      request: 'Modify cta href'
    })
  });

  const res2 = await postAgent({ request: req2, env });
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.ok, false);
  assert.ok(json2.refusal.includes('fails schema validation'));

  // Attempt to modify crisis_html (non-editable in request_support.next)
  mockMapperResult = {
    ok: true,
    change: {
      section_key: 'request_support.next',
      heading: 'New Heading',
      crisis_html: '<script>alert(1)</script>'
    }
  };

  const req3 = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      target_id: 'ps_request_support.next',
      type_id: 'page_section',
      request: 'Modify crisis html'
    })
  });

  const res3 = await postAgent({ request: req3, env });
  assert.equal(res3.status, 200);
  const json3 = await res3.json();
  assert.equal(json3.ok, false);
  assert.ok(json3.refusal.includes('fails schema validation'));
});

// 7. Non-editable fields are copied from the current target row
test('valid draft copies non-editable fields from current target row', async () => {
  await seedPageSections({ db: raw });

  const beforeSupport = raw.prepare(`SELECT data FROM content_item WHERE id = 'ps_home.support'`).get();
  const beforeSupportData = JSON.parse(beforeSupport.data);
  assert.ok(beforeSupportData.tiles);

  mockMapperResult = {
    ok: true,
    change: {
      section_key: 'home.support',
      heading: 'Updated How We Support Caregivers'
    }
  };

  const req = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      target_id: 'ps_home.support',
      type_id: 'page_section',
      request: 'Update heading only'
    })
  });

  const res = await postAgent({ request: req, env });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.ok);

  const draftRow = raw.prepare(`SELECT * FROM content_item WHERE id = ?`).get(json.draft_id);
  const draftData = JSON.parse(draftRow.data);
  assert.equal(draftData.heading, 'Updated How We Support Caregivers');
  // tiles and secondary must be preserved from current target row
  assert.deepEqual(draftData.tiles, beforeSupportData.tiles);
  assert.equal(draftData.secondary, beforeSupportData.secondary);
});
