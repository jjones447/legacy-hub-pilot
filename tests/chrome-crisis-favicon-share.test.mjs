import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const PUBLIC_PAGES = [
  'index.html',
  'about.html',
  'resources.html',
  'events.html',
  'programs.html',
  'request-support.html',
  'gallery.html',
  'trusted-resources.html',
  'follow-and-learn.html',
  'caregiver-tools.html',
  'community-series.html',
  'drop-in-respite.html',
  'blog.html',
  'donate.html',
  'crisis-help.html',
  'community-wellness-partners.html',
  'dementia-friendly-training.html',
  'wellness-passport.html',
  'faq.html',
  'get-involved.html',
  'portal.html',
  'programs-events.html',
  'sanctuary.html',
];

test('Favicon set and share image files exist on disk and are valid', () => {
  const assets = [
    'favicon.ico',
    'favicon.svg',
    'apple-touch-icon.png',
    'site.webmanifest',
    'icon-192.png',
    'icon-512.png',
    'media/share-default.jpg',
  ];

  for (const asset of assets) {
    const fullPath = resolve(rootDir, asset);
    assert.ok(existsSync(fullPath), `Asset ${asset} must exist on disk`);
  }

  // Check manifest JSON
  const manifestRaw = readFileSync(resolve(rootDir, 'site.webmanifest'), 'utf-8');
  const manifest = JSON.parse(manifestRaw);
  assert.ok(manifest.icons && manifest.icons.length >= 2, 'site.webmanifest must define at least 2 icons');
  const iconSrcs = manifest.icons.map((i) => i.src);
  assert.ok(iconSrcs.includes('icon-192.png'), 'manifest must include icon-192.png');
  assert.ok(iconSrcs.includes('icon-512.png'), 'manifest must include icon-512.png');

  // Verify manifest icon targets exist on disk
  for (const src of iconSrcs) {
    assert.ok(existsSync(resolve(rootDir, src)), `Manifest icon ${src} must exist on disk`);
  }

  // Check favicon.svg format
  const svgContent = readFileSync(resolve(rootDir, 'favicon.svg'), 'utf-8');
  assert.ok(svgContent.includes('<svg'), 'favicon.svg must contain <svg tag');
  assert.ok(svgContent.includes('</svg>'), 'favicon.svg must contain </svg> tag');
});

