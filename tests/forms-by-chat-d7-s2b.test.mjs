// Tests for LEGACY-D7-S2B-FORMS-BY-CHAT-R1
// Verifies form wording and options editable via page_section D1 rows and assistant pipeline.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { onRequest } from '../functions/_middleware.js';
import { _resetContentCache } from '../functions/_content.mjs';
import { onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';
import { seedPageSections } from '../scripts/seed-page-sections.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const SCHEMA_1 = readFileSync(resolve(rootDir, 'schema/0001_init.sql'), 'utf8');
const SCHEMA_3 = readFileSync(resolve(rootDir, 'schema/0003_grant_award.sql'), 'utf8');
const SCHEMA_4 = readFileSync(resolve(rootDir, 'schema/0004_content_types.sql'), 'utf8');
const SCHEMA_9 = readFileSync(resolve(rootDir, 'schema/0009_content_live.sql'), 'utf8');
const SCHEMA_10 = readFileSync(resolve(rootDir, 'schema/0010_page_section_forms.sql'), 'utf8');

function loadHtml(relPath) {
  return readFileSync(resolve(rootDir, relPath), 'utf-8');
}

class FakeD1 {
  constructor(rows = []) {
    this.rows = rows;
  }
  prepare(sql) {
    return {
      all: async () => ({ results: this.rows }),
    };
  }
}

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
            },
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
        },
      };
    },
  };
}

beforeEach(() => {
  _resetContentCache();
});

test('1. the four forms render from page-sections.json with expected copy and options', () => {
  const sectionsContent = JSON.parse(readFileSync(resolve(rootDir, 'content/page-sections.json'), 'utf8'));
  const items = sectionsContent.items;

  // Verify all 4 sections exist in content/page-sections.json
  assert.ok(items['form.membership']);
  assert.ok(items['form.grant_apply']);
  assert.ok(items['form.coaching_interest']);
  assert.ok(items['form.request_support']);

  // Check form.membership in index.html
  const indexHtml = loadHtml('index.html');
  const mem = items['form.membership'];
  assert.ok(indexHtml.includes(mem.heading));
  assert.ok(indexHtml.includes(mem.sub));
  assert.ok(indexHtml.includes(mem.name_label));
  assert.ok(indexHtml.includes(mem.name_placeholder));
  assert.ok(indexHtml.includes(mem.email_label));
  assert.ok(indexHtml.includes(mem.caring_for_label));
  for (const opt of mem.caring_for_options) {
    assert.ok(indexHtml.includes(`<option value="${opt}">${opt}</option>`));
  }
  assert.ok(indexHtml.includes(mem.privacy_line));
  assert.ok(indexHtml.includes(mem.submit_label));

  // Check form.grant_apply in programs.html
  const programsHtml = loadHtml('programs.html');
  const grant = items['form.grant_apply'];
  assert.ok(programsHtml.includes(grant.heading));
  assert.ok(programsHtml.includes(grant.sub));
  assert.ok(programsHtml.includes(grant.requested_for_label));
  assert.ok(programsHtml.includes(grant.requested_for_placeholder));
  assert.ok(programsHtml.includes(grant.submit_label));

  // Check form.coaching_interest in programs.html
  const coach = items['form.coaching_interest'];
  assert.ok(programsHtml.includes(coach.heading));
  assert.ok(programsHtml.includes(coach.sub));
  assert.ok(programsHtml.includes(coach.note_label));
  assert.ok(programsHtml.includes(coach.note_placeholder));
  assert.ok(programsHtml.includes(coach.submit_label));

  // Check form.request_support in request-support.html
  const reqHtml = loadHtml('request-support.html');
  const reqSupport = items['form.request_support'];
  assert.ok(reqHtml.includes(reqSupport.heading));
  assert.ok(reqHtml.includes(reqSupport.sub));
  assert.ok(reqHtml.includes(reqSupport.name_label));
  assert.ok(reqHtml.includes(reqSupport.who_label));
  for (const opt of reqSupport.who_options) {
    assert.ok(reqHtml.includes(`<option value="${opt}">${opt}</option>`));
  }
  for (const opt of reqSupport.what_options) {
    assert.ok(reqHtml.includes(`<option value="${opt}">${opt}</option>`));
  }
  assert.ok(reqHtml.includes(reqSupport.privacy_line));
  assert.ok(reqHtml.includes(reqSupport.submit_label));
});

