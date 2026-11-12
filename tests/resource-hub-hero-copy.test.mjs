// [pc2-claude-ct-2] Resource Hub hero wording (requester, Nov 12 2026, thread 1794495275.897819).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../resources.html', import.meta.url), 'utf8');

test('Resource Hub hero uses the requested heading, subtitle and paragraph', () => {
  const hero = page.match(/<section class="hero has-media resources-hero[^"]*">([\s\S]*?)<\/section>/)?.[1] || '';
  assert.match(hero, /<h1 class="hero-title-clamp">Resource Hub<\/h1>\s*<p class="lede resources-hero-sub">You Don’t Have to Figure It All Out Alone\.<\/p>\s*<p class="lede">Caregiving comes with questions, challenges, and decisions that aren’t always easy to navigate\. Our Resource Hub brings together helpful information, tools, and support to guide you along the way\.<\/p>/);
  assert.doesNotMatch(page, /No more hunting across five different sites/);
});

test('Resource Hub hero uses the requester photo (Nov 12, ts 1794495275.897819)', () => {
  assert.match(page, /<img class="hero-media" src="media\/headers\/resources-table\.jpg" alt="" aria-hidden="true" width="1440" height="1920" decoding="async">/);
  assert.ok(readFileSync(new URL('../media/headers/resources-table.jpg', import.meta.url)).length > 100000);
});
