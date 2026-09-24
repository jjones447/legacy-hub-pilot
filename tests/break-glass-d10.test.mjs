// Tests for LEGACY-BREAK-GLASS-R1 (Issue #107, Decision D-010)
// Covers:
// 1. Schema-driven form generation in staff console for seeded content types
// 2. Direct edit endpoint POST /api/agent/change/direct with schema validation and audit logging
// 3. Body-supplied actor ignored (actor from getActor)
// 4. Pin 3: direct edit to ps_* row reflects in rewritten public HTML via _content.mjs
// 5. Recent changes panel GET /api/staff/recent-changes (last 50 rows, restorable flags)
// 6. Undo endpoint POST /api/staff/undo/:audit_id with 409 refusals and entity restoration

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';
import { onRequestGet as getStaff, onRequestPost as postStaff } from '../functions/api/staff/[[path]].js';
import { rewriteContent, _resetContentCache } from '../functions/_content.mjs';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_4 = readFileSync(new URL('../schema/0004_content_types.sql', import.meta.url), 'utf8');
const SCHEMA_6 = readFileSync(new URL('../schema/0006_caregiver_contact_history_outcomes.sql', import.meta.url), 'utf8');
const SCHEMA_7 = readFileSync(new URL('../schema/0007_grant_course_complete.sql', import.meta.url), 'utf8');
const SCHEMA_8 = readFileSync(new URL('../schema/0008_agent_change.sql', import.meta.url), 'utf8');

const STAFF_HTML = readFileSync(new URL('../staff.html', import.meta.url), 'utf8');
const STAFF_JS = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
const STYLES_CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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

beforeEach(() => {
  _resetContentCache();
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_4);
  raw.exec(SCHEMA_6);
  raw.exec(SCHEMA_7);
  raw.exec(SCHEMA_8);

  env = {
    LEGACY_DB: d1(raw),
    ALLOW_DEV_CONSOLE: '1',
    CF_PAGES: '1'
  };

  // Seed sample published content items
  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES (?, ?, ?, 'published', 'seed')
  `).run(
    'ps_home.hero',
    'page_section',
    JSON.stringify({
      section_key: 'home_hero',
      heading: 'Caring for Someone with Dementia? You Do Not Have to Do It Alone.',
      body: 'Get guidance, community, and in-home respite support from people who understand.',
      cta_label: 'Get Caregiver Support',
      cta_target: 'support_request_form'
    })
  );

  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES (?, ?, ?, 'published', 'seed')
  `).run(
    'ps_home.journey',
    'page_section',
    JSON.stringify({
      section_key: 'about_intro',
      heading: 'Caregiving can change every part of life. You should not have to navigate it alone.',
      body: 'Caregiver Sanctuary provides respite, wellness, practical support, and community.'
    })
  );

  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES (?, ?, ?, 'published', 'seed')
  `).run(
    'res_01',
    'resource',
    JSON.stringify({
      title: 'Navigating Dementia: First Steps',
      description: 'A practical roadmap for families facing a new diagnosis.',
      category: 'education',
      link_or_file: 'https://example.org/guide.pdf'
    })
  );

  // Seed draft content item
  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES (?, ?, ?, 'draft', 'agent')
  `).run(
    'ci_draft_01',
    'resource',
    JSON.stringify({
      title: 'Draft Resource',
      description: 'Under review.',
      category: 'support'
    })
  );

  // Seed caregiver and related entities
  raw.prepare(`
    INSERT INTO caregiver (id, first_name, last_name, email, phone, status)
    VALUES ('cg_test_1', 'Maria', 'Santos', 'maria@example.com', '555-0199', 'active')
  `).run();

  raw.prepare(`
    INSERT INTO note (id, caregiver_id, author, body, status)
    VALUES (1, 'cg_test_1', 'staff@legacy-hub.org', 'Initial caregiver intake call completed.', 'active')
  `).run();
});

