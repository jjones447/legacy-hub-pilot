// The caregiver portal gets a half-height banner (client meeting 2026-09-29), using the same
// media and scrim as the other pages' banners, so a Drive picture1 for a "portal" folder can replace it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const PORTAL = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const MEDIA = readFileSync(new URL('../functions/_media.mjs', import.meta.url), 'utf8');

test('portal.html has a half-height banner above the sign-in form, with a real image', () => {
  const hero = PORTAL.match(/<section class="hero has-media hero-half">[\s\S]*?<\/section>/);
  assert.ok(hero, 'half-height hero section present');
  const src = hero[0].match(/class="hero-media" src="([^"]+)"/)[1];
  assert.ok(existsSync(new URL(`../${src}`, import.meta.url)), `${src} exists`);
  assert.ok(PORTAL.indexOf('hero-half') < PORTAL.indexOf('id="loginView"'), 'banner comes before the sign-in form');
});

test('the half-height banner is styled smaller than a full banner, and smaller again on phones', () => {
  assert.match(CSS, /\.hero\.hero-half \{ padding: 24px 0 28px;/);
  assert.match(CSS, /@media \(max-width: 768px\) \{ \.hero\.hero-half \{ padding: 20px 0 24px; \} \}/);
});

test('Drive media can replace the portal banner (route mapped to a "portal" area)', () => {
  assert.match(MEDIA, /'\/portal': 'portal'/);
  assert.match(MEDIA, /'\/portal\.html': 'portal'/);
});
