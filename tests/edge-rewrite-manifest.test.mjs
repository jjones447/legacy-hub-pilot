// Tests for manifest-driven edge rewrite per ADR 0007 (LEGACY-DS2-EDGE-REWRITE-R1)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequest } from '../functions/_middleware.js';
import { onRequestGet as mediaR2Get } from '../functions/media/r2/[[key]].js';
import { _resetManifestCache } from '../functions/_media.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

function loadHtml(relPath) {
  return readFileSync(resolve(rootDir, relPath), 'utf-8');
}

class FakeMediaBucket {
  constructor(objects = {}) {
    this.objects = new Map(Object.entries(objects));
    this.fetchCount = 0;
  }
  async get(key) {
    this.fetchCount++;
    if (!this.objects.has(key)) return null;
    const item = this.objects.get(key);
    const bodyText = typeof item === 'string' ? item : (item.body || JSON.stringify(item));
    const bytes = new TextEncoder().encode(bodyText);
    return {
      body: bytes,
      httpEtag: (typeof item === 'object' && item.httpEtag) ? item.httpEtag : '"fake-etag-sha256"',
      httpMetadata: (typeof item === 'object' && item.httpMetadata) ? item.httpMetadata : { contentType: 'application/json' },
      writeHttpMetadata(headers) {
        if (this.httpMetadata?.contentType) {
          headers.set('content-type', this.httpMetadata.contentType);
        }
      },
      async text() {
        return bodyText;
      },
      async json() {
        return JSON.parse(bodyText);
      },
      async arrayBuffer() {
        return bytes.buffer;
      }
    };
  }
}

const FIXTURE_MANIFEST = {
  version: 1,
  generated_at: '2026-09-16T12:00:00Z',
  source: {
    root_folder_id: 'root-123',
    identity: 'oauth:jacob.jones447@gmail.com'
  },
  areas: {
    home: {
      folder: 'Home',
      folder_id: 'home-folder-id',
      banner: null,
      groups: {
        'Main Page Gallery Preview Photos': {
          folder_id: 'main-preview-id',
          caption: 'Main Page Preview',
          items: [
            {
              key: 'gallery/home-main-preview/img_1.jpg',
              thumb: 'thumbs/home-main-preview/img_1.jpg',
              source_id: 'src-1',
              checksum: 'chk-1',
              caption: 'Founder with caregiver family',
              alt: 'Founder speaking with caregiver family at sanctuary',
              width: 1600,
              height: 1200
            },
            {
              key: 'gallery/home-main-preview/img_2.jpg',
              thumb: 'thumbs/home-main-preview/img_2.jpg',
              source_id: 'src-2',
              checksum: 'chk-2',
              caption: null,
              alt: 'Community circle in gardens',
              width: 1600,
              height: 1200
            }
          ]
        }
      }
    },
    about: {
      folder: 'About Us',
      folder_id: 'about-folder-id',
      banner: {
        kind: 'photo',
        key: 'banners/about.jpg',
        source_id: 'src-about-banner',
        caption: null
      },
      groups: {
        'About Us Story Photos': {
          folder_id: 'about-story-id',
          caption: 'About Us Story',
          items: [
            {
              key: 'gallery/about-story/history_1.jpg',
              thumb: 'thumbs/about-story/history_1.jpg',
              source_id: 'src-h1',
              checksum: 'chk-h1',
              caption: 'Early foundation gathering',
              alt: 'Early foundation gathering in 2024',
              width: 1600,
              height: 1200
            }
          ]
        }
      }
    },
    'programs-events': {
      folder: 'Programs and Events',
      folder_id: 'programs-folder-id',
      banner: {
        kind: 'video',
        key: 'banners/programs-events.mp4',
        source_id: 'src-video-banner',
        caption: 'Respite Day in Action'
      },
      groups: {
        'Caregiver CPR Event': {
          folder_id: 'cpr-folder-id',
          caption: 'Caregiver CPR Event',
          items: [
            {
              key: 'gallery/programs-cpr/cpr_1.jpg',
              thumb: 'thumbs/programs-cpr/cpr_1.jpg',
              source_id: 'src-cpr1',
              checksum: 'chk-cpr1',
              caption: null,
              alt: 'CPR training session at the hub',
              width: 1600,
              height: 1200
            }
          ]
        }
      }
    }
  },
  gallery_order: [
    'Main Page Gallery Preview Photos',
    'Caregiver CPR Event',
    'About Us Story Photos'
  ]
};

