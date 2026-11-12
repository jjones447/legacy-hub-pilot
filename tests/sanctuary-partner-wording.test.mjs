// [pc2-claude-ct-2] "Become a Caregiver Sanctuary Partner" everywhere (requester, Nov 12 2026, ts 1794495930.475339; Community Series button ts 1794496182.969429).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);

test('no page says "Become a Community Wellness Partner"; the nav and partners page say "Become a Caregiver Sanctuary Partner"', () => {
  const pages = readdirSync(root).filter(f => f.endsWith('.html'));
  for (const f of [...pages, 'templates/_header.html.j2', 'templates/community-wellness-partners.html.j2', 'templates/community-series.html.j2']) {
    assert.doesNotMatch(readFileSync(new URL(f, root), 'utf8'), /Become a Community (Wellness )?Partner/, f);
  }
  assert.match(readFileSync(new URL('templates/_header.html.j2', root), 'utf8'), /<a href="get-involved\.html#partner">Become a Caregiver Sanctuary Partner<\/a>/);
  const partners = readFileSync(new URL('community-wellness-partners.html', root), 'utf8');
  assert.equal((partners.match(/Become a Caregiver Sanctuary Partner/g) || []).length, 4);
  assert.match(readFileSync(new URL('community-series.html', root), 'utf8'), /<a class="btn btn-coral" href="get-involved\.html#partner">Become a Caregiver Sanctuary Partner<\/a>/);
});
