// Tests for published content edge rewrites per D-011 (LEGACY-D7-S0B-EDGE-RENDER-CONTENT-R1)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { onRequest } from '../functions/_middleware.js';
import { onRequestGet as getAgent, onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';
import { onRequest as handleWebJobs } from '../functions/api/agent/web-jobs.js';
import { seedPageSections } from '../scripts/seed-page-sections.mjs';
import {
  _resetContentCache,
  escapeHtml,
  isRewritableRoute,
  getPublishedSections,
  rewriteContent,
  maybeRewriteContent,
  buildContentPreviewInfo,
} from '../functions/_content.mjs';
import {
  confirmationBinding,
  setVerifiedAccessStaffActor,
  draftOwner,
} from '../functions/_lib/agent-confirmation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

function loadHtml(relPath) {
  return readFileSync(resolve(rootDir, relPath), 'utf-8');
}

class FakeD1 {
  constructor(rows = [], staffRows = []) {
    this.rows = rows;
    this.staffRows = staffRows;
    this.auditRows = [];
    this.queryCount = 0;
    this.shouldThrow = false;
  }
  async batch(stmts) {
    const out = [];
    for (const stmt of stmts) {
      out.push(await stmt.run());
    }
    return out;
  }
  prepare(sql) {
    const self = this;
    const matchRow = (params = []) => {
      if (self.shouldThrow) {
        throw new Error('D1 query error');
      }
      if (/FROM\s+staff_member/i.test(sql)) {
        const emailParam = String(params[0] || '').toLowerCase();
        return self.staffRows.find((s) => String(s.email || '').toLowerCase() === emailParam) || null;
      }
      if (/FROM\s+content_item\s+WHERE\s+id\s*=\s*\?/i.test(sql)) {
        const idParam = params[0];
        return self.rows.find((r) => r.id === idParam) || null;
      }
      return null;
    };
    const runBound = async (params = []) => {
      if (self.shouldThrow) throw new Error('D1 query error');
      if (/INSERT\s+INTO\s+content_item/i.test(sql)) {
        self.rows.push({
          id: params[0],
          type_id: 'page_section',
          data: params[1],
          status: 'draft',
          draft_of: params[2],
          updated_by: params[3],
          updated_at: '2026-10-29 19:00:00',
        });
      } else if (/INSERT\s+INTO\s+audit_log/i.test(sql)) {
        self.auditRows.push({
          actor: params[0],
          action: 'content_item.staging_preview_stage',
          entity: 'content_item',
          entity_id: params[1],
          before_json: params[2],
          after_json: params[3],
        });
      }
      return { success: true };
    };
    return {
      bind(...params) {
        return {
          first: async () => matchRow(params),
          run: () => runBound(params),
          all: async () => {
            self.queryCount++;
            if (self.shouldThrow) throw new Error('D1 query error');
            const single = matchRow(params);
            return { results: single ? [single] : [] };
          },
        };
      },
      first: async () => matchRow([]),
      run: () => runBound([]),
      all: async () => {
        self.queryCount++;
        if (self.shouldThrow) {
          throw new Error('D1 query error');
        }
        return { results: self.rows.filter((r) => !r.status || r.status === 'published') };
      },
    };
  }
}

beforeEach(() => {
  _resetContentCache();
});

test('escapeHtml properly escapes HTML special characters', () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(\'xss\')">&'),
    '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;'
  );
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml('plain text'), 'plain text');
});

test('isRewritableRoute excludes staff console and api endpoints', () => {
  assert.equal(isRewritableRoute('/staff.html'), false);
  assert.equal(isRewritableRoute('/staff'), false);
  assert.equal(isRewritableRoute('/staff/queue'), false);
  assert.equal(isRewritableRoute('/api'), false);
  assert.equal(isRewritableRoute('/api/intake'), false);
  assert.equal(isRewritableRoute('/api/staff/caregiver'), false);

  assert.equal(isRewritableRoute('/'), true);
  assert.equal(isRewritableRoute('/index.html'), true);
  assert.equal(isRewritableRoute('/about.html'), true);
  assert.equal(isRewritableRoute('/programs.html'), true);
  assert.equal(isRewritableRoute('/request-support.html'), true);
});