beforeEach(() => {
  _resetManifestCache();
});

test('(a) gallery grid and selector rendered from the manifest', async () => {
  const media = new FakeMediaBucket({
    'manifest.json': JSON.stringify(FIXTURE_MANIFEST),
  });

  const committedHtml = loadHtml('gallery.html');
  const request = new Request('https://legacy-hub.pages.dev/gallery.html', { method: 'GET' });
  const next = async () => new Response(committedHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const resp = await onRequest({ request, next, env: { MEDIA: media } });
  assert.equal(resp.status, 200);

  const html = await resp.text();

  // Selector options replaced with manifest's gallery_order
  assert.ok(html.includes('<option value="">All photos</option>'));
  assert.ok(html.includes('<option value="Main Page Gallery Preview Photos">Main Page Gallery Preview Photos</option>'));
  assert.ok(html.includes('<option value="Caregiver CPR Event">Caregiver CPR Event</option>'));
  assert.ok(html.includes('<option value="About Us Story Photos">About Us Story Photos</option>'));
  // Old options not in fixture should be gone
  assert.ok(!html.includes('<option value="The Sanctuary">The Sanctuary</option>'));

  // Gallery grid replaced
  assert.ok(html.includes('data-folder="Main Page Gallery Preview Photos"'));
  assert.ok(html.includes('data-src="/media/r2/gallery/home-main-preview/img_1.jpg"'));
  assert.ok(html.includes('src="/media/r2/thumbs/home-main-preview/img_1.jpg"'));
  assert.ok(html.includes('data-caption="Founder with caregiver family"'));
  assert.ok(html.includes('data-alt="Founder speaking with caregiver family at sanctuary"'));
  assert.ok(html.includes('width="1600" height="1200"'));
  assert.ok(html.includes('aria-label="View photograph 1 of 4 larger"'));

  // Caption null renders data-caption=""
  assert.ok(html.includes('data-src="/media/r2/gallery/home-main-preview/img_2.jpg"'));
  assert.ok(html.includes('data-caption=""'));
  assert.ok(html.includes('aria-label="View photograph 2 of 4 larger"'));

  // Third and fourth items
  assert.ok(html.includes('data-folder="Caregiver CPR Event"'));
  assert.ok(html.includes('data-src="/media/r2/gallery/programs-cpr/cpr_1.jpg"'));
  assert.ok(html.includes('data-folder="About Us Story Photos"'));
  assert.ok(html.includes('data-src="/media/r2/gallery/about-story/history_1.jpg"'));

  // Old hardcoded items should not exist in rewritten output
  assert.ok(!html.includes('media/gallery/shoot-238.jpg'));
});

test('(b) fallback pass-through when the MEDIA binding is absent', async () => {
  const committedHtml = loadHtml('gallery.html');
  const request = new Request('https://legacy-hub.pages.dev/gallery.html', { method: 'GET' });
  const next = async () => new Response(committedHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const resp = await onRequest({ request, next, env: {} });
  assert.equal(resp.status, 200);

  const html = await resp.text();
  assert.equal(html, committedHtml);
});

test('(c) fallback when manifest fails to parse, is missing, or version is not 1', async () => {
  const committedHtml = loadHtml('gallery.html');
  const next = async () => new Response(committedHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  // 1. Missing manifest.json in bucket
  {
    _resetManifestCache();
    const media = new FakeMediaBucket({});
    const request = new Request('https://legacy-hub.pages.dev/gallery.html', { method: 'GET' });
    const resp = await onRequest({ request, next, env: { MEDIA: media } });
    assert.equal(await resp.text(), committedHtml);
  }

  // 2. Unparsable manifest.json
  {
    _resetManifestCache();
    const media = new FakeMediaBucket({ 'manifest.json': '{ unclosed json syntax' });
    const request = new Request('https://legacy-hub.pages.dev/gallery.html', { method: 'GET' });
    const resp = await onRequest({ request, next, env: { MEDIA: media } });
    assert.equal(await resp.text(), committedHtml);
  }

  // 3. Manifest version != 1
  {
    _resetManifestCache();
    const media = new FakeMediaBucket({
      'manifest.json': JSON.stringify({ ...FIXTURE_MANIFEST, version: 2 }),
    });
    const request = new Request('https://legacy-hub.pages.dev/gallery.html', { method: 'GET' });
    const resp = await onRequest({ request, next, env: { MEDIA: media } });
    assert.equal(await resp.text(), committedHtml);
  }
});

test('(d) /media/r2/... serves only current manifest media with cache headers', async () => {
  const media = new FakeMediaBucket({
    'manifest.json': JSON.stringify(FIXTURE_MANIFEST),
    'banners/about.jpg': {
      body: 'fake-jpeg-binary-payload-data',
      httpEtag: '"etag-about-12345"',
      httpMetadata: { contentType: 'image/jpeg' },
    },
    'banners/programs-events.mp4': {
      body: 'fake-mp4-stream',
      httpEtag: '"etag-video-67890"',
      httpMetadata: { contentType: 'video/mp4' },
    },
    'gallery/archived/removed.jpg': {
      body: 'removed-photo',
      httpMetadata: { contentType: 'image/jpeg' },
    },
  });

  // Success case
  {
    const request = new Request('https://legacy-hub.pages.dev/media/r2/banners/about.jpg', { method: 'GET' });
    const resp = await mediaR2Get({
      request,
      env: { MEDIA: media },
      params: { key: ['banners', 'about.jpg'] },
    });

    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(resp.headers.get('etag'), '"etag-about-12345"');
    assert.equal(resp.headers.get('content-type'), 'image/jpeg');
    const text = await resp.text();
    assert.equal(text, 'fake-jpeg-binary-payload-data');
  }

  // The same bucket also contains private metadata and removed photos.
  for (const key of ['manifest.json', 'gallery/archived/removed.jpg']) {
    const request = new Request(`https://legacy-hub.pages.dev/media/r2/${key}`, { method: 'GET' });
    const resp = await mediaR2Get({
      request,
      env: { MEDIA: media },
      params: { key: key.split('/') },
    });
    assert.equal(resp.status, 404, `${key} must not be public`);
  }

  // A current video banner remains streamable.
  {
    const request = new Request('https://legacy-hub.pages.dev/media/r2/banners/programs-events.mp4');
    const resp = await mediaR2Get({
      request,
      env: { MEDIA: media },
      params: { key: ['banners', 'programs-events.mp4'] },
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'video/mp4');
  }

  // Missing object returns 404
  {
    const request = new Request('https://legacy-hub.pages.dev/media/r2/nonexistent.jpg', { method: 'GET' });
    const resp = await mediaR2Get({
      request,
      env: { MEDIA: media },
      params: { key: ['nonexistent.jpg'] },
    });
    assert.equal(resp.status, 404);
  }

  // Without a valid manifest, even a stored banner is not published.
  {
    _resetManifestCache();
    const noManifest = new FakeMediaBucket({
      'banners/about.jpg': { body: 'unpublished', httpMetadata: { contentType: 'image/jpeg' } },
    });
    const request = new Request('https://legacy-hub.pages.dev/media/r2/banners/about.jpg');
    const resp = await mediaR2Get({
      request,
      env: { MEDIA: noManifest },
      params: { key: ['banners', 'about.jpg'] },
    });
    assert.equal(resp.status, 404);
  }

  // Absent MEDIA binding returns 404
  {
    const request = new Request('https://legacy-hub.pages.dev/media/r2/banners/about.jpg', { method: 'GET' });
    const resp = await mediaR2Get({
      request,
      env: {},
      params: { key: ['banners', 'about.jpg'] },
    });
    assert.equal(resp.status, 404);
  }
});

test('(e) video banner swap and photo banner update', async () => {
  const media = new FakeMediaBucket({
    'manifest.json': JSON.stringify(FIXTURE_MANIFEST),
  });

  // 1. Video banner swap on programs-events.html
  {
    const committedHtml = loadHtml('programs-events.html');
    const request = new Request('https://legacy-hub.pages.dev/programs-events.html', { method: 'GET' });
    const next = async () => new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const resp = await onRequest({ request, next, env: { MEDIA: media } });
    assert.equal(resp.status, 200);
    const html = await resp.text();

    // The <img> is replaced with <video class="hero-media" autoplay muted loop playsinline ...>
    assert.ok(html.includes('<video class="hero-media" autoplay muted loop playsinline'));
    assert.ok(html.includes('src="/media/r2/banners/programs-events.mp4"'));
    assert.ok(!html.includes('src="media/headers/programs-events.jpg"'));
  }

  // 2. Photo banner update on about.html
  {
    _resetManifestCache();
    const committedHtml = loadHtml('about.html');
    const request = new Request('https://legacy-hub.pages.dev/about.html', { method: 'GET' });
    const next = async () => new Response(committedHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const resp = await onRequest({ request, next, env: { MEDIA: media } });
    assert.equal(resp.status, 200);
    const html = await resp.text();

    assert.ok(html.includes('<img class="hero-media"'));
    assert.ok(html.includes('src="/media/r2/banners/about.jpg"'));
    assert.ok(!html.includes('src="media/headers/about.jpg"'));
  }
});

test('carousel track rewritten on index.html', async () => {
  const media = new FakeMediaBucket({
    'manifest.json': JSON.stringify(FIXTURE_MANIFEST),
  });

  const committedHtml = loadHtml('index.html');
  const request = new Request('https://legacy-hub.pages.dev/index.html', { method: 'GET' });
  const next = async () => new Response(committedHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const resp = await onRequest({ request, next, env: { MEDIA: media } });
  assert.equal(resp.status, 200);
  const html = await resp.text();

  assert.ok(html.includes('<ul class="carousel-track" data-carousel-track'));
  assert.ok(html.includes('src="/media/r2/thumbs/home-main-preview/img_1.jpg"'));
  assert.ok(html.includes('src="/media/r2/thumbs/home-main-preview/img_2.jpg"'));
  assert.ok(html.includes('alt="Founder speaking with caregiver family at sanctuary"'));
  assert.ok(html.includes('alt="Community circle in gardens"'));
  assert.ok(!html.includes('media/gallery/shoot-238.jpg'));
});

test('manifest caching reuses in-memory copy within 60s TTL', async () => {
  const media = new FakeMediaBucket({
    'manifest.json': JSON.stringify(FIXTURE_MANIFEST),
  });

  const committedHtml = loadHtml('gallery.html');
  const next = async () => new Response(committedHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const req1 = new Request('https://legacy-hub.pages.dev/gallery.html');
  await onRequest({ request: req1, next, env: { MEDIA: media } });
  assert.equal(media.fetchCount, 1);

  const req2 = new Request('https://legacy-hub.pages.dev/gallery.html');
  await onRequest({ request: req2, next, env: { MEDIA: media } });
  assert.equal(media.fetchCount, 1, 'second request should use cached manifest');
});
