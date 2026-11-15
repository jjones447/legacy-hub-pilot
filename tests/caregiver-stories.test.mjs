// [pc2-claude-ct-2] Caregiver Stories page (requester, Nov 12 2026, ts 1794511707.791789 / 1794512364.914579).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../caregiver-stories.html', import.meta.url), 'utf8');
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the home voices section links to the Caregiver Stories page (requester, Nov 15: "Read Their Stories")', () => {
  assert.match(home, /<a href="caregiver-stories\.html" class="btn btn-outline">Read Their Stories<\/a>/);
  assert.doesNotMatch(home, /href="programs\.html" class="btn btn-outline">Read/);
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

// Requester, Nov 15 2026 (ts 1794771193.465119): relationships update.
test('stories intro, real excerpts with names and links on Home, About and Sanctuary', () => {
  const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  assert.match(page, /<p class="lede">Real Experiences\. Real Connections\.<\/p>/);
  assert.match(page, /Every caregiver has a story, and we’re grateful when families choose to share theirs with us\./);
  for (const id of ['story-lena-c-taylor', 'story-montez-ashley', 'story-lisa-smith', 'story-joan-snowden', 'story-shamiah-tanner']) assert.match(page, new RegExp(`id="${id}"`), id);
  // Excerpts must be verbatim from the published stories.
  assert.ok(page.includes('The bonds we build are strong.'));
  assert.ok(page.includes('I felt so supported by Legacy’s founder'));
  assert.ok(page.includes('It is a great feeling to know that they are safe, and not have to worry.'));
  const home = read('index.html');
  assert.match(home, /<h2>The People Behind the Stories<\/h2>/);
  assert.doesNotMatch(home, /Legacy reminded me that I mattered too/);
  for (const html of [home, read('about.html')]) {
    assert.match(html, /<blockquote>“The bonds we build are strong\.”<\/blockquote>\s*<figcaption class="voice-by">— Lisa Smith<\/figcaption>\s*<a class="more" href="caregiver-stories\.html#story-lisa-smith">/);
    assert.match(html, /<blockquote>“I felt so supported by Legacy’s founder”<\/blockquote>\s*<figcaption class="voice-by">— Lena C\. Taylor<\/figcaption>\s*<a class="more" href="caregiver-stories\.html#story-lena-c-taylor">/);
  }
  const about = read('about.html');
  assert.ok(about.indexOf('More Than Services. It’s About Relationships.') > about.indexOf('id="story"'));
  assert.ok(about.indexOf('More Than Services. It’s About Relationships.') < about.indexOf('id="shanelle"'));
  assert.match(about, /href="caregiver-stories\.html" class="btn btn-outline">Read More Caregiver Stories<\/a>/);
  // Requester, Nov 15 (ts 1794771760.493899): "Trust Makes a Difference" moved from Sanctuary to Drop-In Respite.
  const sanctuary = read('sanctuary.html');
  assert.doesNotMatch(sanctuary, /Trust Makes a Difference/);
  assert.match(sanctuary, /7828 W Appleton Avenue, Milwaukee, WI/);
  const respite = read('drop-in-respite.html');
  assert.ok(respite.indexOf('Trust Makes a Difference') > respite.indexOf('id="how-it-works"'));
  assert.ok(respite.indexOf('Trust Makes a Difference') < respite.indexOf('id="faith-community"'));
  assert.match(respite, /<blockquote>“It is a great feeling to know that they are safe, and not have to worry\.”<\/blockquote>\s*<figcaption class="voice-by">— Shamiah Tanner<\/figcaption>/);
  assert.match(respite, /href="caregiver-stories\.html">Read Caregiver Stories<\/a>/);
});
