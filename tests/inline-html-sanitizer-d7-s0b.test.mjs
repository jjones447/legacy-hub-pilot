// Tests for LEGACY-D7-S0B-FIX-R1 (Issue #122)
// Covers:
// 1. Inline HTML allowlist verification (br, strong, em, span with class only, a with href only)
// 2. Sanitizer escaping hostile payloads (<script>, onerror=, javascript:, style=) to inert text
// 3. Write-path rejection of disallowed HTML in draft and direct edits
// 4. Single-quote preservation (' remains ' without &#39; escaping)

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  isAllowedHref,
  isAllowedTag,
  sanitizeInlineHtml,
  findDisallowedHtml,
  validateInlineHtmlPayload
} from '../functions/_content.mjs';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';

const SCHEMA_1 = readFileSync(new URL('../schema/0001_init.sql', import.meta.url), 'utf8');
const SCHEMA_3 = readFileSync(new URL('../schema/0003_grant_award.sql', import.meta.url), 'utf8');
const SCHEMA_4 = readFileSync(new URL('../schema/0004_content_types.sql', import.meta.url), 'utf8');
const SCHEMA_9 = readFileSync(new URL('../schema/0009_content_live.sql', import.meta.url), 'utf8');

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
  raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA_1);
  raw.exec(SCHEMA_3);
  raw.exec(SCHEMA_4);
  raw.exec(SCHEMA_9);

  // Seed sample published page section
  raw.prepare(`
    INSERT INTO content_item (id, type_id, data, status, updated_by)
    VALUES (?, ?, ?, 'published', 'staff_seed')
  `).run(
    'ps_home.hero',
    'page_section',
    JSON.stringify({
      section_key: 'home.hero',
      title: 'A place for caregivers',
      lede: 'We support family caregivers'
    })
  );

  env = {
    LEGACY_DB: d1(raw),
    ALLOW_DEV_CONSOLE: '1',
    CF_PAGES: '1'
  };
});

