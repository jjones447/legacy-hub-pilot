import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

function loadHtml(relPath) {
  return readFileSync(resolve(rootDir, relPath), 'utf-8');
}

function renderPartial(collection) {
  const script = `
import json, sys
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, StrictUndefined

root = Path(sys.argv[1])
env = Environment(loader=FileSystemLoader(root / 'templates'), undefined=StrictUndefined, keep_trailing_newline=True)
coll = json.loads(sys.argv[2])
tmpl = env.get_template('_resource-links.html.j2')
print(tmpl.render(collection=coll))
`;
  return execFileSync('python', ['-c', script, rootDir, JSON.stringify(collection)], { encoding: 'utf-8' });
}

test('(a) a grouped collection renders its group titles and every item', () => {
  const html = loadHtml('trusted-resources.html');
  const groupTitles = [
    'Dementia & Caregiver Support',
    'Navigating Care & Services',
    'Respite & Financial Support',
    'Legal Support',
  ];
  for (const title of groupTitles) {
    assert.ok(html.includes(`<h3>${title}</h3>`), `Expected group heading <h3>${title}</h3> in trusted-resources.html`);
  }
  const orgNames = [
    "Alzheimer's Association – Wisconsin Chapter",
    "Wisconsin Alzheimer's Institute – Milwaukee",
    "Lorenzo's House",
    "Milwaukee County Aging & Disability Resource Center (ADRC)",
    "CarePatrol of the Milwaukee Area",
    "Oasis Senior Advisors – Milwaukee",
    "Life Navigators",
    "Respite Care Association of Wisconsin (RCAW)",
    "Hilarity for Charity (HFC)",
    "St. Ann Center for Intergenerational Care",
    "SeniorLAW – Legal Action of Wisconsin",
  ];
  for (const name of orgNames) {
    assert.ok(html.includes(name), `Expected ${name} in trusted-resources.html`);
  }

  // Synthetic check
  const synthetic = {
    title: 'Synthetic Grouped',
    groups: [
      {
        title: 'Group One',
        items: [
          { name: 'Item 1A', url: 'https://example.com/1a' },
          { name: 'Item 1B', url: 'https://example.com/1b' }
        ]
      },
      {
        title: 'Group Two',
        blurb: 'Group two description',
        items: [
          { name: 'Item 2A', url: 'https://example.com/2a' }
        ]
      }
    ]
  };
  const rendered = renderPartial(synthetic);
  assert.match(rendered, /<h3>Group One<\/h3>/);
  assert.match(rendered, /<h3>Group Two<\/h3>/);
  assert.match(rendered, /<p class="muted measure-640">Group two description<\/p>/);
  assert.match(rendered, /<h3>Item 1A<\/h3>/);
  assert.match(rendered, /<h3>Item 1B<\/h3>/);
  assert.match(rendered, /<h3>Item 2A<\/h3>/);
});

test('(b) a flat collection still renders unchanged', () => {
  const html = loadHtml('trusted-resources.html');
  assert.match(html, /<h2>Our caregivers' trusted resources<\/h2>/);
  assert.match(html, /We are gathering these now\. If you have one to suggest/);
  assert.match(html, /<span class="badge-phase2">Content coming<\/span>/);

  // Synthetic flat collection with items
  const syntheticFlat = {
    title: 'Flat Collection',
    blurb: 'Flat blurb',
    items: [
      { name: 'Flat Item 1', note: 'Note 1', url: 'https://example.com/1' },
      { name: 'Flat Item 2', note: 'Note 2', url: '' }
    ]
  };
  const rendered = renderPartial(syntheticFlat);
  assert.match(rendered, /<h2>Flat Collection<\/h2>/);
  assert.match(rendered, /<p class="muted measure-640">Flat blurb<\/p>/);
  assert.match(rendered, /<h3>Flat Item 1<\/h3>/);
  assert.match(rendered, /Visit Flat Item 1 &rarr;/);
  assert.match(rendered, /<h3>Flat Item 2<\/h3>/);
  assert.match(rendered, /<span class="badge-phase2">Link coming<\/span>/);
  assert.doesNotMatch(rendered, /<div class="mt-40">/);
});

test('(c) an item with several links renders each one', () => {
  const html = loadHtml('follow-and-learn.html');
  assert.match(html, /<h3>Adria Thompson \| Be Light Care<\/h3>/);
  assert.match(html, /href="https:\/\/www\.instagram\.com\/belightcare\/" target="_blank" rel="noopener">Instagram<\/a>/);
  assert.match(html, /href="https:\/\/www\.belightcare\.com\/" target="_blank" rel="noopener">Website<\/a>/);

  // Synthetic item with 4 links
  const synthetic = {
    title: 'Multi-Link Collection',
    items: [
      {
        name: 'Creator Multi',
        links: [
          { label: 'Instagram', url: 'https://instagram.com/creator' },
          { label: 'Website', url: 'https://creator.com' },
          { label: 'YouTube', url: 'https://youtube.com/creator' },
          { label: 'Substack', url: 'https://creator.substack.com' }
        ]
      }
    ]
  };
  const rendered = renderPartial(synthetic);
  assert.match(rendered, /Instagram<\/a> &middot;/);
  assert.match(rendered, /Website<\/a> &middot;/);
  assert.match(rendered, /YouTube<\/a> &middot;/);
  assert.match(rendered, /Substack<\/a>/);
});

test('(d) an item with an empty url still renders the "link coming" treatment rather than a dead link', () => {
  const synthetic = {
    title: 'Pending Links',
    items: [
      { name: 'Unlinked Org', note: 'Awaiting client link', url: '' }
    ]
  };
  const rendered = renderPartial(synthetic);
  assert.match(rendered, /<h3>Unlinked Org<\/h3>/);
  assert.match(rendered, /<span class="badge-phase2">Link coming<\/span>/);
  assert.doesNotMatch(rendered, /href=""/);
  assert.doesNotMatch(rendered, /href="#"/);
});
