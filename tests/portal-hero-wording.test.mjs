// [pc2-claude-ct-2] Portal copy without the Wellness Grant wording (requester-approved Nov 1/4,
// #300; shipped to production per legacy-caregiver-hub#54, 2026-11-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const portal = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const build = readFileSync(new URL('../build.py', import.meta.url), 'utf8');

test('portal hero, sign-in sub and description no longer mention grants', () => {
  assert.match(portal, /<p class="lede" data-cs="portal\.hero\.lede">Your events, your wellness and your resources, in one private place\.<\/p>/);
  assert.match(portal, /<p class="sub">Your Sanctuary membership — wellness check-ins, events, and resources in one secure place\.<\/p>/);
  assert.match(portal, /<meta name="description" content="Your events, your wellness and your resources, in one place\.">/);
  assert.match(build, /"description": "Your events, your wellness and your resources, in one place\."/);
  assert.doesNotMatch(portal, /your grant|check-ins, grants,/);
});
