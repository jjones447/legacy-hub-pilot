// Round-trip test per LEGACY-D7-S0B-FIX-R1 (Issue #122)
// Asserts that with the real seed from content/page-sections.json applied,
// every page the edge rewriter serves is byte-identical to the committed build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rewriteContent, _resetContentCache } from '../functions/_content.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

function loadHtml(filename) {
  return readFileSync(resolve(rootDir, filename), 'utf-8');
}

function getPagesWithDataCs() {
  const htmlFiles = readdirSync(rootDir).filter((f) => f.endsWith('.html'));
  const pages = [];
  for (const file of htmlFiles) {
    const content = loadHtml(file);
    if (content.includes('data-cs=') || content.includes('data-cs-list=') || content.includes('data-cs-options=')) {
      pages.push(file);
    }
  }
  return pages.sort();
}

test('round-trip: edge rewrite with real seeded sections matches committed build byte-for-byte', async (t) => {
  _resetContentCache();
  const seedJson = JSON.parse(readFileSync(resolve(rootDir, 'content', 'page-sections.json'), 'utf-8'));
  const sections = seedJson.items;

  const pages = getPagesWithDataCs();
  assert.ok(pages.length >= 6, `expected at least 6 pages with data-cs markers, found ${pages.length}: ${pages.join(', ')}`);
  assert.ok(pages.includes('index.html'), 'must include index.html');
  assert.ok(pages.includes('about.html'), 'must include about.html');
  assert.ok(pages.includes('programs.html'), 'must include programs.html');
  assert.ok(pages.includes('request-support.html'), 'must include request-support.html');
  assert.ok(pages.includes('donate.html'), 'must include donate.html');
  assert.ok(pages.includes('wellness-passport.html'), 'must include wellness-passport.html');

  for (const page of pages) {
    await t.test(`page ${page} matches committed build byte-for-byte`, async () => {
      const committedHtml = loadHtml(page);
      const response = new Response(committedHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

      const rewrittenResponse = await rewriteContent(response, sections);
      const rewrittenHtml = await rewrittenResponse.text();

      if (rewrittenHtml !== committedHtml) {
        // Find first differing line for debugging output
        const origLines = committedHtml.split('\n');
        const rewLines = rewrittenHtml.split('\n');
        let diffDetail = '';
        for (let i = 0; i < Math.max(origLines.length, rewLines.length); i++) {
          if (origLines[i] !== rewLines[i]) {
            diffDetail = `First diff at line ${i + 1}:\n  EXPECTED: ${origLines[i]}\n  ACTUAL:   ${rewLines[i]}`;
            break;
          }
        }
        assert.equal(rewrittenHtml, committedHtml, `Round-trip mismatch for ${page}!\n${diffDetail}`);
      }
      assert.equal(rewrittenHtml, committedHtml);
    });
  }
});