test('published row replaces marked text on public page via onRequest middleware', async () => {
  const committedHtml = loadHtml('index.html');
  const db = new FakeD1([
    {
      id: 'ps_home.hero',
      status: 'published',
      data: JSON.stringify({
        title: 'Updated Caregiver Sanctuary Headline',
        lede: 'Updated custom lede text for caregivers.',
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
  assert.ok(html.includes('Updated Caregiver Sanctuary Headline'));
  assert.ok(html.includes('Updated custom lede text for caregivers.'));
  assert.ok(!html.includes('A place for caregivers to find support, respite, wellness and community.'));

  // Baseline security headers should remain present
  assert.equal(resp.headers.get('x-frame-options'), 'DENY');
  assert.equal(resp.headers.get('x-content-type-options'), 'nosniff');
});

test('hostile value (<img src=x onerror=alert(1)>) is rendered as text, never raw markup', async () => {
  const committedHtml = loadHtml('index.html');
  const db = new FakeD1([
    {
      id: 'ps_home.hero',
      status: 'published',
      data: JSON.stringify({
        title: '<img src=x onerror=alert(1)>',
        lede: '<script>alert("pwned")</script>',
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
  // Must render escaped entities
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;'));

  // Must NOT contain executable unescaped markup
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('<script>alert("pwned")</script>'));
});

test('list field renders escaped <p> elements for each array item', async () => {
  const committedHtml = loadHtml('about.html');
  const db = new FakeD1([
    {
      id: 'ps_about.story',
      status: 'published',
      data: JSON.stringify({
        eyebrow: 'Our Rewritten Story',
        heading: 'From Heartbreak to Healing',
        paragraphs: [
          'First paragraph of our new story.',
          'Second paragraph with <img src=x onerror=alert(1)> hostile payload.',
          'Third paragraph concluding the journey.',
        ],
        note: 'Updated review note.',
      }),
    },
  ]);

  const request = new Request('https://legacy-hub.pages.dev/about.html', { method: 'GET' });
  const next = async () =>
    new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
  assert.equal(resp.status, 200);

  const html = await resp.text();
  assert.ok(html.includes('Our Rewritten Story'));
  assert.ok(html.includes('From Heartbreak to Healing'));
  assert.ok(html.includes('<p class="muted mb-16">First paragraph of our new story.</p>'));
  assert.ok(
    html.includes(
      '<p class="muted mb-16">Second paragraph with &lt;img src=x onerror=alert(1)&gt; hostile payload.</p>'
    )
  );
  assert.ok(html.includes('<p class="muted mb-16">Third paragraph concluding the journey.</p>'));
  assert.ok(!html.includes('Legacy began as a home health agency.'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});

test('fallback pass-through when LEGACY_DB binding is absent leaves HTML byte-identical', async () => {
  const committedHtml = loadHtml('index.html');
  const request = new Request('https://legacy-hub.pages.dev/index.html', { method: 'GET' });
  const next = async () =>
    new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  const resp = await onRequest({ request, next, env: {} });
  assert.equal(resp.status, 200);

  const html = await resp.text();
  assert.equal(html, committedHtml);
});

test('fallback pass-through when D1 errors or returns no rows leaves HTML byte-identical', async () => {
  const committedHtml = loadHtml('index.html');
  const next = async () =>
    new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  // 1. D1 throws an error
  {
    _resetContentCache();
    const db = new FakeD1([]);
    db.shouldThrow = true;
    const request = new Request('https://legacy-hub.pages.dev/index.html', { method: 'GET' });
    const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
    assert.equal(await resp.text(), committedHtml);
  }

  // 2. D1 returns 0 rows
  {
    _resetContentCache();
    const db = new FakeD1([]);
    const request = new Request('https://legacy-hub.pages.dev/index.html', { method: 'GET' });
    const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
    assert.equal(await resp.text(), committedHtml);
  }
});

test('unknown keys, missing fields, or wrong types leave committed content untouched', async () => {
  const committedHtml = loadHtml('programs.html');
  const db = new FakeD1([
    {
      id: 'ps_programs.membership',
      status: 'published',
      data: JSON.stringify({
        // eyebrow is missing
        heading: 12345, // wrong type (number instead of string)
        paragraphs: 'not an array', // wrong type (string instead of array)
      }),
    },
    {
      id: 'ps_other_section', // unknown section
      status: 'published',
      data: JSON.stringify({ title: 'Irrelevant' }),
    },
  ]);

  const request = new Request('https://legacy-hub.pages.dev/programs.html', { method: 'GET' });
  const next = async () =>
    new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
  assert.equal(resp.status, 200);

  const html = await resp.text();
  // Committed content must remain untouched
  assert.ok(html.includes('One membership, every kind of support'));
  assert.ok(
    html.includes(
      'Sanctuary membership is free and connects you to everything Legacy offers'
    )
  );
});

test('in-memory cache reuses query results within 60s TTL', async () => {
  const db = new FakeD1([
    {
      id: 'ps_home.hero',
      status: 'published',
      data: JSON.stringify({ title: 'Cached Title' }),
    },
  ]);

  const t0 = 1000000;
  const sections1 = await getPublishedSections({ LEGACY_DB: db }, t0);
  assert.equal(sections1['home.hero'].title, 'Cached Title');
  assert.equal(db.queryCount, 1);

  // Within 60s TTL
  const sections2 = await getPublishedSections({ LEGACY_DB: db }, t0 + 30000);
  assert.equal(sections2['home.hero'].title, 'Cached Title');
  assert.equal(db.queryCount, 1);

  // After 60s TTL expired
  const sections3 = await getPublishedSections({ LEGACY_DB: db }, t0 + 65000);
  assert.equal(sections3['home.hero'].title, 'Cached Title');
  assert.equal(db.queryCount, 2);
});

test('staff console and API routes pass through without content rewriting', async () => {
  const committedStaffHtml = loadHtml('staff.html');
  const db = new FakeD1([
    {
      id: 'ps_home.hero',
      status: 'published',
      data: JSON.stringify({ title: 'Should Not Appear on Staff Console' }),
    },
  ]);

  const request = new Request('https://legacy-hub.pages.dev/staff.html', { method: 'GET' });
  const next = async () =>
    new Response(committedStaffHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

  // Using non-prod escape ALLOW_DEV_CONSOLE="1" to simulate reaching staff console
  const resp = await onRequest({
    request,
    next,
    env: { LEGACY_DB: db, ALLOW_DEV_CONSOLE: '1' },
  });

  const html = await resp.text();
  assert.equal(html, committedStaffHtml);
  assert.ok(!html.includes('Should Not Appear on Staff Console'));
});

test('multiple sections rewrite cleanly on programs and request-support pages', async () => {
  const db = new FakeD1([
    {
      id: 'ps_programs.hero',
      status: 'published',
      data: JSON.stringify({
        title: 'New Programs Hero Title',
        lede: 'New Programs Hero Lede',
        cta_label: 'Join Now Free',
      }),
    },
    {
      id: 'ps_programs.coaching',
      status: 'published',
      data: JSON.stringify({
        badge: 'Available Now',
        heading: 'One-on-One Coaching',
        body: 'Personal guidance sessions.',
        cta_label: 'Book Session',
      }),
    },
    {
      id: 'ps_request_support.hero',
      status: 'published',
      data: JSON.stringify({
        title: 'We Are Here For You',
        lede: 'Fill out this simple form to connect with our caregivers.',
      }),
    },
    {
      id: 'ps_form.request_support',
      status: 'published',
      data: JSON.stringify({
        heading: 'Share Your Details',
        sub: 'We will respond promptly.',
      }),
    },
  ]);

  // Check programs.html
  {
    const committedHtml = loadHtml('programs.html');
    const request = new Request('https://legacy-hub.pages.dev/programs.html', { method: 'GET' });
    const next = async () =>
      new Response(committedHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
    const html = await resp.text();
    assert.ok(html.includes('New Programs Hero Title'));
    assert.ok(html.includes('New Programs Hero Lede'));
    assert.ok(html.includes('Join Now Free'));
    assert.ok(html.includes('Available Now'));
    assert.ok(html.includes('One-on-One Coaching'));
    assert.ok(html.includes('Personal guidance sessions.'));
    assert.ok(html.includes('Book Session'));
  }

  // Check request-support.html
  {
    const committedHtml = loadHtml('request-support.html');
    const request = new Request('https://legacy-hub.pages.dev/request-support.html', {
      method: 'GET',
    });
    const next = async () =>
      new Response(committedHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    const resp = await onRequest({ request, next, env: { LEGACY_DB: db } });
    const html = await resp.text();
    assert.ok(html.includes('We Are Here For You'));
    assert.ok(html.includes('Fill out this simple form to connect with our caregivers.'));
    assert.ok(html.includes('Share Your Details'));
    assert.ok(html.includes('We will respond promptly.'));
  }
});

const PREVIEW_TEAM = 'legacy-preview.cloudflareaccess.com';
const PREVIEW_ISS = `https://${PREVIEW_TEAM}`;
const PREVIEW_AUD = 'preview_aud_tag';
let _previewKeyPair = null;
let _previewJwk = null;

async function ensurePreviewKeys() {
  if (_previewKeyPair) return { keyPair: _previewKeyPair, jwk: _previewJwk };
  _previewKeyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  _previewJwk = await crypto.subtle.exportKey('jwk', _previewKeyPair.publicKey);
  _previewJwk.kid = 'preview-k1';
  return { keyPair: _previewKeyPair, jwk: _previewJwk };
}

function b64urlBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makePreviewAccessJwt({ email = 'jane@legacy.org', common_name, expOffsetSec = 3600 } = {}) {
  const { keyPair } = await ensurePreviewKeys();
  const enc = new TextEncoder();
  const header = { alg: 'RS256', kid: 'preview-k1', typ: 'JWT' };
  const payload = {
    aud: PREVIEW_AUD,
    iss: PREVIEW_ISS,
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
    ...(email ? { email } : {}),
    ...(common_name ? { common_name } : {}),
  };
  const h = b64urlBytes(enc.encode(JSON.stringify(header)));
  const p = b64urlBytes(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64urlBytes(new Uint8Array(sig))}`;
}

async function withPreviewJwks(fn) {
  const { jwk } = await ensurePreviewKeys();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/cdn-cgi/access/certs')) {
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    }
    return prevFetch(url, opts);
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = prevFetch;
  }
}

test('preview_draft query parameter overlays unconfirmed draft wording with non-published banner and no-store header for verified owner in preview environment without mutating published cache', async () => {
  await withPreviewJwks(async () => {
    const committedHtml = loadHtml('index.html');
    const publishedTarget = {
      id: 'ps_home.hero',
      type_id: 'page_section',
      status: 'published',
      draft_of: null,
      updated_by: 'seed',
      updated_at: '2026-10-01 00:00:00',
      data: JSON.stringify({
        section_key: 'home.hero',
        title: 'Published Live Hero Title',
        lede: 'Published Live Hero Lede',
      }),
    };
    const draftRow = {
      id: 'cid_preview_draft_1',
      type_id: 'page_section',
      status: 'draft',
      draft_of: 'ps_home.hero',
      updated_by: draftOwner('jane@legacy.org'),
      updated_at: '2026-10-29 15:00:00',
      data: JSON.stringify({
        section_key: 'home.hero',
        title: 'Proposed Staging Preview Hero Title',
        lede: 'Proposed Staging Preview Hero Lede',
      }),
    };
    const db = new FakeD1(
      [publishedTarget, draftRow],
      [{ email: 'jane@legacy.org', display_name: 'Jane', role: 'staff', status: 'active' }]
    );
    const binding = await confirmationBinding(db, 'content', draftRow, 'https://staging.caregiversanctuary.org', publishedTarget);
    const token = await makePreviewAccessJwt({ email: 'jane@legacy.org' });

    const next = async () =>
      new Response(committedHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    const env = {
      ENVIRONMENT: 'preview',
      CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
      CF_ACCESS_AUD: PREVIEW_AUD,
      LEGACY_DB: db,
    };

    // 1. Authenticated owner request with exact preview_version renders draft overlay + banner
    const previewReq = new Request(
      `https://staging.caregiversanctuary.org/index.html?preview_draft=cid_preview_draft_1&preview_version=${binding.version}`,
      {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }
    );
    const previewResp = await onRequest({ request: previewReq, next, env });
    assert.equal(previewResp.status, 200);
    assert.equal(previewResp.headers.get('cache-control'), 'no-store');
    const previewHtml = await previewResp.text();
    assert.ok(previewHtml.includes('Proposed Staging Preview Hero Title'));
    assert.ok(previewHtml.includes('Proposed Staging Preview Hero Lede'));
    assert.ok(previewHtml.includes('data-preview-draft-id="cid_preview_draft_1"'));
    assert.ok(previewHtml.includes(`data-preview-version="${binding.version}"`));
    assert.ok(previewHtml.includes('not yet published'));

    // 2. Subsequent normal public request without ?preview_draft serves untouched published content
    const normalReq = new Request('https://staging.caregiversanctuary.org/index.html', {
      method: 'GET',
    });
    const normalResp = await onRequest({ request: normalReq, next, env });
    assert.equal(normalResp.status, 200);
    const normalHtml = await normalResp.text();
    assert.ok(normalHtml.includes('Published Live Hero Title'));
    assert.ok(!normalHtml.includes('Proposed Staging Preview Hero Title'));
    assert.ok(!normalHtml.includes('data-preview-draft-id="cid_preview_draft_1"'));
  });
});

test('two-isolated-DB boundary: raw production draft IDs fail closed (404) on staging DB while verified cross-environment transfer materializes an authenticated staging draft without DB cross-contamination', async () => {
  await withPreviewJwks(async () => {
    const committedHtml = loadHtml('programs.html');
    // Production DB (3c06) has the draft, while Staging DB (42be) only has published rows
    const prodPublished = {
      id: 'ps_programs.hero',
      type_id: 'page_section',
      status: 'published',
      draft_of: null,
      updated_by: 'seed',
      updated_at: '2026-10-01 00:00:00',
      data: JSON.stringify({
        section_key: 'programs.hero',
        title: 'Published Programs Title',
        lede: 'Published Programs Lede',
        cta_label: 'Join Free',
      }),
    };
    const prodDraft = {
      id: 'cid_prod_only_draft_99',
      type_id: 'page_section',
      status: 'draft',
      draft_of: 'ps_programs.hero',
      updated_by: draftOwner('jane@legacy.org'),
      updated_at: '2026-10-29 15:10:00',
      data: JSON.stringify({
        section_key: 'programs.hero',
        title: 'Production-Only Draft Title',
        lede: 'Production-Only Draft Lede',
        cta_label: 'Join Today',
      }),
    };
    const staffList = [
      { email: 'jane@legacy.org', display_name: 'Jane', role: 'staff', status: 'active' },
      { email: 'other@legacy.org', display_name: 'Other', role: 'staff', status: 'active' },
    ];
    const prodDb = new FakeD1([prodPublished, prodDraft], staffList);
    const stagingDb = new FakeD1([prodPublished], staffList);

    const prodBinding = await confirmationBinding(
      prodDb,
      'content',
      prodDraft,
      'https://caregiversanctuary.org',
      prodPublished
    );

    // 1. Attempting to open a raw production ?preview_draft=cid_prod_only_draft_99 or /api/agent/preview/page?draft_id=cid_prod_only_draft_99 on staging DB fails closed with 404
    const ownerToken = await makePreviewAccessJwt({ email: 'jane@legacy.org' });
    const otherToken = await makePreviewAccessJwt({ email: 'other@legacy.org' });
    const next = async () =>
      new Response(committedHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    const stagingEnv = {
      ENVIRONMENT: 'preview',
      CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
      CF_ACCESS_AUD: PREVIEW_AUD,
      LEGACY_DB: stagingDb,
    };

    const crossDbResp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/programs.html?preview_draft=${prodDraft.id}&preview_version=${prodBinding.version}`,
        {
          method: 'GET',
          headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
        }
      ),
      next,
      env: stagingEnv,
    });
    assert.equal(crossDbResp.status, 404);
    assert.equal(crossDbResp.headers.get('cache-control'), 'no-store');
    const errBody = await crossDbResp.json();
    assert.equal(errBody.ok, false);
    assert.equal(errBody.error, 'preview_draft_not_found');

    // 2. buildContentPreviewInfo on production with verified owner + draftRow + targetRow emits an authenticated cross-environment transfer URL to staging /api/agent/preview/page
    const prodPreviewInfo = buildContentPreviewInfo({
      draftId: prodDraft.id,
      targetId: 'ps_programs.hero',
      typeId: 'page_section',
      itemData: JSON.parse(prodDraft.data),
      previewVersion: prodBinding.version,
      requestUrl: 'https://caregiversanctuary.org/api/agent/draft',
      env: { LEGACY_DB: prodDb },
      authorized: true,
      owner: prodDraft.updated_by,
      draftRow: prodDraft,
      targetRow: prodPublished,
    });
    assert.equal(prodPreviewInfo.staging_preview_supported, true);
    assert.equal(prodPreviewInfo.preview_path, null);
    assert.equal(prodPreviewInfo.preview_unavailable_reason, null);
    assert.ok(prodPreviewInfo.staging_preview_url.startsWith('https://staging.caregiversanctuary.org/api/agent/preview/page?transfer='));
    assert.ok(prodPreviewInfo.staging_preview_url.endsWith(`&source_version=${prodBinding.version}`));

    // 3. Foreign staff member (other@legacy.org) cannot materialize or view the transferred production draft (403)
    const foreignTransferResp = await onRequest({
      request: new Request(prodPreviewInfo.staging_preview_url, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': otherToken },
      }),
      next,
      env: stagingEnv,
    });
    assert.equal(foreignTransferResp.status, 403);
    assert.equal((await foreignTransferResp.json()).error, 'preview_forbidden_owner');
    assert.equal(stagingDb.rows.filter((r) => r.status === 'draft').length, 0);

    // 4. Tampered source_version or tampered transfer payload fails closed (409) without writing to staging DB
    const tamperedVerUrl = prodPreviewInfo.staging_preview_url.replace(
      `source_version=${prodBinding.version}`,
      `source_version=${'f'.repeat(64)}`
    );
    const tamperedVerResp = await onRequest({
      request: new Request(tamperedVerUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
      }),
      next,
      env: stagingEnv,
    });
    assert.equal(tamperedVerResp.status, 409);
    assert.equal((await tamperedVerResp.json()).error, 'preview_version_mismatch');
    assert.equal(stagingDb.rows.filter((r) => r.status === 'draft').length, 0);

    // 5. Authenticated initiating staff owner opening staging_preview_url materializes a real staging draft row in stagingDb and renders the preview
    const validTransferResp = await onRequest({
      request: new Request(prodPreviewInfo.staging_preview_url, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
      }),
      next,
      env: stagingEnv,
    });
    assert.equal(validTransferResp.status, 200);
    assert.equal(validTransferResp.headers.get('cache-control'), 'no-store');
    const html = await validTransferResp.text();
    assert.ok(html.includes('Production-Only Draft Title'));
    assert.ok(html.includes('Production-Only Draft Lede'));
    assert.ok(html.includes(`data-source-draft-id="${prodDraft.id}"`));
    assert.ok(html.includes(`data-source-preview-version="${prodBinding.version}"`));
    const materializedStagingDrafts = stagingDb.rows.filter((r) => r.status === 'draft');
    assert.equal(materializedStagingDrafts.length, 1);
    assert.ok(materializedStagingDrafts[0].id.startsWith('cid_stg_'));
    assert.equal(materializedStagingDrafts[0].updated_by, draftOwner('jane@legacy.org'));
    assert.equal(stagingDb.auditRows.length, 1);
    assert.equal(stagingDb.auditRows[0].action, 'content_item.staging_preview_stage');
  });
});

test('preview_draft security gates: unauthenticated, foreign-owner, non-preview environment, stale version, and discarded/archived drafts all fail closed', async () => {
  await withPreviewJwks(async () => {
    const committedHtml = loadHtml('index.html');
    const publishedTarget = {
      id: 'ps_home.hero',
      type_id: 'page_section',
      status: 'published',
      draft_of: null,
      updated_by: 'seed',
      updated_at: '2026-10-01 00:00:00',
      data: JSON.stringify({
        section_key: 'home.hero',
        title: 'Live Hero Title',
        lede: 'Live Hero Lede',
      }),
    };
    const activeDraft = {
      id: 'cid_gate_draft_1',
      type_id: 'page_section',
      status: 'draft',
      draft_of: 'ps_home.hero',
      updated_by: draftOwner('jane@legacy.org'),
      updated_at: '2026-10-29 15:20:00',
      data: JSON.stringify({
        section_key: 'home.hero',
        title: 'Gated Draft Hero Title',
        lede: 'Gated Draft Hero Lede',
      }),
    };
    const discardedDraft = {
      ...activeDraft,
      id: 'cid_gate_discarded_2',
      status: 'archived',
      updated_by: 'staff_jane@legacy.org',
    };
    const db = new FakeD1(
      [publishedTarget, activeDraft, discardedDraft],
      [
        { email: 'jane@legacy.org', display_name: 'Jane', role: 'staff', status: 'active' },
        { email: 'other@legacy.org', display_name: 'Other', role: 'staff', status: 'active' },
      ]
    );
    const binding = await confirmationBinding(db, 'content', activeDraft, 'https://staging.caregiversanctuary.org', publishedTarget);
    const discardedBinding = await confirmationBinding(db, 'content', discardedDraft, 'https://staging.caregiversanctuary.org', publishedTarget);

    const next = async () =>
      new Response(committedHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    const previewEnv = {
      ENVIRONMENT: 'preview',
      CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
      CF_ACCESS_AUD: PREVIEW_AUD,
      LEGACY_DB: db,
    };
    const validPreviewUrl = `https://staging.caregiversanctuary.org/index.html?preview_draft=${activeDraft.id}&preview_version=${binding.version}`;

    // 1. Unauthenticated (no Access JWT) -> 403 fail closed (even with ALLOW_DEV_CONSOLE='1')
    const unauthResp = await onRequest({
      request: new Request(validPreviewUrl, { method: 'GET' }),
      next,
      env: { ...previewEnv, ALLOW_DEV_CONSOLE: '1' },
    });
    assert.equal(unauthResp.status, 403);
    assert.ok(!(await unauthResp.text()).includes('Live Hero Title'));

    // 2. Service token (no human staff email) -> 403 fail closed
    const serviceToken = await makePreviewAccessJwt({ email: null, common_name: 'service-bot' });
    const serviceResp = await onRequest({
      request: new Request(validPreviewUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': serviceToken },
      }),
      next,
      env: previewEnv,
    });
    assert.equal(serviceResp.status, 403);

    // 3. Non-preview environment (production) -> 403 fail closed
    const ownerToken = await makePreviewAccessJwt({ email: 'jane@legacy.org' });
    const prodEnvResp = await onRequest({
      request: new Request(validPreviewUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
      }),
      next,
      env: {
        CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
        CF_ACCESS_AUD: PREVIEW_AUD,
        LEGACY_DB: db,
      },
    });
    assert.equal(prodEnvResp.status, 403);

    // 4. Foreign owner (other@legacy.org trying to preview jane@legacy.org's draft) -> 403 fail closed
    const otherToken = await makePreviewAccessJwt({ email: 'other@legacy.org' });
    const foreignResp = await onRequest({
      request: new Request(validPreviewUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': otherToken },
      }),
      next,
      env: previewEnv,
    });
    assert.equal(foreignResp.status, 403);
    const foreignErr = await foreignResp.json();
    assert.equal(foreignErr.error, 'preview_forbidden_owner');

    // 5. Missing preview_version -> 409 fail closed
    const missingVerResp = await onRequest({
      request: new Request(`https://staging.caregiversanctuary.org/index.html?preview_draft=${activeDraft.id}`, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
      }),
      next,
      env: previewEnv,
    });
    assert.equal(missingVerResp.status, 409);
    assert.equal((await missingVerResp.json()).error, 'preview_version_required');

    // 6. Stale / tampered preview_version -> 409 fail closed (never falls back to live content)
    const staleVerUrl = validPreviewUrl.replace(binding.version, '0'.repeat(64));
    const staleResp = await onRequest({
      request: new Request(staleVerUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
      }),
      next,
      env: previewEnv,
    });
    assert.equal(staleResp.status, 409);
    const staleText = await staleResp.text();
    assert.ok(staleText.includes('preview_version_mismatch'));
    assert.ok(!staleText.includes('Live Hero Title'));

    // 7. Discarded / archived draft -> 409 fail closed
    const discardedResp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/index.html?preview_draft=${discardedDraft.id}&preview_version=${discardedBinding.version}`,
        {
          method: 'GET',
          headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
        }
      ),
      next,
      env: previewEnv,
    });
    assert.equal(discardedResp.status, 409);
    assert.equal((await discardedResp.json()).error, 'preview_draft_not_active');
  });
});

test('non-page_section drafts (resource, faq, partner) return honest unsupported handoff and fail closed (422) if ?preview_draft is requested directly', async () => {
  await withPreviewJwks(async () => {
    const committedResourcesHtml = loadHtml('resources.html');
    const publishedResource = {
      id: 'res_caregiver_guide',
      type_id: 'resource',
      status: 'published',
      draft_of: null,
      updated_by: 'seed',
      updated_at: '2026-10-01 00:00:00',
      data: JSON.stringify({
        title: 'Caregiver Guide',
        category: 'Guides',
        summary: 'Original summary.',
        url: 'https://caregiversanctuary.org/guide',
      }),
    };
    const resourceDraft = {
      id: 'cid_resource_draft_1',
      type_id: 'resource',
      status: 'draft',
      draft_of: 'res_caregiver_guide',
      updated_by: draftOwner('jane@legacy.org'),
      updated_at: '2026-10-29 15:25:00',
      data: JSON.stringify({
        title: 'Updated Caregiver Guide',
        category: 'Guides',
        summary: 'Updated summary.',
        url: 'https://caregiversanctuary.org/guide',
      }),
    };
    const db = new FakeD1(
      [publishedResource, resourceDraft],
      [{ email: 'jane@legacy.org', display_name: 'Jane', role: 'staff', status: 'active' }]
    );
    const binding = await confirmationBinding(db, 'content', resourceDraft, 'https://staging.caregiversanctuary.org', publishedResource);

    for (const [typeId, targetId] of [['resource', 'res_caregiver_guide'], ['faq', 'faq_what_is_sanctuary'], ['partner', 'partner_milwaukee_aging']]) {
      const info = buildContentPreviewInfo({
        draftId: 'cid_non_ps_1',
        targetId,
        typeId,
        itemData: { title: 'Test' },
        previewVersion: binding.version,
        requestUrl: 'https://staging.caregiversanctuary.org/api/agent/draft',
        env: { ENVIRONMENT: 'preview', LEGACY_DB: db },
        authorized: true,
      });
      assert.equal(info.staging_preview_supported, false);
      assert.equal(info.staging_preview_url, null);
      assert.equal(info.preview_url, null);
      assert.equal(info.preview_path, null);
      assert.ok(info.preview_unavailable_reason.includes('not supported'));
    }

    // Direct request to /resources.html?preview_draft=cid_resource_draft_1 fails closed with 422 instead of showing a false banner
    const ownerToken = await makePreviewAccessJwt({ email: 'jane@legacy.org' });
    const next = async () =>
      new Response(committedResourcesHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    const resp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/resources.html?preview_draft=${resourceDraft.id}&preview_version=${binding.version}`,
        {
          method: 'GET',
          headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
        }
      ),
      next,
      env: {
        ENVIRONMENT: 'preview',
        CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
        CF_ACCESS_AUD: PREVIEW_AUD,
        LEGACY_DB: db,
      },
    });
    assert.equal(resp.status, 422);
    assert.equal((await resp.json()).error, 'preview_unsupported_type');
  });
});

test('authorized modal form previews (ps_form.membership, ps_form.grant_apply, ps_form.coaching_interest) open the exact target modal (.open) while ordinary public renders keep modals closed', async () => {
  await withPreviewJwks(async () => {
    const committedIndexHtml = loadHtml('index.html');
    const committedProgramsHtml = loadHtml('programs.html');
    const committedCss = loadHtml('styles.css');
    assert.match(committedCss, /\.modal-overlay\s*\{[^}]*display:\s*none/s);
    assert.match(committedCss, /\.modal-overlay\.open\s*\{\s*display:\s*flex;\s*\}/);

    const publishedItems = [
      {
        id: 'ps_form.membership',
        type_id: 'page_section',
        status: 'published',
        draft_of: null,
        updated_by: 'seed',
        updated_at: '2026-10-01 00:00:00',
        data: JSON.stringify({ section_key: 'form.membership', heading: 'LIVE form' }),
      },
      {
        id: 'ps_form.grant_apply',
        type_id: 'page_section',
        status: 'published',
        draft_of: null,
        updated_by: 'seed',
        updated_at: '2026-10-01 00:00:00',
        data: JSON.stringify({ section_key: 'form.grant_apply', heading: 'LIVE grant form' }),
      },
      {
        id: 'ps_form.coaching_interest',
        type_id: 'page_section',
        status: 'published',
        draft_of: null,
        updated_by: 'seed',
        updated_at: '2026-10-01 00:00:00',
        data: JSON.stringify({ section_key: 'form.coaching_interest', heading: 'LIVE coaching form' }),
      },
    ];
    const drafts = [
      {
        id: 'cid_review_one',
        type_id: 'page_section',
        status: 'draft',
        draft_of: 'ps_form.membership',
        updated_by: draftOwner('jane@legacy.org'),
        updated_at: '2026-10-29 16:00:00',
        data: JSON.stringify({ section_key: 'form.membership', heading: 'PROPOSED form' }),
      },
      {
        id: 'cid_review_grant',
        type_id: 'page_section',
        status: 'draft',
        draft_of: 'ps_form.grant_apply',
        updated_by: draftOwner('jane@legacy.org'),
        updated_at: '2026-10-29 16:01:00',
        data: JSON.stringify({ section_key: 'form.grant_apply', heading: 'PROPOSED grant form' }),
      },
      {
        id: 'cid_review_coaching',
        type_id: 'page_section',
        status: 'draft',
        draft_of: 'ps_form.coaching_interest',
        updated_by: draftOwner('jane@legacy.org'),
        updated_at: '2026-10-29 16:02:00',
        data: JSON.stringify({ section_key: 'form.coaching_interest', heading: 'PROPOSED coaching form' }),
      },
    ];
    const db = new FakeD1(
      [...publishedItems, ...drafts],
      [{ email: 'jane@legacy.org', display_name: 'Jane', role: 'staff', status: 'active' }]
    );
    const ownerToken = await makePreviewAccessJwt({ email: 'jane@legacy.org' });
    const previewEnv = {
      ENVIRONMENT: 'preview',
      CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
      CF_ACCESS_AUD: PREVIEW_AUD,
      LEGACY_DB: db,
    };

    // 1. Membership modal preview on index.html opens #membershipModal (.open)
    const memBinding = await confirmationBinding(db, 'content', drafts[0], 'https://staging.caregiversanctuary.org', publishedItems[0]);
    const memResp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/index.html?preview_draft=cid_review_one&preview_version=${memBinding.version}`,
        { method: 'GET', headers: { 'Cf-Access-Jwt-Assertion': ownerToken } }
      ),
      next: async () => new Response(committedIndexHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      env: previewEnv,
    });
    assert.equal(memResp.status, 200);
    const memHtml = await memResp.text();
    assert.ok(memHtml.includes('PROPOSED form'));
    assert.ok(memHtml.includes('staging-draft-preview-banner'));
    assert.match(memHtml, /<div class="modal-overlay open" id="membershipModal">/);

    // 2. Grant application modal preview on programs.html opens ONLY #grantApplyModal (.open)
    const grantBinding = await confirmationBinding(db, 'content', drafts[1], 'https://staging.caregiversanctuary.org', publishedItems[1]);
    const grantResp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/programs.html?preview_draft=cid_review_grant&preview_version=${grantBinding.version}`,
        { method: 'GET', headers: { 'Cf-Access-Jwt-Assertion': ownerToken } }
      ),
      next: async () => new Response(committedProgramsHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      env: previewEnv,
    });
    assert.equal(grantResp.status, 200);
    const grantHtml = await grantResp.text();
    assert.ok(grantHtml.includes('PROPOSED grant form'));
    assert.match(grantHtml, /<div class="modal-overlay open" id="grantApplyModal">/);
    assert.match(grantHtml, /<div class="modal-overlay" id="membershipModal">/);
    assert.match(grantHtml, /<div class="modal-overlay" id="coachingInterestModal">/);

    // 3. Coaching interest modal preview on programs.html opens ONLY #coachingInterestModal (.open)
    const coachBinding = await confirmationBinding(db, 'content', drafts[2], 'https://staging.caregiversanctuary.org', publishedItems[2]);
    const coachResp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/programs.html?preview_draft=cid_review_coaching&preview_version=${coachBinding.version}`,
        { method: 'GET', headers: { 'Cf-Access-Jwt-Assertion': ownerToken } }
      ),
      next: async () => new Response(committedProgramsHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      env: previewEnv,
    });
    assert.equal(coachResp.status, 200);
    const coachHtml = await coachResp.text();
    assert.ok(coachHtml.includes('PROPOSED coaching form'));
    assert.match(coachHtml, /<div class="modal-overlay open" id="coachingInterestModal">/);
    assert.match(coachHtml, /<div class="modal-overlay" id="membershipModal">/);
    assert.match(coachHtml, /<div class="modal-overlay" id="grantApplyModal">/);

    // 4. Ordinary public render of index.html keeps #membershipModal closed (no .open)
    const publicResp = await onRequest({
      request: new Request('https://staging.caregiversanctuary.org/index.html', { method: 'GET' }),
      next: async () => new Response(committedIndexHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      env: previewEnv,
    });
    assert.equal(publicResp.status, 200);
    const publicHtml = await publicResp.text();
    assert.ok(publicHtml.includes('LIVE form'));
    assert.ok(!publicHtml.includes('PROPOSED form'));
    assert.match(publicHtml, /<div class="modal-overlay" id="membershipModal">/);
    assert.doesNotMatch(publicHtml, /<div class="modal-overlay open" id="membershipModal">/);

    // 5. Protected /api/agent/preview/page entrypoint (covered by Access 3757b2d6 api/agent path) renders the target page with <base href="/">, .open modal, and preview banner, while refusing ALLOW_DEV_CONSOLE bypass without verified JWT
    const info = buildContentPreviewInfo({
      draftId: 'cid_review_one',
      targetId: 'ps_form.membership',
      typeId: 'page_section',
      itemData: { section_key: 'form.membership', heading: 'PROPOSED form' },
      previewVersion: memBinding.version,
      requestUrl: 'https://staging.caregiversanctuary.org/api/agent/draft',
      env: previewEnv,
      authorized: true,
    });
    assert.equal(info.preview_path, `/api/agent/preview/page?draft_id=cid_review_one&preview_version=${memBinding.version}#membershipModal`);
    assert.equal(info.staging_preview_url, `https://staging.caregiversanctuary.org/api/agent/preview/page?draft_id=cid_review_one&preview_version=${memBinding.version}#membershipModal`);

    const protectedPageResp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/api/agent/preview/page?draft_id=cid_review_one&preview_version=${memBinding.version}`,
        { method: 'GET', headers: { 'Cf-Access-Jwt-Assertion': ownerToken } }
      ),
      next: async (req) => {
        const p = new URL(req.url).pathname;
        assert.equal(p, '/index.html');
        return new Response(committedIndexHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      },
      env: previewEnv,
    });
    assert.equal(protectedPageResp.status, 200);
    assert.equal(protectedPageResp.headers.get('cache-control'), 'no-store');
    const protectedPageHtml = await protectedPageResp.text();
    assert.ok(protectedPageHtml.includes('<base href="/">'));
    assert.ok(protectedPageHtml.includes('PROPOSED form'));
    assert.ok(protectedPageHtml.includes('staging-draft-preview-banner'));
    assert.match(protectedPageHtml, /<div class="modal-overlay open" id="membershipModal">/);

    // ALLOW_DEV_CONSOLE=1 without verified JWT on /api/agent/preview/page still fails closed (403)
    const devBypassResp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/api/agent/preview/page?draft_id=cid_review_one&preview_version=${memBinding.version}`,
        { method: 'GET' }
      ),
      next: async () => new Response(committedIndexHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
      env: { ...previewEnv, ALLOW_DEV_CONSOLE: '1' },
    });
    assert.equal(devBypassResp.status, 403);
  });
});

