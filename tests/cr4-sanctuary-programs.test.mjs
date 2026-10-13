// Sanctuary structure, including the October 13 program/event and Network navigation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadFile(relPath) {
  return fs.readFileSync(path.join(rootDir, relPath), 'utf8');
}

const programDestinations = [
  'programs-events.html#support-group', 'community-series.html', 'drop-in-respite.html',
  'wellness-passport.html', 'programs-events.html#event-respite',
  'programs-events.html#family-ed', 'events.html', 'programs-events.html#calendar', 'gallery.html',
];

function sanctuaryDrop(header) {
  const match = header.match(/<a href="sanctuary\.html"[^>]*>The Sanctuary<\/a><button[^>]*>&#9662;<\/button>\s*<div class="drop">([\s\S]*?)\n    <\/div>/);
  assert.ok(match, 'Sanctuary dropdown must exist');
  return match[1];
}

function assertDestination(href) {
  const [file, fragment] = href.split('#');
  assert.ok(fs.existsSync(path.join(rootDir, file)), `missing destination ${file}`);
  if (fragment) assert.ok(loadFile(file).includes(`id="${fragment}"`), `missing destination ${href}`);
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

test('(b) one Sanctuary overview retains every program/event destination and obvious join/contact paths', () => {
  const header = loadFile('templates/_header.html.j2');
  const drop = sanctuaryDrop(header);
  assert.equal([...drop.matchAll(/>Overview<\/a>/g)].length, 1);
  assert.match(drop, /href="sanctuary.html">Overview/);
  assert.match(drop, /href="programs.html">Join Caregiver Sanctuary/);
  assert.match(drop, /href="request-support.html">Contact \/ Request Support/);
  assert.doesNotMatch(header, /aria-label="Programs &amp; Events menu"/);
  assert.equal([...header.matchAll(/aria-label="The Sanctuary menu"/g)].length, 1);
  for (const href of programDestinations) {
    assert.ok(drop.includes(`href="${href}"`), `lost program/event link ${href}`);
    assertDestination(href);
  }
  assertDestination('programs.html');
  assert.match(loadFile('programs.html'), /data-action="open-membership"/);
  assert.match(loadFile('programs.html'), /id="membershipForm"/);
  assertDestination('request-support.html');
});

test('(c) the combined Sanctuary menu keeps Passport as a program and not a separate Wellness Grants link', () => {
  const header = loadFile('templates/_header.html.j2');
  const dropContent = sanctuaryDrop(header);

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

test('(d) Network groups partners and training without a second dropdown or new page', () => {
  const drop = sanctuaryDrop(loadFile('templates/_header.html.j2'));
  const group = drop.match(/<div class="nav-drop-group" role="group" aria-label="Caregiver Sanctuary Network">([\s\S]*?)<\/div>/);
  assert.ok(group, 'Network needs a named navigation group');
  assert.deepEqual([...group[1].matchAll(/href="([^"]+)"/g)].map(m => m[1]), [
    'sanctuary.html#network', 'community-wellness-partners.html', 'dementia-friendly-training.html',
  ]);
  assert.doesNotMatch(group[1], /<button|class="drop"/);
  for (const href of ['sanctuary.html#network', 'community-wellness-partners.html', 'dementia-friendly-training.html']) {
    assertDestination(href);
  }
});

test('every generated public header shares the new hierarchy, first-focus skip link and native dropdown buttons', () => {
  const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
  let checked = 0;
  for (const file of htmlFiles) {
    const html = loadFile(file);
    if (!html.includes('main-nav nav-v2')) continue;
    checked++;
    const nav = html.match(/<nav class="main-nav nav-v2">([\s\S]*?)<\/nav>/)[1];
    const drop = sanctuaryDrop(nav);
    for (const href of programDestinations) assert.ok(drop.includes(`href="${href}"`), `${file}: missing ${href}`);
    assert.equal([...nav.matchAll(/>The Sanctuary<\/a>/g)].length, 1, file);
    assert.match(nav, /<button class="drop-toggle" aria-expanded="false" aria-label="The Sanctuary menu">/);
    assert.equal(html.indexOf('<a ', html.indexOf('<body>')), html.indexOf('<a class="skip-link"'), file);
    assert.match(html, /<main id="main">/);
  }
  assert.equal(checked, 23, 'all current public headers must be checked');
});

test('Sanctuary merges the overview and exposes join/contact before the program and Network sections', () => {
  const html = loadFile('sanctuary.html');
  const main = html.match(/<main id="main">([\s\S]*?)<\/main>/)[1];
  const programsAt = main.indexOf('id="programs-events"');
  assert.ok(programsAt > 0);
  for (const href of ['programs.html', 'request-support.html']) {
    assert.ok(main.indexOf(`href="${href}"`) < programsAt, `early entry required for ${href}`);
  }
  assert.match(main, /<h2>Programs &amp; Events<\/h2>/);
  for (const href of programDestinations) assert.ok(main.includes(`href="${href}"`), href);
  const network = main.slice(main.indexOf('<section id="components">'));
  assert.match(network, /<h2 id="network">Caregiver Sanctuary Network<\/h2>/);
  assert.match(network, /href="community-wellness-partners.html"/);
  assert.match(network, /href="dementia-friendly-training.html"/);
  assert.doesNotMatch(network, /href="wellness-passport.html"/);
  for (const fragment of ['what', 'components', 'partners', 'passport', 'training', 'become']) {
    assertDestination(`sanctuary.html#${fragment}`);
  }
  const footer = loadFile('templates/_footer.html.j2');
  assert.match(footer, /href="staff.html">Staff Console/);
  assert.match(footer, /href="sanctuary.html#network"/);
  assert.match(footer, /href="programs-events.html#community-series"/);
  assert.match(footer, /href="programs-events.html#drop-in"/);
});

test('existing click/touch expansion, one-open-menu rule and Escape dismissal still work with the combined menu', () => {
  const handlers = {};
  const items = Array.from({ length: 3 }, () => {
    const classes = new Set();
    const button = { expanded: 'false', addEventListener(type, fn) { this[type] = fn; }, setAttribute(name, value) { if (name === 'aria-expanded') this.expanded = value; } };
    return {
      button, querySelector() { return button; },
      classList: { contains: c => classes.has(c), remove: c => classes.delete(c), toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } },
    };
  });
  runInNewContext(loadFile('nav-v2.js'), { document: {
    querySelectorAll: () => items, addEventListener(type, fn) { handlers[type] = fn; },
  } });
  const click = { stopPropagation() {} };
  items[0].button.click(click);
  assert.equal(items[0].button.expanded, 'true');
  items[1].button.click(click);
  assert.equal(items[0].button.expanded, 'false');
  assert.equal(items[1].button.expanded, 'true');
  handlers.keydown({ key: 'Escape' });
  assert.ok(items.every(it => it.button.expanded === 'false'));
  items[0].button.click(click);
  items[0].button.click(click);
  assert.equal(items[0].button.expanded, 'false');
  items[0].button.click(click);
  handlers.click();
  assert.ok(items.every(it => it.button.expanded === 'false'));
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
