// [pc2-claude-ct-2] Board of Directors names (requester, Nov 12 2026, ts 1794498341.921939).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('About lists the four board members by name only, in a two-column grid', () => {
  for (const rel of ['../about.html', '../templates/about.html.j2']) {
    const html = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const board = html.match(/id="board">([\s\S]*?)<\/section>/)?.[1] || '';
    assert.match(board, /<p class="muted measure-620">Our Board of Directors provides leadership, guidance, and oversight to help advance Legacy Home &amp; Respite Care Foundation’s mission of supporting family caregivers and those living with dementia\.<\/p>/, rel);
    const names = [...board.matchAll(/<div class="card"><h3>([^<]+)<\/h3><\/div>/g)].map(m => m[1]);
    assert.deepEqual(names, ['Mai Thao', 'Ramona Williams', 'Shamiah Johnson', 'Asia Ajagu'], rel);
    assert.match(board, /<div class="card-grid board-grid mt-24" id="board-list">/, rel);
    assert.doesNotMatch(board, /<img|avatar|Content coming|will be published here/i, rel);
  }
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.card-grid\.board-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 640px\) \{ \.card-grid\.board-grid \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
});