test('ordinary browser session (staff.js + real onRequest middleware + real RS256 Access JWTs across two isolated SQLite D1 databases): production Assistant conversation -> authenticated staging draft materialization & preview -> production confirmation without DB cross-contamination or provider/job replay', async () => {
  await withPreviewJwks(async () => {
    const schemaFiles = [
      'schema/0001_init.sql',
      'schema/0003_grant_award.sql',
      'schema/0004_content_types.sql',
      'schema/0009_content_live.sql',
      'schema/0010_page_section_forms.sql',
      'schema/0011_staff_member.sql',
    ];
    const makeSqliteD1 = async () => {
      const raw = new DatabaseSync(':memory:');
      for (const f of schemaFiles) {
        raw.exec(readFileSync(resolve(rootDir, f), 'utf8'));
      }
      await seedPageSections({ db: raw });
      raw.prepare(
        "INSERT INTO staff_member (email, display_name, role, status, first_seen_at, last_seen_at) VALUES ('jane@legacy.org', 'Jane', 'staff', 'active', '2026-10-01 00:00:00', '2026-10-29 19:00:00')"
      ).run();
      raw.prepare(
        "INSERT INTO staff_member (email, display_name, role, status, first_seen_at, last_seen_at) VALUES ('other@legacy.org', 'Other', 'staff', 'active', '2026-10-01 00:00:00', '2026-10-29 19:00:00')"
      ).run();
      const d1 = {
        raw,
        async batch(statements) {
          raw.exec('BEGIN');
          try {
            const results = statements.map(({ sql, params }) => {
              const statement = raw.prepare(sql);
              if (statement.columns().length) {
                return { success: true, results: statement.all(...params), meta: {} };
              }
              const result = statement.run(...params);
              return { success: true, results: [], meta: { changes: Number(result.changes) } };
            });
            raw.exec('COMMIT');
            return results;
          } catch (error) {
            raw.exec('ROLLBACK');
            throw error;
          }
        },
        prepare(sql) {
          return {
            sql,
            params: [],
            bind(...params) {
              return {
                sql,
                params,
                async first() {
                  return raw.prepare(sql).get(...params) ?? null;
                },
                async run() {
                  return raw.prepare(sql).run(...params);
                },
                async all() {
                  return { results: raw.prepare(sql).all(...params) };
                },
              };
            },
            async first() {
              return raw.prepare(sql).get() ?? null;
            },
            async run() {
              return raw.prepare(sql).run();
            },
            async all() {
              return { results: raw.prepare(sql).all() };
            },
          };
        },
      };
      return d1;
    };

    // Two strictly isolated SQLite D1 instances: production (prodDb) and staging (stagingDb)
    const prodDb = await makeSqliteD1();
    const stagingDb = await makeSqliteD1();

    let mapperCalls = 0;
    const prodMapper = async ({ request, current }) => {
      mapperCalls++;
      return {
        ok: true,
        change: {
          ...current,
          section_key: 'home.hero',
          lede: 'Supporting every family caregiver across Greater Milwaukee.',
        },
      };
    };

    const prodEnv = {
      CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
      CF_ACCESS_AUD: PREVIEW_AUD,
      LEGACY_DB: prodDb,
      AGENT_MAPPER_BACKEND: prodMapper,
    };
    const stagingEnv = {
      ENVIRONMENT: 'preview',
      CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
      CF_ACCESS_AUD: PREVIEW_AUD,
      LEGACY_DB: stagingDb,
    };

    const committedIndexHtml = loadHtml('index.html');
    const dispatchEdge = async (req, env) => {
      const data = {};
      const next = async (forwardedReq = req) => {
        const u = new URL(forwardedReq.url);
        if (u.pathname === '/api/agent/web-jobs') {
          return handleWebJobs({ request: forwardedReq, env, data });
        }
        if (u.pathname.startsWith('/api/agent/')) {
          return forwardedReq.method === 'GET'
            ? getAgent({ request: forwardedReq, env, data })
            : postAgent({ request: forwardedReq, env, data });
        }
        if (u.pathname === '/index.html' || u.pathname === '/') {
          return new Response(committedIndexHtml, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        return new Response('not found', { status: 404 });
      };
      return onRequest({ request: req, next, env, data });
    };

    const ownerToken = await makePreviewAccessJwt({ email: 'jane@legacy.org' });
    const otherToken = await makePreviewAccessJwt({ email: 'other@legacy.org' });

    // Mount real staff.js in an ordinary browser session on https://caregiversanctuary.org
    const staffSource = readFileSync(resolve(rootDir, 'staff.js'), 'utf8');
    const chatSection = staffSource.slice(
      staffSource.indexOf('function initStaffChatTargets()'),
      staffSource.indexOf('let siteContentItems =')
    );
    const messages = [];
    const storage = new Map();
    const nodes = {
      chatInput: { value: 'Change the homepage hero subtitle to Supporting every family caregiver across Greater Milwaukee.' },
      chatBody: {
        scrollHeight: 0,
        scrollTop: 0,
        appendChild(n) {
          if (!messages.includes(n)) messages.push(n);
        },
      },
      chatAreaSelect: { value: 'content' },
      chatContentTarget: { value: 'ps_home.hero' },
    };
    const document = {
      hidden: false,
      getElementById: (id) => nodes[id] || null,
      querySelector: () => null,
      createElement: () => ({
        dataset: {},
        innerHTML: '',
        textContent: '',
        attributes: {},
        className: '',
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      }),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const browserCtx = vm.createContext({
      document,
      AbortController,
      Date,
      setTimeout,
      clearTimeout,
      window: {
        location: { origin: 'https://caregiversanctuary.org' },
        sessionStorage: {
          getItem: (k) => storage.get(k) || null,
          setItem: (k, v) => storage.set(k, String(v)),
          removeItem: (k) => storage.delete(k),
        },
      },
      crypto,
      escapeHtml,
      currentEventId: null,
      currentCaregiverId: null,
      currentGrantId: null,
      loadStaffConsole: async () => {},
      viewCaregiver: async () => {},
      fetch: async (path, options = {}) => {
        const url = new URL(path, 'https://caregiversanctuary.org').toString();
        const headers = new Headers(options.headers || {});
        // Browser session sends its Cloudflare Access session token, never x-dev-actor or synthetic fixtures
        headers.set('Cf-Access-Jwt-Assertion', ownerToken);
        if ((options.method || 'GET').toUpperCase() === 'POST') {
          headers.set('Origin', 'https://caregiversanctuary.org');
        }
        const req = new Request(url, {
          method: options.method || 'GET',
          headers,
          body: options.body,
          signal: options.signal,
        });
        return dispatchEdge(req, prodEnv);
      },
    });
    vm.runInContext(
      'let siteContentItems = [{ id: "ps_home.hero", type_id: "page_section", status: "published", data: "{}" }];\n' +
        chatSection,
      browserCtx
    );

    // 1. Initialize web-job feature in production browser session and send the conversation request
    await browserCtx.initWebJobFeature();
    await browserCtx.window.agentSend();

    assert.equal(mapperCalls, 1, 'production draft creation invokes the mapper exactly once');
    const prodDrafts = prodDb.raw.prepare("SELECT * FROM content_item WHERE status = 'draft'").all();
    assert.equal(prodDrafts.length, 1);
    const prodDraft = prodDrafts[0];
    assert.ok(prodDraft.id.startsWith('cid_'));
    assert.equal(prodDraft.updated_by, draftOwner('jane@legacy.org'));
    assert.equal(
      stagingDb.raw.prepare("SELECT count(*) AS n FROM content_item WHERE status = 'draft'").get().n,
      0,
      'staging DB remains completely isolated before the preview link is opened'
    );
    const prodLiveBefore = JSON.parse(
      prodDb.raw.prepare("SELECT data FROM content_item WHERE id = 'ps_home.hero'").get().data
    );
    assert.notEqual(
      prodLiveBefore.lede,
      'Supporting every family caregiver across Greater Milwaukee.',
      'production published content is untouched while draft is unconfirmed'
    );

    // 2. Inspect the Assistant card rendered in the production browser DOM and extract the staging preview href
    const cardMsg = messages.find((m) => m.innerHTML && m.innerHTML.includes('preview-staging-link'));
    assert.ok(cardMsg, 'production Assistant card renders the Open staging preview link');
    assert.ok(!cardMsg.innerHTML.includes('preview-unavailable-note'));
    const hrefMatch = cardMsg.innerHTML.match(/href="([^"]+)"[^>]*class="preview-staging-link"/);
    assert.ok(hrefMatch, 'staging preview link has an href attribute');
    const stagingPreviewUrl = hrefMatch[1].replace(/&amp;/g, '&');
    assert.ok(
      stagingPreviewUrl.startsWith('https://staging.caregiversanctuary.org/api/agent/preview/page?transfer='),
      'staging preview link points to the Access-protected staging preview endpoint with transfer envelope'
    );

    // 3. Follow the exact staging preview link in the authenticated browser session against stagingEnv (stagingDb)
    const stagingPreviewResp = await dispatchEdge(
      new Request(stagingPreviewUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': ownerToken },
      }),
      stagingEnv
    );
    assert.equal(stagingPreviewResp.status, 200);
    assert.equal(stagingPreviewResp.headers.get('cache-control'), 'no-store');
    assert.equal(mapperCalls, 1, 'opening staging preview performs zero AI/mapper or job replay');

    const stagingPreviewHtml = await stagingPreviewResp.text();
    assert.ok(stagingPreviewHtml.includes('<base href="/">'));
    assert.ok(stagingPreviewHtml.includes('Supporting every family caregiver across Greater Milwaukee.'));
    assert.ok(stagingPreviewHtml.includes(`data-source-draft-id="${prodDraft.id}"`));

    // Verify a real authenticated staging draft row was materialized in stagingDb while staging published content stays untouched
    const stagingDrafts = stagingDb.raw.prepare("SELECT * FROM content_item WHERE status = 'draft'").all();
    assert.equal(stagingDrafts.length, 1);
    const stagingDraft = stagingDrafts[0];
    assert.ok(stagingDraft.id.startsWith('cid_stg_'));
    assert.equal(stagingDraft.updated_by, draftOwner('jane@legacy.org'));
    assert.ok(stagingPreviewHtml.includes(`data-preview-draft-id="${stagingDraft.id}"`));

    const stagingAuditRows = stagingDb.raw
      .prepare("SELECT * FROM audit_log WHERE action = 'content_item.staging_preview_stage'")
      .all();
    assert.equal(stagingAuditRows.length, 1);
    assert.equal(stagingAuditRows[0].actor, 'jane@legacy.org');
    assert.equal(stagingAuditRows[0].entity_id, stagingDraft.id);

    const stagingLive = JSON.parse(
      stagingDb.raw.prepare("SELECT data FROM content_item WHERE id = 'ps_home.hero'").get().data
    );
    assert.notEqual(
      stagingLive.lede,
      'Supporting every family caregiver across Greater Milwaukee.',
      'staging published content remains untouched by draft preview'
    );

    // 4. Attempting to confirm the staging preview draft directly on staging is refused (409); production writes stay behind approval of the originating production draft
    const stagingConfirmAttempt = await dispatchEdge(
      new Request('https://staging.caregiversanctuary.org/api/agent/confirm', {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': ownerToken,
          Origin: 'https://staging.caregiversanctuary.org',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          draft_id: stagingDraft.id,
          preview_version: 'a'.repeat(64),
        }),
      }),
      stagingEnv
    );
    assert.equal(stagingConfirmAttempt.status, 409);
    const stagingConfirmErr = await stagingConfirmAttempt.json();
    assert.match(stagingConfirmErr.error, /staging transfer preview drafts are preview-only/);

    // 5. Foreign staff member cannot view the staging preview link (403)
    const foreignStagingResp = await dispatchEdge(
      new Request(stagingPreviewUrl, {
        method: 'GET',
        headers: { 'Cf-Access-Jwt-Assertion': otherToken },
      }),
      stagingEnv
    );
    assert.equal(foreignStagingResp.status, 403);

    // 6. Click Confirm & publish in the production Staff Assistant DOM to approve that exact preview
    const draftIdMatch = cardMsg.innerHTML.match(/data-draft-id="([^"]+)"/);
    const previewVerMatch = cardMsg.innerHTML.match(/data-preview-version="([^"]+)"/);
    assert.equal(draftIdMatch?.[1], prodDraft.id);
    assert.ok(previewVerMatch?.[1]);

    const cardState = { innerHTML: cardMsg.innerHTML };
    const confirmBtn = {
      disabled: false,
      getAttribute(name) {
        if (name === 'data-draft-id') return draftIdMatch[1];
        if (name === 'data-preview-version') return previewVerMatch[1];
        return null;
      },
      closest() {
        return cardState;
      },
    };
    await browserCtx.confirmAgentChange(confirmBtn);
    assert.ok(cardState.innerHTML.includes('Published — logged to the audit trail.'));
    assert.equal(mapperCalls, 1, 'confirmation does not replay provider or job');

    // Verify production DB published ps_home.hero is now updated and the production draft is archived, while staging published content remains isolated
    const prodLiveAfter = JSON.parse(
      prodDb.raw.prepare("SELECT data FROM content_item WHERE id = 'ps_home.hero'").get().data
    );
    assert.equal(
      prodLiveAfter.lede,
      'Supporting every family caregiver across Greater Milwaukee.'
    );
    const prodDraftAfter = prodDb.raw
      .prepare('SELECT status FROM content_item WHERE id = ?')
      .get(prodDraft.id);
    assert.equal(prodDraftAfter.status, 'archived');
    const stagingLiveAfter = JSON.parse(
      stagingDb.raw.prepare("SELECT data FROM content_item WHERE id = 'ps_home.hero'").get().data
    );
    assert.notEqual(
      stagingLiveAfter.lede,
      'Supporting every family caregiver across Greater Milwaukee.'
    );
  });
});
