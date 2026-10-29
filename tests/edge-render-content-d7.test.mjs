// Tests for published content edge rewrites per D-011 (LEGACY-D7-S0B-EDGE-RENDER-CONTENT-R1)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequest } from '../functions/_middleware.js';
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
    this.queryCount = 0;
    this.shouldThrow = false;
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
    return {
      bind(...params) {
        return {
          first: async () => matchRow(params),
          run: async () => ({ success: true }),
          all: async () => {
            self.queryCount++;
            if (self.shouldThrow) throw new Error('D1 query error');
            const single = matchRow(params);
            return { results: single ? [single] : [] };
          },
        };
      },
      first: async () => matchRow([]),
      run: async () => ({ success: true }),
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

test('two-isolated-DB boundary: production-created draft reports staging preview unavailable and missing draft on staging DB fails closed (404) without falling back to live content', async () => {
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
    const prodDb = new FakeD1(
      [prodPublished, prodDraft],
      [{ email: 'jane@legacy.org', display_name: 'Jane', role: 'staff', status: 'active' }]
    );
    const stagingDb = new FakeD1(
      [prodPublished],
      [{ email: 'jane@legacy.org', display_name: 'Jane', role: 'staff', status: 'active' }]
    );

    const prodBinding = await confirmationBinding(
      prodDb,
      'content',
      prodDraft,
      'https://legacy-hub-5qo.pages.dev',
      prodPublished
    );

    // 1. buildContentPreviewInfo on production (ENVIRONMENT !== 'preview') reports unavailable and never emits a fake staging link
    const prodPreviewInfo = buildContentPreviewInfo({
      draftId: prodDraft.id,
      targetId: 'ps_programs.hero',
      typeId: 'page_section',
      itemData: JSON.parse(prodDraft.data),
      previewVersion: prodBinding.version,
      requestUrl: 'https://legacy-hub-5qo.pages.dev/api/agent/draft',
      env: { LEGACY_DB: prodDb },
      authorized: true,
    });
    assert.equal(prodPreviewInfo.staging_preview_supported, false);
    assert.equal(prodPreviewInfo.staging_preview_url, null);
    assert.equal(prodPreviewInfo.preview_url, null);
    assert.equal(prodPreviewInfo.preview_path, null);
    assert.ok(prodPreviewInfo.preview_unavailable_reason.includes('separate isolated databases'));

    // 2. Attempting to open ?preview_draft=cid_prod_only_draft_99 on staging DB (where the draft does not exist) fails closed with 404 and NEVER renders unchanged live content
    const token = await makePreviewAccessJwt({ email: 'jane@legacy.org' });
    const next = async () =>
      new Response(committedHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    const crossDbResp = await onRequest({
      request: new Request(
        `https://staging.caregiversanctuary.org/programs.html?preview_draft=${prodDraft.id}&preview_version=${prodBinding.version}`,
        {
          method: 'GET',
          headers: { 'Cf-Access-Jwt-Assertion': token },
        }
      ),
      next,
      env: {
        ENVIRONMENT: 'preview',
        CF_ACCESS_TEAM_DOMAIN: PREVIEW_TEAM,
        CF_ACCESS_AUD: PREVIEW_AUD,
        LEGACY_DB: stagingDb,
      },
    });
    assert.equal(crossDbResp.status, 404);
    assert.equal(crossDbResp.headers.get('cache-control'), 'no-store');
    const errBody = await crossDbResp.json();
    assert.equal(errBody.ok, false);
    assert.equal(errBody.error, 'preview_draft_not_found');
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
  });
});