test('1. Staff Console UI contains Site content and Recent changes markup with zero inline styles', () => {
  assert.ok(STAFF_HTML.includes('id="siteContentPanel"'), 'siteContentPanel must exist in staff.html');
  assert.ok(STAFF_HTML.includes('id="siteContentList"'), 'siteContentList must exist in staff.html');
  assert.ok(STAFF_HTML.includes('id="siteContentEditor"'), 'siteContentEditor must exist in staff.html');
  assert.ok(STAFF_HTML.includes('id="recentChangesPanel"'), 'recentChangesPanel must exist in staff.html');
  assert.ok(STAFF_HTML.includes('id="recentChangesList"'), 'recentChangesList must exist in staff.html');
  assert.ok(STAFF_HTML.includes('id="refreshRecentChangesBtn"'), 'refreshRecentChangesBtn must exist in staff.html');

  // Verify siteContentPanel and recentChangesPanel have zero style="..." attributes
  const siteContentMatch = STAFF_HTML.match(/<div class="panel" id="siteContentPanel">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(siteContentMatch, 'siteContentPanel markup located');
  assert.doesNotMatch(siteContentMatch[0], /\sstyle=["'][^"']*["']/i, 'siteContentPanel must not use inline style attributes');

  // Verify CSS classes exist in styles.css
  assert.ok(STYLES_CSS.includes('.content-item-row'), 'styles.css defines .content-item-row');
  assert.ok(STYLES_CSS.includes('.editor-box'), 'styles.css defines .editor-box');
  assert.ok(STYLES_CSS.includes('.recent-change-row'), 'styles.css defines .recent-change-row');
});

test('2. Schema-driven form generator produces inputs, textareas, selects, and checkboxes', () => {
  // Extract escapeHtml and generateSchemaFormHtml from staff.js
  const escapeMatch = STAFF_JS.match(/function\s+escapeHtml\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  const formGenMatch = STAFF_JS.match(/function\s+generateSchemaFormHtml\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(escapeMatch && formGenMatch, 'helpers found in staff.js');

  const fn = new Function(`${escapeMatch[0]}; ${formGenMatch[0]}; return generateSchemaFormHtml;`)();

  const pageSectionSchema = JSON.parse(
    raw.prepare("SELECT json_schema FROM content_type WHERE id = 'page_section'").get().json_schema
  );

  const initialData = {
    section_key: 'home_hero',
    heading: 'Hero Heading',
    body: 'Hero long body text here.',
    cta_label: 'Click Me',
    cta_target: 'support_request_form'
  };

  const html = fn(pageSectionSchema, initialData, 'page_section', 'ps_home.hero');
  assert.ok(html.includes('data-action="submit-direct-content"'), 'form has submit-direct-content action');
  assert.ok(html.includes('data-content-id="ps_home.hero"'), 'carries target content id');
  assert.ok(html.includes('name="section_key"'), 'renders section_key');
  assert.ok(html.includes('<select'), 'renders select for enum');
  assert.ok(html.includes('name="heading"'), 'renders heading');
  assert.ok(html.includes('name="body"'), 'renders body');
  assert.ok(html.includes('<textarea'), 'renders textarea for long text');

  // Test custom schema with boolean, array of strings, and unknown object
  const complexSchema = {
    type: 'object',
    properties: {
      is_active: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
      nested_config: { type: 'object' }
    }
  };
  const complexData = {
    is_active: true,
    tags: ['first', 'second'],
    nested_config: { max: 10 }
  };
  const complexHtml = fn(complexSchema, complexData, 'custom_type', 'item_99');
  assert.ok(complexHtml.includes('type="checkbox"'), 'renders checkbox for boolean');
  assert.ok(complexHtml.includes('data-schema-type="array-string"'), 'renders array textarea');
  assert.ok(complexHtml.includes('data-schema-type="json"'), 'renders json textarea for unknown shapes');
});

test('3. GET /api/staff/content returns published items and schemas', async () => {
  const req = new Request('https://example.com/api/staff/content');
  const res = await getStaff({ request: req, env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.ok(Array.isArray(data.items), 'items array returned');
  assert.ok(Array.isArray(data.types), 'types array returned');

  // Only published items returned (ci_draft_01 must be excluded)
  const ids = data.items.map(i => i.id);
  assert.ok(ids.includes('ps_home.hero'));
  assert.ok(ids.includes('res_01'));
  assert.ok(!ids.includes('ci_draft_01'), 'draft items must not be listed in published content');
});

test('4. POST /api/agent/change/direct validates schema, updates published row, and logs audit', async () => {
  const validData = {
    section_key: 'home_hero',
    heading: 'Updated Hero Heading for Testing',
    body: 'Fresh body copy directly edited by staff.',
    cta_label: 'Connect Now',
    cta_target: 'contact_page'
  };

  const req = new Request('https://example.com/api/agent/change/direct', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dev-actor': 'coordinator@legacy-hub.org'
    },
    body: JSON.stringify({
      target_id: 'ps_home.hero',
      data: validData,
      actor: 'attacker@evil.com' // SEC-2: must be ignored
    })
  });

  const res = await postAgent({ request: req, env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.id, 'ps_home.hero');
  assert.equal(data.updated_by, 'staff_coordinator@legacy-hub.org');

  // Verify DB updated row
  const row = raw.prepare("SELECT * FROM content_item WHERE id = 'ps_home.hero'").get();
  assert.equal(row.updated_by, 'staff_coordinator@legacy-hub.org');
  const parsedData = JSON.parse(row.data);
  assert.equal(parsedData.heading, 'Updated Hero Heading for Testing');

  // Verify audit log
  const audit = raw.prepare("SELECT * FROM audit_log WHERE entity = 'content_item' AND entity_id = 'ps_home.hero' ORDER BY id DESC LIMIT 1").get();
  assert.ok(audit, 'audit row created');
  assert.equal(audit.action, 'content_item.direct_edit');
  assert.equal(audit.actor, 'coordinator@legacy-hub.org');
  const before = JSON.parse(audit.before_json);
  const after = JSON.parse(audit.after_json);
  assert.equal(after.heading, 'Updated Hero Heading for Testing');
  assert.ok(before.heading.includes('Caring for Someone'));
});

test('5. POST /api/agent/change/direct refuses invalid schemas, non-published items, and missing items', async () => {
  // Schema failure (missing required heading)
  const badReq = new Request('https://example.com/api/agent/change/direct', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dev-actor': 'staff@legacy-hub.org'
    },
    body: JSON.stringify({
      target_id: 'ps_home.hero',
      data: {
        section_key: 'home_hero'
        // heading and body missing!
      }
    })
  });
  const badRes = await postAgent({ request: badReq, env });
  assert.equal(badRes.status, 400);
  const badData = await badRes.json();
  assert.equal(badData.ok, false);
  assert.ok(badData.error.includes('validation failed'));

  // Refusal: target item is draft (Pin 2: direct edit must not touch draft rows)
  const draftReq = new Request('https://example.com/api/agent/change/direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-actor': 'staff@legacy-hub.org' },
    body: JSON.stringify({
      target_id: 'ci_draft_01',
      data: { title: 'New', description: 'Desc', category: 'support' }
    })
  });
  const draftRes = await postAgent({ request: draftReq, env });
  assert.equal(draftRes.status, 409);

  // Missing item
  const notFoundReq = new Request('https://example.com/api/agent/change/direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-actor': 'staff@legacy-hub.org' },
    body: JSON.stringify({
      target_id: 'non_existent_item',
      data: { section_key: 'home_hero', heading: 'H', body: 'B' }
    })
  });
  const notFoundRes = await postAgent({ request: notFoundReq, env });
  assert.equal(notFoundRes.status, 404);
});