test('2. a published form.request_support row with new option wording shows on the page through edge rewrite', async () => {
  const committedHtml = loadHtml('request-support.html');
  const newWhoOptions = [
    'A loving daughter or son',
    'A devoted spouse or partner',
    'A caring friend or neighbor',
  ];
  const newWhatOptions = [
    'Immediate Respite Care',
    'Emergency Stipend Assistance',
    'Caregiver Coaching Session',
  ];

  const db = new FakeD1([
    {
      id: 'ps_form.request_support',
      status: 'published',
      data: JSON.stringify({
        heading: 'Tell us how we can help today',
        sub: 'Our dedicated team responds within 24 hours.',
        who_options: newWhoOptions,
        what_options: newWhatOptions,
        submit_label: 'Submit My Request Now',
      }),
    },
  ]);

  const request = new Request('https://legacy-hub.pages.dev/request-support.html', { method: 'GET' });
  const next = async () =>
    new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
  assert.equal(resp.status, 200);

  const html = await resp.text();

  // Headings and labels updated
  assert.ok(html.includes('Tell us how we can help today'));
  assert.ok(html.includes('Our dedicated team responds within 24 hours.'));
  assert.ok(html.includes('Submit My Request Now'));

  // Option lists rewritten with value and text
  for (const opt of newWhoOptions) {
    assert.ok(html.includes(`<option value="${opt}">${opt}</option>`));
  }
  for (const opt of newWhatOptions) {
    assert.ok(html.includes(`<option value="${opt}">${opt}</option>`));
  }

  // Committed options should have been replaced
  assert.ok(!html.includes('<option>A family caregiver (for myself)</option>'));
  assert.ok(!html.includes('<option>Referring a caregiver I know</option>'));
});

