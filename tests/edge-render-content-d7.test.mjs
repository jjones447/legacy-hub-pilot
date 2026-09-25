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
} from '../functions/_content.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

function loadHtml(relPath) {
  return readFileSync(resolve(rootDir, relPath), 'utf-8');
}

class FakeD1 {
  constructor(rows = []) {
    this.rows = rows;
    this.queryCount = 0;
    this.shouldThrow = false;
  }
  prepare(sql) {
    return {
      all: async () => {
        this.queryCount++;
        if (this.shouldThrow) {
          throw new Error('D1 query error');
        }
        return { results: this.rows };
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
      id: 'ps_request_support.form',
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