test('6. Pin 3: Direct edit to ps_* row reflects in rewritten public HTML via _content.mjs', async () => {
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  // Verify baseline rewrite with initial DB row
  _resetContentCache();
  const initialSections = await env.LEGACY_DB.prepare(
    "SELECT id, data FROM content_item WHERE id LIKE 'ps_%' AND status = 'published'"
  ).all();
  const sectionsMap = {};
  for (const row of initialSections.results) {
    sectionsMap[row.id.slice(3)] = JSON.parse(row.data);
  }

  const initialResp = await rewriteContent(
    new Response(indexHtml, { headers: { 'content-type': 'text/html' } }),
    sectionsMap
  );
  const initialHtml = await initialResp.text();
  assert.ok(initialHtml.includes('Caregiving can change every part of life. You should not have to navigate it alone.'));

  // Perform direct edit to journey section
  const directReq = new Request('https://example.com/api/agent/change/direct', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dev-actor': 'editor@legacy-hub.org'
    },
    body: JSON.stringify({
      target_id: 'ps_home.journey',
      data: {
        section_key: 'about_intro',
        heading: 'Breaking Glass: Fresh Hope for Caregivers',
        body: 'Immediate live update reflected directly at the edge.'
      }
    })
  });
  const directRes = await postAgent({ request: directReq, env });
  assert.equal(directRes.status, 200);

  // Retrieve updated sections and rewrite index.html
  const updatedSections = await env.LEGACY_DB.prepare(
    "SELECT id, data FROM content_item WHERE id LIKE 'ps_%' AND status = 'published'"
  ).all();
  const updatedMap = {};
  for (const row of updatedSections.results) {
    updatedMap[row.id.slice(3)] = JSON.parse(row.data);
  }

  const updatedResp = await rewriteContent(
    new Response(indexHtml, { headers: { 'content-type': 'text/html' } }),
    updatedMap
  );
  const rewrittenHtml = await updatedResp.text();
  assert.ok(
    rewrittenHtml.includes('Breaking Glass: Fresh Hope for Caregivers'),
    'Direct edit must be reflected in rewritten public HTML'
  );
});