test('3. hostile option text is properly escaped and never rendered as raw executable markup', async () => {
  const committedHtml = loadHtml('index.html');
  const hostileOptions = [
    '<script>alert("pwned")</script>',
    '<img src=x onerror=alert(1)>',
    '"><b onfocus=alert(1)>Click Me</b>',
  ];

  const db = new FakeD1([
    {
      id: 'ps_form.membership',
      status: 'published',
      data: JSON.stringify({
        heading: 'Safe Sanctuary',
        caring_for_options: hostileOptions,
      }),
    },
  ]);

  const request = new Request('https://legacy-hub.pages.dev/index.html', { method: 'GET' });
  const next = async () =>
    new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
  assert.equal(resp.status, 200);

  const html = await resp.text();

  // Must contain properly escaped HTML entities
  assert.ok(html.includes('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&quot;&gt;&lt;b onfocus=alert(1)&gt;Click Me&lt;/b&gt;'));

  // Must NOT contain raw executable HTML
  assert.ok(!html.includes('<script>alert("pwned")</script>'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});

test('4. empty option list leaves committed options untouched', async () => {
  const committedHtml = loadHtml('index.html');

  const db = new FakeD1([
    {
      id: 'ps_form.membership',
      status: 'published',
      data: JSON.stringify({
        heading: 'Empty Options Test',
        caring_for_options: [], // empty list
      }),
    },
  ]);

  const request = new Request('https://legacy-hub.pages.dev/index.html', { method: 'GET' });
  const next = async () =>
    new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
  assert.equal(resp.status, 200);

  const html = await resp.text();

  // Heading updated
  assert.ok(html.includes('Empty Options Test'));

  // Committed options remain present
  assert.ok(html.includes('<option value="A parent or older adult">A parent or older adult</option>'));
  assert.ok(html.includes('<option value="A spouse or partner">A spouse or partner</option>'));
  assert.ok(html.includes('<option value="A family member or friend">A family member or friend</option>'));
  assert.ok(html.includes('<option value="I am exploring support options">I am exploring support options</option>'));
});

test('5. assistant draft to form.membership goes through draft, preview, confirm and is audited', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_4);
  raw.exec(SCHEMA_9);
  raw.exec(SCHEMA_10);

  // Seed sections from content/page-sections.json
  await seedPageSections({ db: raw });

  const beforeTarget = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_form.membership'`).get();
  assert.ok(beforeTarget);
  assert.equal(beforeTarget.status, 'published');
  const beforeData = JSON.parse(beforeTarget.data);

  let mockMapperResult = {
    ok: true,
    change: {
      section_key: 'form.membership',
      heading: 'Welcome to Our Sanctuary Community',
      submit_label: 'Join Today Free',
    },
  };

  const env = {
    LEGACY_DB: d1(raw),
    AGENT_MAPPER_BACKEND: () => mockMapperResult,
  };

  // 1. Create draft
  const draftReq = new Request('http://localhost/api/agent/draft', {
    method: 'POST',
    body: JSON.stringify({
      target_id: 'ps_form.membership',
      type_id: 'page_section',
      request: 'Change the membership form heading to Welcome to Our Sanctuary Community and button to Join Today Free',
    }),
  });

  const draftRes = await postAgent({ request: draftReq, env });
  assert.equal(draftRes.status, 200);
  const draftJson = await draftRes.json();
  assert.ok(draftJson.ok);
  assert.ok(draftJson.draft_id.startsWith('cid_'));

  // Preview contains proposed changes
  assert.ok(draftJson.preview);
  assert.equal(draftJson.preview.heading, 'Welcome to Our Sanctuary Community');
  assert.equal(draftJson.preview.submit_label, 'Join Today Free');

  // Published target row remains untouched
  const afterDraftTarget = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_form.membership'`).get();
  assert.equal(afterDraftTarget.status, 'published');
  assert.deepEqual(JSON.parse(afterDraftTarget.data), beforeData);

  // Draft row exists in D1
  const draftRow = raw.prepare(`SELECT * FROM content_item WHERE id = ?`).get(draftJson.draft_id);
  assert.ok(draftRow);
  assert.equal(draftRow.status, 'draft');
  assert.equal(draftRow.draft_of, 'ps_form.membership');
  const draftData = JSON.parse(draftRow.data);
  assert.equal(draftData.heading, 'Welcome to Our Sanctuary Community');

  // 2. Confirm draft with staff actor
  const confirmReq = new Request('http://localhost/api/agent/confirm', {
    method: 'POST',
    headers: { 'Cf-Access-Jwt-Assertion': 'h.eyJlbWFpbCI6InN0YWZmX21hbmFnZXJAZXhhbXBsZS5vcmcifQ.sig' },
    body: JSON.stringify({ draft_id: draftJson.draft_id }),
  });

  const confirmRes = await postAgent({ request: confirmReq, env });
  assert.equal(confirmRes.status, 200);
  const confirmJson = await confirmRes.json();
  assert.ok(confirmJson.ok);

  // Target row is updated, published, updated_by staff
  const confirmedTarget = raw.prepare(`SELECT * FROM content_item WHERE id = 'ps_form.membership'`).get();
  assert.equal(confirmedTarget.status, 'published');
  assert.equal(confirmedTarget.updated_by, 'staff_staff_manager@example.org');
  const confirmedData = JSON.parse(confirmedTarget.data);
  assert.equal(confirmedData.heading, 'Welcome to Our Sanctuary Community');
  assert.equal(confirmedData.submit_label, 'Join Today Free');

  // Draft row is archived
  const archivedDraft = raw.prepare(`SELECT * FROM content_item WHERE id = ?`).get(draftJson.draft_id);
  assert.equal(archivedDraft.status, 'archived');

  // Audit log records content_item.publish
  const audit = raw.prepare(`SELECT * FROM audit_log WHERE entity = 'content_item' AND entity_id = 'ps_form.membership'`).get();
  assert.ok(audit);
  assert.equal(audit.action, 'content_item.publish');
  assert.equal(audit.actor, 'staff_manager@example.org');
  const auditAfter = JSON.parse(audit.after_json);
  assert.equal(auditAfter.status, 'published');
  assert.equal(auditAfter.data.heading, 'Welcome to Our Sanctuary Community');
});

test('6. options with apostrophes render with literal single quotes, matching build output', async () => {
  const committedHtml = loadHtml('index.html');
  const apostropheOptions = [
    "I'm caring for a family member",
    "Don't know yet",
  ];

  const db = new FakeD1([
    {
      id: 'ps_form.membership',
      status: 'published',
      data: JSON.stringify({
        caring_for_options: apostropheOptions,
      }),
    },
  ]);

  const request = new Request('https://legacy-hub.pages.dev/index.html', { method: 'GET' });
  const next = async () =>
    new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
  assert.equal(resp.status, 200);

  const html = await resp.text();

  // Must contain literal single quotes, not &#39;
  assert.ok(html.includes('<option value="I\'m caring for a family member">I\'m caring for a family member</option>'));
  assert.ok(html.includes('<option value="Don\'t know yet">Don\'t know yet</option>'));
});