test('Every public page carries crisis bar, skip link, main landmark, description and OG share tags', (t) => {
  for (const page of PUBLIC_PAGES) {
    t.test(`page ${page} passes chrome, metadata, and accessibility checks`, () => {
      const html = readFileSync(resolve(rootDir, page), 'utf-8');

      // 1. Skip link as first focusable element
      assert.ok(html.includes('<a class="skip-link" href="#main">Skip to content</a>'), `${page} must include skip link`);
      const bodyIdx = html.indexOf('<body');
      const skipIdx = html.indexOf('<a class="skip-link"');
      const firstAIdx = html.indexOf('<a ', bodyIdx);
      assert.ok(skipIdx > bodyIdx, `${page}: skip link must be inside body`);
      assert.equal(skipIdx, firstAIdx, `${page}: skip link must be first link/focusable element in body`);

      // 2. Main landmark with id="main"
      assert.ok(html.includes('id="main"'), `${page} must contain id="main"`);
      assert.ok(html.includes('<main id="main">') || html.includes('<main class="cs-main" id="main">'), `${page} must have main element with id="main"`);

      // 3. Crisis bar
      assert.ok(html.includes('class="crisis-bar"'), `${page} must include crisis bar`);
      assert.ok(html.includes('href="tel:988"'), `${page}: crisis bar must link to tel:988`);
      assert.ok(html.includes('href="tel:911"'), `${page}: crisis bar must link to tel:911`);
      assert.ok(html.includes('href="crisis-help.html"'), `${page}: crisis bar must link to crisis-help.html`);
      assert.ok(html.includes('988'), `${page}: crisis bar must mention 988`);
      assert.ok(html.includes('911'), `${page}: crisis bar must mention 911`);

      // 4. Meta description
      const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']/i);
      assert.ok(descMatch && descMatch[1].trim().length > 0, `${page} must have non-empty meta description`);

      // 5. Open Graph tags
      const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i);
      assert.ok(ogTitleMatch && ogTitleMatch[1].trim().length > 0, `${page} must have non-empty og:title`);

      const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i);
      assert.ok(ogDescMatch && ogDescMatch[1].trim().length > 0, `${page} must have non-empty og:description`);

      assert.ok(html.includes('property="og:image" content="https://caregiversanctuary.org/media/share-default.jpg"'), `${page} must carry production og:image`);
      assert.ok(html.includes('property="og:url" content="https://caregiversanctuary.org'), `${page} must carry production og:url`);
      assert.ok(html.includes('property="og:type" content="website"'), `${page} must carry og:type=website`);
      assert.ok(html.includes('property="og:site_name" content="Legacy Home &amp; Respite Care Foundation, Inc."') ||
                html.includes('property="og:site_name" content="Legacy Home & Respite Care Foundation, Inc."'), `${page} must carry og:site_name`);
      assert.ok(html.includes('name="twitter:card" content="summary_large_image"'), `${page} must carry twitter:card=summary_large_image`);

      // 6. Favicon set in head
      assert.ok(html.includes('rel="icon" href="favicon.ico"'), `${page} must link favicon.ico`);
      assert.ok(html.includes('rel="icon" href="favicon.svg"'), `${page} must link favicon.svg`);
      assert.ok(html.includes('rel="apple-touch-icon" href="apple-touch-icon.png"'), `${page} must link apple-touch-icon.png`);
      assert.ok(html.includes('rel="manifest" href="site.webmanifest"'), `${page} must link site.webmanifest`);
    });
  }
});

test('staff.html and coming-soon.html get favicon and skip-link, but NO crisis bar', () => {
  for (const page of ['staff.html', 'coming-soon.html']) {
    const html = readFileSync(resolve(rootDir, page), 'utf-8');

    // Must have favicon links
    assert.ok(html.includes('rel="icon" href="favicon.ico"'), `${page} must link favicon.ico`);
    assert.ok(html.includes('rel="icon" href="favicon.svg"'), `${page} must link favicon.svg`);
    assert.ok(html.includes('rel="apple-touch-icon" href="apple-touch-icon.png"'), `${page} must link apple-touch-icon.png`);
    assert.ok(html.includes('rel="manifest" href="site.webmanifest"'), `${page} must link site.webmanifest`);

    // Must have skip-link and id="main"
    assert.ok(html.includes('<a class="skip-link" href="#main">Skip to content</a>'), `${page} must include skip link`);
    assert.ok(html.includes('id="main"'), `${page} must have id="main"`);

    // Must NOT have crisis bar
    assert.ok(!html.includes('class="crisis-bar"'), `${page} must NOT have crisis bar`);
  }
});

test('styles.css contains required styling for crisis bar and skip link', () => {
  const css = readFileSync(resolve(rootDir, 'styles.css'), 'utf-8');

  // Crisis bar styling
  assert.ok(css.includes('.crisis-bar'), 'styles.css must style .crisis-bar');
  assert.ok(css.includes('var(--plum-dark)') || css.includes('#5a3526'), 'crisis-bar must use dark plum');
  assert.ok(css.includes('var(--cream)') || css.includes('#faf6f1'), 'crisis-bar must use cream text');
  assert.ok(css.includes('min-height: 44px') || css.includes('min-height:44px'), 'crisis-bar must have min-height: 44px');

  // Skip link styling
  assert.ok(css.includes('.skip-link'), 'styles.css must style .skip-link');
  assert.ok(css.includes('.skip-link:focus'), 'styles.css must style .skip-link:focus');
});