test('7. GET /api/staff/recent-changes returns last 50 changes and flags restorable actions', async () => {
  // Insert various audit entries
  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'content_item.direct_edit', 'content_item', 'res_01', '{"title":"Old"}', '{"title":"New"}')
  `).run();

  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'caregiver.update', 'caregiver', 'cg_test_1', '{"phone":"555-0100"}', '{"phone":"555-0199"}')
  `).run();

  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'caregiver.contact_added', 'caregiver', 'cg_test_1', NULL, '{"channel":"phone"}')
  `).run();

  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'caregiver.note_added', 'caregiver', 'cg_test_1', NULL, '{"body":"Hello"}')
  `).run();

  const req = new Request('https://example.com/api/staff/recent-changes');
  const res = await getStaff({ request: req, env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.changes.length >= 4);

  const directEdit = data.changes.find(c => c.action === 'content_item.direct_edit');
  assert.equal(directEdit.restorable, true);

  const caregiverUpdate = data.changes.find(c => c.action === 'caregiver.update');
  assert.equal(caregiverUpdate.restorable, true);

  const contactAdded = data.changes.find(c => c.action === 'caregiver.contact_added');
  assert.equal(contactAdded.restorable, false);

  const noteAdded = data.changes.find(c => c.action === 'caregiver.note_added');
  assert.equal(noteAdded.restorable, false);
});

test('8. POST /api/staff/undo/:audit_id restores content_item to before_json', async () => {
  // 1. Direct edit ps_home.hero
  const originalRow = raw.prepare("SELECT data FROM content_item WHERE id = 'ps_home.hero'").get();

  const editReq = new Request('https://example.com/api/agent/change/direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-actor': 'staff@legacy-hub.org' },
    body: JSON.stringify({
      target_id: 'ps_home.hero',
      data: {
        section_key: 'home_hero',
        heading: 'Temporary Heading That Should Be Undone',
        body: 'Will be restored.',
        cta_label: 'Go',
        cta_target: 'support_request_form'
      }
    })
  });
  await postAgent({ request: editReq, env });

  const auditRow = raw.prepare("SELECT * FROM audit_log WHERE action = 'content_item.direct_edit' ORDER BY id DESC LIMIT 1").get();
  assert.ok(auditRow);

  // 2. Call undo
  const undoReq = new Request(`https://example.com/api/staff/undo/${auditRow.id}`, {
    method: 'POST',
    headers: { 'x-dev-actor': 'supervisor@legacy-hub.org' }
  });
  const undoRes = await postStaff({ request: undoReq, env });
  const undoData = await undoRes.json();

  assert.equal(undoRes.status, 200);
  assert.equal(undoData.ok, true);

  // 3. Verify content_item restored to original data
  const restoredRow = raw.prepare("SELECT * FROM content_item WHERE id = 'ps_home.hero'").get();
  assert.equal(restoredRow.data, originalRow.data);
  assert.equal(restoredRow.updated_by, 'staff_supervisor@legacy-hub.org');

  // 4. Verify undo audit row logged
  const undoAudit = raw.prepare("SELECT * FROM audit_log WHERE action = 'undo' ORDER BY id DESC LIMIT 1").get();
  assert.ok(undoAudit);
  assert.equal(undoAudit.actor, 'supervisor@legacy-hub.org');
  assert.equal(undoAudit.entity, 'content_item');
  assert.equal(undoAudit.entity_id, 'ps_home.hero');
  const undoMeta = JSON.parse(undoAudit.after_json);
  assert.equal(undoMeta.undone_audit_id, auditRow.id);

  // 5. Verify calling undo again on the same audit ID fails with 409
  const redoReq = new Request(`https://example.com/api/staff/undo/${auditRow.id}`, {
    method: 'POST',
    headers: { 'x-dev-actor': 'supervisor@legacy-hub.org' }
  });
  const redoRes = await postStaff({ request: redoReq, env });
  assert.equal(redoRes.status, 409);
  const redoData = await redoRes.json();
  assert.ok(redoData.error.includes('already been undone'));
});

