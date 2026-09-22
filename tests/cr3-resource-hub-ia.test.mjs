// Tests for LEGACY-CR3-RESOURCE-HUB-IA-R1: Resource Hub restructure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadFile(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

test('(a) the crisis page renders and contains tel:988', () => {
  assert.ok(fs.existsSync(path.join(rootDir, 'crisis-help.html')), 'crisis-help.html must exist');
  const html = loadFile('crisis-help.html');
  assert.match(html, /<h1 class="hero-title-clamp">Crisis &amp; Emergency Help<\/h1>/);
  assert.match(html, /href="tel:988"/);
  assert.match(html, /Call or text 988/);
});

test('(b) directory.html is gone and _redirects carries the rule', () => {
  assert.equal(fs.existsSync(path.join(rootDir, 'directory.html')), false, 'directory.html must be deleted');
  assert.ok(fs.existsSync(path.join(rootDir, '_redirects')), '_redirects file must exist');
  const redirects = loadFile('_redirects');
  assert.match(redirects, /^\/directory\.html\s+\/crisis-help\.html\s+301/m);

  // Assert no html files or templates link to directory.html
  const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
  for (const f of htmlFiles) {
    const content = loadFile(f);
    assert.doesNotMatch(content, /href=["']directory\.html["']/, `${f} still contains link to directory.html`);
  }
  const templatesDir = path.join(rootDir, 'templates');
  const templateFiles = fs.readdirSync(templatesDir).filter(f => f.endsWith('.j2'));
  for (const f of templateFiles) {
    const content = fs.readFileSync(path.join(templatesDir, f), 'utf8');
    assert.doesNotMatch(content, /href=["']directory\.html["']/, `templates/${f} still contains link to directory.html`);
  }
});

test('(c) the seven filter chips render on Caregiver Tools & Guides and no search input exists on the Resource Hub', () => {
  const toolsHtml = loadFile('caregiver-tools.html');
  assert.match(toolsHtml, /<h2>Search Caregiver Tools &amp; Guides<\/h2>/);
  assert.match(toolsHtml, /<input[^>]+id="resourceSearch"/);
  assert.match(toolsHtml, /<div[^>]+id="filterRow"/);
  assert.match(toolsHtml, /<div[^>]+id="resourceGrid"/);

  const expectedChips = [
    { cat: 'all', label: 'All' },
    { cat: 'dementia-education', label: 'Dementia Education' },
    { cat: 'communication', label: 'Communication' },
    { cat: 'care-skills', label: 'Care Skills' },
    { cat: 'caregiver-wellness', label: 'Caregiver Wellness' },
    { cat: 'planning-safety', label: 'Planning &amp; Safety' },
    { cat: 'financial-legal', label: 'Financial &amp; Legal' },
  ];

  for (const chip of expectedChips) {
    const chipRegex = new RegExp(`<button[^>]+class="filter-chip[^"]*"[^>]+data-cat="${chip.cat}"[^>]*>${chip.label}<\\/button>`);
    assert.match(toolsHtml, chipRegex, `Missing filter chip for ${chip.cat} (${chip.label})`);
  }

  const resHtml = loadFile('resources.html');
  assert.equal(resHtml.includes('id="resourceSearch"'), false, 'Resource Hub must not have search input');
  assert.equal(resHtml.includes('id="filterRow"'), false, 'Resource Hub must not have filter row');
  assert.equal(resHtml.includes('id="legacy-programs"'), false, 'Resource Hub must not have legacy programs section');
  assert.equal(resHtml.includes('id="crisis"'), false, 'Resource Hub must not have old crisis section');

  // Verify Resource Hub landing has the six nav cards
  const expectedNavCards = [
    'Find Local Services',
    'Our Trusted Resources',
    'Follow + Learn',
    'Caregiver Tools &amp; Guides',
    'FAQ',
    'Crisis &amp; Emergency Help',
  ];
  for (const cardTitle of expectedNavCards) {
    assert.ok(resHtml.includes(`<h3>${cardTitle}</h3>`), `Resource Hub missing nav card: ${cardTitle}`);
  }
});

test('(d) the CTA text is present verbatim', () => {
  const toolsHtml = loadFile('caregiver-tools.html');
  assert.match(toolsHtml, /<h2>Looking for more support\?<\/h2>/);
  assert.match(
    toolsHtml,
    /<p>Explore Caregiver Sanctuary programs, including respite, caregiver support groups, wellness opportunities, community experiences, and more\.<\/p>/
  );
  assert.match(
    toolsHtml,
    /<a href="programs\.html" class="btn btn-coral">Explore Programs &amp; Support<\/a>/
  );
});

test('(e) every item in resources.json uses one of the six categories', () => {
  const raw = loadFile('content/resources.json');
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.items) && data.items.length > 0, 'resources.json items must be non-empty');

  const validCategories = new Set([
    'dementia-education',
    'communication',
    'care-skills',
    'caregiver-wellness',
    'planning-safety',
    'financial-legal',
  ]);

  for (const item of data.items) {
    assert.ok(
      validCategories.has(item.category),
      `Item "${item.title}" uses unexpected category "${item.category}". Must be one of: ${Array.from(validCategories).join(', ')}`
    );
  }
});
