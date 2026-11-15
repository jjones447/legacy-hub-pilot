// [pc2-claude-ct-2] Downloadable guides: Legacy's PDFs on Caregiver Tools & Guides (requester, Nov 15 2026, ts 1794776850.346729).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectSiteFiles } from '../scripts/build-site.mjs';

const root = new URL('../', import.meta.url);
const page = readFileSync(new URL('caregiver-tools.html', root), 'utf8');
const { downloads } = JSON.parse(readFileSync(new URL('content/resources.json', root), 'utf8'));
const section = page.slice(page.indexOf('id="downloads"'), page.indexOf('</section>', page.indexOf('id="downloads"')));

test('each PDF is listed by its document name and links to a real PDF that deploys', () => {
  assert.deepEqual(downloads.map(d => d.title), [
    'Fostering Communication With Your Loved One',
    'Caregiver Stress Meter Worksheet',
    'Caregiver Weekly Wellness Checklist',
    'Caregiver Wellness Weekly Care Plan',
  ]);
  const deployed = new Set(selectSiteFiles(new URL('.', root).pathname));
  for (const d of downloads) {
    assert.ok(section.includes(`<h3>${d.title}</h3>\n        <p>${d.description}</p>`), d.title);
    assert.ok(d.description.length > 40, d.title);
    const href = `media/downloads/${d.file}`;
    assert.ok(section.includes(`href="${href}" target="_blank" rel="noopener">Download PDF &rarr;</a>`), href);
    assert.ok(deployed.has(href), `${href} is in the deploy allowlist`);
    assert.equal(readFileSync(new URL(href, root)).subarray(0, 5).toString(), '%PDF-');
  }
  assert.equal((section.match(/class="card download-item"/g) || []).length, downloads.length);
});

test('the downloads section no longer says "Content coming"', () => {
  assert.doesNotMatch(section, /Content coming|badge-phase2/);
});
