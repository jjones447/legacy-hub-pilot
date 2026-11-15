// [pc2-claude-ct-2] Meet Our Team list (requester, Nov 12 2026, ts 1794498067.874129).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('About lists the requested team, in order, under the requested intro', () => {
  for (const rel of ['../about.html', '../templates/about.html.j2']) {
    const html = readFileSync(new URL(rel, import.meta.url), 'utf8');
    const team = html.match(/<section class="section-sand" id="team">([\s\S]*?)id="board"/)?.[1] || '';
    assert.match(team, /<h2>Meet Our Team<\/h2><\/div>\s*<p class="muted measure-620">Behind Caregiver Sanctuary is a dedicated team committed to supporting family caregivers and the people they love\.<\/p>/, rel);
    const cards = [...team.matchAll(/<div class="card"><h3>([^<]+)<\/h3><p class="muted">([^<]+)<\/p><\/div>/g)].map(m => `${m[1]} | ${m[2]}`);
    assert.deepEqual(cards, [
      'Lauryn Brown | Programs Manager',
      'Alana Fisher | Programs &amp; Operations Coordinator',
      'Jeanette Boatman | Respite Specialist',
      'Laura Jennings | Respite Specialist',
      'Victoria Brown | In-Home Respite Supervisor',
    ], rel);
    assert.doesNotMatch(team, /Team bios and photos will live here|Content coming/, rel);
  }
});
