// Tests for LEGACY-CR4-SANCTUARY-PROGRAMS-R1: Caregiver Sanctuary & Programs restructure.
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

test('(a) each of the three new pages renders and is reachable from the nav', () => {
  const pages = [
    {
      file: 'community-wellness-partners.html',
      title: 'Community Wellness Partners',
      linkText: 'Community Wellness Partners',
    },
    {
      file: 'dementia-friendly-training.html',
      title: 'Dementia-Friendly Training',
      linkText: 'Dementia-Friendly Training',
    },
    {
      file: 'wellness-passport.html',
      title: 'Caregiver Wellness Passport',
      linkText: 'Caregiver Wellness Passport',
    },
  ];

  const header = loadFile('templates/_header.html.j2');

  for (const p of pages) {
    assert.ok(fs.existsSync(path.join(rootDir, p.file)), `${p.file} must exist on disk`);
    const html = loadFile(p.file);
    assert.match(html, new RegExp(`<h1[^>]*>${p.title}<\\/h1>`), `${p.file} must render its h1 title`);
    assert.match(header, new RegExp(`href="${p.file}"`), `${p.file} must be linked in _header.html.j2`);
  }
});

test('(b) the Sanctuary dropdown has exactly the three items and no Passport link', () => {
  const header = loadFile('templates/_header.html.j2');
  // Match the Sanctuary dropdown block
  const match = header.match(/<a href="sanctuary\.html"[^>]*>The Sanctuary<\/a><button[^>]*>&#9662;<\/button>\s*<div class="drop">([\s\S]*?)<\/div>/);
  assert.ok(match, 'Sanctuary dropdown must exist in _header.html.j2');
  const dropContent = match[1];

  // Extract all links inside this drop
  const linkMatches = [...dropContent.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)];
  assert.equal(linkMatches.length, 3, `Sanctuary dropdown must have exactly 3 links, found: ${linkMatches.length}`);

  const expected = [
    { href: 'sanctuary.html', text: 'Overview' },
    { href: 'community-wellness-partners.html', text: 'Community Wellness Partners' },
    { href: 'dementia-friendly-training.html', text: 'Dementia-Friendly Training' },
  ];

  for (let i = 0; i < 3; i++) {
    assert.equal(linkMatches[i][1], expected[i].href);
    assert.equal(linkMatches[i][2], expected[i].text);
  }

  // Ensure no passport link in Sanctuary dropdown
  assert.doesNotMatch(dropContent, /passport/i, 'Sanctuary dropdown must not contain any Passport link');
});

test('(c) the Programs dropdown lists the Passport and not Wellness Grants', () => {
  const header = loadFile('templates/_header.html.j2');
  // Match the Programs & Events dropdown block
  const match = header.match(/<a href="programs-events\.html"[^>]*>Programs &amp; Events<\/a><button[^>]*>&#9662;<\/button>\s*<div class="drop">([\s\S]*?)<\/div>/);
  assert.ok(match, 'Programs & Events dropdown must exist in _header.html.j2');
  const dropContent = match[1];

  // Must list Caregiver Wellness Passport
  assert.match(
    dropContent,
    /<a href="wellness-passport\.html">Caregiver Wellness Passport<\/a>/,
    'Programs dropdown must list Caregiver Wellness Passport'
  );

  // Must not list Wellness Grants
  assert.doesNotMatch(
    dropContent,
    /Wellness Grants/i,
    'Programs dropdown must not list Wellness Grants'
  );
  assert.doesNotMatch(
    dropContent,
    /href="programs\.html#grants"/,
    'Programs dropdown must not link to programs.html#grants'
  );
});

test('(d) no page contains "Sanctuary Network"', () => {
  const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
  for (const f of htmlFiles) {
    const content = loadFile(f);
    assert.doesNotMatch(content, /sanctuary network/i, `${f} still contains "Sanctuary Network"`);
  }
  const templatesDir = path.join(rootDir, 'templates');
  const templateFiles = fs.readdirSync(templatesDir).filter(f => f.endsWith('.j2'));
  for (const f of templateFiles) {
    const content = fs.readFileSync(path.join(templatesDir, f), 'utf8');
    assert.doesNotMatch(content, /sanctuary network/i, `templates/${f} still contains "Sanctuary Network"`);
  }
});

test('(e) the Passport page contains all five structure points and names the Wellness Grant as a benefit', () => {
  const html = loadFile('wellness-passport.html');

  // Verify all 5 structure points
  assert.match(html, /Wellness Activities/i, 'Passport missing point: Wellness Activities');
  assert.match(html, /Caregiver Sanctuary Program Participation/i, 'Passport missing point: Caregiver Sanctuary Program Participation');
  assert.match(html, /Community Wellness Partner Experiences/i, 'Passport missing point: Community Wellness Partner Experiences');
  assert.match(html, /Engagement Tracking/i, 'Passport missing point: Engagement Tracking');
  assert.match(html, /Wellness Grant Eligibility/i, 'Passport missing point: Wellness Grant Eligibility');

  // Names the Wellness Grant as a benefit of participation
  assert.match(
    html,
    /Wellness Grant eligibility as a benefit of participation/i,
    'Passport must describe the Wellness Grant as a benefit of participation'
  );

  // Verifies the grant apply button is reachable from the page
  assert.match(html, /data-action="open-grant-apply"/, 'Passport must provide data-action="open-grant-apply"');
  assert.match(html, /id="grantApplyModal"/, 'Passport must include grant application modal machinery');
});