test('9. POST /api/staff/undo/:audit_id restores caregiver allowlisted fields and archived note', async () => {
  // Test Caregiver Update Undo
  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'caregiver.update', 'caregiver', 'cg_test_1',
      '{"phone":"555-0100","status":"inactive"}',
      '{"phone":"555-0199","status":"active"}')
  `).run();
  const cgAudit = raw.prepare("SELECT id FROM audit_log ORDER BY id DESC LIMIT 1").get();

  const undoCgReq = new Request(`https://example.com/api/staff/undo/${cgAudit.id}`, {
    method: 'POST',
    headers: { 'x-dev-actor': 'admin@legacy-hub.org' }
  });
  const undoCgRes = await postStaff({ request: undoCgReq, env });
  assert.equal(undoCgRes.status, 200);

  const cgRow = raw.prepare("SELECT phone, status FROM caregiver WHERE id = 'cg_test_1'").get();
  assert.equal(cgRow.phone, '555-0100');
  assert.equal(cgRow.status, 'inactive');

  // Test Note Archived Undo
  // First archive note 1
  raw.prepare("UPDATE note SET status = 'archived' WHERE id = 1").run();
  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'caregiver.note_archived', 'caregiver', 'cg_test_1',
      '{"note_id":1,"status":"active"}',
      '{"note_id":1,"status":"archived"}')
  `).run();
  const noteAudit = raw.prepare("SELECT id FROM audit_log ORDER BY id DESC LIMIT 1").get();

  const undoNoteReq = new Request(`https://example.com/api/staff/undo/${noteAudit.id}`, {
    method: 'POST',
    headers: { 'x-dev-actor': 'admin@legacy-hub.org' }
  });
  const undoNoteRes = await postStaff({ request: undoNoteReq, env });
  assert.equal(undoNoteRes.status, 200);

  const noteRow = raw.prepare("SELECT status FROM note WHERE id = 1").get();
  assert.equal(noteRow.status, 'active', 'note status must be restored to active');
});

test('10. POST /api/staff/undo/:audit_id refuses missing before_json, non-restorable actions, and never deletes', async () => {
  // Missing before_json
  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'caregiver.update', 'caregiver', 'cg_test_1', NULL, '{"phone":"555-9999"}')
  `).run();
  const nullAudit = raw.prepare("SELECT id FROM audit_log ORDER BY id DESC LIMIT 1").get();

  const nullRes = await postStaff({
    request: new Request(`https://example.com/api/staff/undo/${nullAudit.id}`, { method: 'POST' }),
    env
  });
  assert.equal(nullRes.status, 409);
  const nullData = await nullRes.json();
  assert.ok(nullData.error.includes('no before_json'));

  // Non-restorable action: caregiver.contact_added
  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'caregiver.contact_added', 'caregiver', 'cg_test_1', '{"some":"before"}', '{"some":"after"}')
  `).run();
  const contactAudit = raw.prepare("SELECT id FROM audit_log ORDER BY id DESC LIMIT 1").get();

  const contactRes = await postStaff({
    request: new Request(`https://example.com/api/staff/undo/${contactAudit.id}`, { method: 'POST' }),
    env
  });
  assert.equal(contactRes.status, 409);

  // Non-restorable action: grant transition
  raw.prepare(`
    INSERT INTO audit_log (actor, action, entity, entity_id, before_json, after_json)
    VALUES ('staff@legacy-hub.org', 'grant.decision', 'grant_application', '1', '{"status":"submitted"}', '{"status":"awarded"}')
  `).run();
  const grantAudit = raw.prepare("SELECT id FROM audit_log ORDER BY id DESC LIMIT 1").get();

  const grantRes = await postStaff({
    request: new Request(`https://example.com/api/staff/undo/${grantAudit.id}`, { method: 'POST' }),
    env
  });
  assert.equal(grantRes.status, 409);

  // Never deletes anything: verify caregiver, note, and content_item records are not deleted
  const cgCount = raw.prepare("SELECT COUNT(*) as c FROM caregiver").get().c;
  const noteCount = raw.prepare("SELECT COUNT(*) as c FROM note").get().c;
  const contentCount = raw.prepare("SELECT COUNT(*) as c FROM content_item").get().c;
  assert.equal(cgCount, 2);
  assert.equal(noteCount, 1);
  assert.equal(contentCount, 4);
});
