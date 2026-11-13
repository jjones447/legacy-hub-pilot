// [pc2-claude-ct-2] Caregiver Stories page (requester, Nov 12 2026, ts 1794511707.791789 / 1794512364.914579).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../caregiver-stories.html', import.meta.url), 'utf8');
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Read More Stories on the home page opens the Caregiver Stories page, not Programs', () => {
  assert.match(home, /<a href="caregiver-stories\.html" class="btn btn-outline">Read More Stories<\/a>/);
  assert.doesNotMatch(home, /href="programs\.html" class="btn btn-outline">Read More Stories/);
});

test('the page shows all five requester stories with names, in order', () => {
  assert.match(page, /<h1 class="hero-title-clamp">Caregiver Stories<\/h1>/);
  const names = [...page.matchAll(/<p class="story-by">— ([^<]+)<\/p>/g)].map(m => m[1]);
  assert.deepEqual(names, ['Lena C. Taylor', 'Montez Ashley', 'Lisa Smith', 'Joan Snowden', 'Shamiah Tanner']);
  for (const phrase of ['priceless for me during this very difficult Alzheimer’s journey', 'is a godsend', 'You don’t know what you don’t know until help arrives unexpectedly.',
    'let go and let them host', 'Encourage Yourself, Speak Over Yourself in the Lord', 'seen, safe, and loved', 'Thank you Legacy!']) {
    assert.ok(page.includes(phrase), phrase);
  }
  assert.equal((page.match(/<details class="story-more">/g) || []).length, 2);
});