test('1. isAllowedHref correctly accepts safe URLs and rejects unsafe schemes', () => {
  // Relative URLs
  assert.equal(isAllowedHref('resources.html'), true);
  assert.equal(isAllowedHref('/programs-events.html'), true);
  assert.equal(isAllowedHref('#support-group'), true);
  assert.equal(isAllowedHref('events.html?view=all&cat=caregiver'), true);

  // Allowed absolute schemes: https, mailto, tel
  assert.equal(isAllowedHref('https://legacy-hub.org/info'), true);
  assert.equal(isAllowedHref('mailto:support@legacy-hub.org'), true);
  assert.equal(isAllowedHref('tel:+15551234567'), true);

  // Disallowed: protocol-relative
  assert.equal(isAllowedHref('//evil.com/phish'), false);

  // Disallowed: insecure or active scripting schemes
  assert.equal(isAllowedHref('http://insecure.example.com'), false);
  assert.equal(isAllowedHref('javascript:alert(1)'), false);
  assert.equal(isAllowedHref('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isAllowedHref('vbscript:msgbox(1)'), false);

  // Disallowed: invalid characters or whitespace
  assert.equal(isAllowedHref('https://example.com/ "><script>'), false);
  assert.equal(isAllowedHref('   '), false);
  assert.equal(isAllowedHref(null), false);
});

test('2. isAllowedTag enforces inline allowlist and attribute restrictions', () => {
  // Allowed tags
  assert.equal(isAllowedTag('<br>'), true);
  assert.equal(isAllowedTag('<br/>'), true);
  assert.equal(isAllowedTag('<br />'), true);
  assert.equal(isAllowedTag('<strong>'), true);
  assert.equal(isAllowedTag('</strong>'), true);
  assert.equal(isAllowedTag('<em>'), true);
  assert.equal(isAllowedTag('</em>'), true);
  assert.equal(isAllowedTag('<span class="badge">'), true);
  assert.equal(isAllowedTag('<span class="badge badge-blue">'), true);
  assert.equal(isAllowedTag('</span>'), true);
  assert.equal(isAllowedTag('<a href="resources.html">'), true);
  assert.equal(isAllowedTag('<a href="https://legacy-hub.org">'), true);
  assert.equal(isAllowedTag('</a>'), true);

  // Disallowed attributes on allowed tags
  assert.equal(isAllowedTag('<br class="break">'), false);
  assert.equal(isAllowedTag('<strong style="color:red">'), false);
  assert.equal(isAllowedTag('<em onclick="alert(1)">'), false);
  assert.equal(isAllowedTag('<span style="color:red">'), false);
  assert.equal(isAllowedTag('<span class="badge" onclick="alert(1)">'), false);
  assert.equal(isAllowedTag('<a href="resources.html" target="_blank">'), false);
  assert.equal(isAllowedTag('<a href="javascript:alert(1)">'), false);
  assert.equal(isAllowedTag('<a href="http://legacy-hub.org">'), false);

  // Disallowed tags entirely
  assert.equal(isAllowedTag('<script>'), false);
  assert.equal(isAllowedTag('</script>'), false);
  assert.equal(isAllowedTag('<style>'), false);
  assert.equal(isAllowedTag('<div>'), false);
  assert.equal(isAllowedTag('<p>'), false);
  assert.equal(isAllowedTag('<img src=x onerror=alert(1)>'), false);
  assert.equal(isAllowedTag('<iframe>'), false);
});

test('3. sanitizeInlineHtml renders allowed tags and neutralizes hostile payloads', () => {
  // Preserves allowed tags intact
  const safe = 'Caregiving can change.<br>You <strong>shouldn\'t</strong> have to navigate it <em>alone</em>.';
  assert.equal(sanitizeInlineHtml(safe), safe);

  const spanSafe = 'Status: <span class="badge badge-blue">Community Center</span>';
  assert.equal(sanitizeInlineHtml(spanSafe), spanSafe);

  const linkSafe = 'See <a href="resources.html">Crisis Help</a> for support.';
  assert.equal(sanitizeInlineHtml(linkSafe), linkSafe);

  // Preserves single quotes verbatim (no &#39;)
  assert.equal(sanitizeInlineHtml('didn\'t couldn\'t shouldn\'t'), 'didn\'t couldn\'t shouldn\'t');

  // Disallowed tags escaped
  assert.equal(
    sanitizeInlineHtml('<script>alert("pwned")</script>'),
    '&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;'
  );
  assert.equal(
    sanitizeInlineHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
  assert.equal(
    sanitizeInlineHtml('<span style="color:red">styled</span>'),
    '&lt;span style=&quot;color:red&quot;&gt;styled</span>'
  );
  assert.equal(
    sanitizeInlineHtml('<a href="javascript:alert(1)">click</a>'),
    '&lt;a href=&quot;javascript:alert(1)&quot;&gt;click</a>'
  );
});

test('4. POST /api/agent/change/direct rejects disallowed HTML with 400', async () => {
  const hostileData = {
    section_key: 'home.hero',
    title: 'Safe Title <script>alert(1)</script>',
    lede: 'Safe lede copy'
  };

  const req = new Request('https://example.com/api/agent/change/direct', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dev-actor': 'coordinator@legacy-hub.org'
    },
    body: JSON.stringify({
      target_id: 'ps_home.hero',
      data: hostileData
    })
  });

  const res = await postAgent({ request: req, env });
  const data = await res.json();

  assert.equal(res.status, 400);
  assert.equal(data.ok, false);
  assert.ok(data.error.includes('disallowed HTML'), 'must return disallowed HTML error');
});

test('5. POST /api/agent/change/direct allows safe inline HTML with 200', async () => {
  const safeData = {
    section_key: 'home.hero',
    title: 'Caregiver Sanctuary <br> <strong>Support</strong>',
    lede: 'Free membership with specialized support for family caregivers.'
  };

  const req = new Request('https://example.com/api/agent/change/direct', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dev-actor': 'coordinator@legacy-hub.org'
    },
    body: JSON.stringify({
      target_id: 'ps_home.hero',
      data: safeData
    })
  });

  const res = await postAgent({ request: req, env });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.id, 'ps_home.hero');
});

test('6. POST /api/agent/draft refuses proposed changes with disallowed HTML', async () => {
  // Configure mock backend returning hostile change
  const hostileBackend = () => ({
    ok: true,
    change: {
      section_key: 'home.hero',
      title: 'Title with <a href="javascript:alert(1)">evil</a>',
      lede: 'Lede text'
    }
  });

  const customEnv = {
    ...env,
    AGENT_MAPPER_BACKEND: hostileBackend
  };

  const req = new Request('https://example.com/api/agent/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type_id: 'page_section',
      target_id: 'ps_home.hero',
      request: 'Add link'
    })
  });

  const res = await postAgent({ request: req, env: customEnv });
  const data = await res.json();

  assert.equal(data.ok, false);
  assert.ok(data.refusal.includes('disallowed HTML'), 'must return refusal for disallowed HTML');
});
