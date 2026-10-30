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

function navigationFixture() {
  const handlers = {};
  const document = {
    activeElement: null,
    querySelectorAll: () => items,
    addEventListener(type, fn) { handlers[type] = fn; },
  };
  const items = Array.from({ length: 3 }, () => {
    const classes = new Set();
    const child = {};
    const button = {
      expanded: 'false', focusCalls: 0,
      addEventListener(type, fn) { this[type] = fn; },
      setAttribute(name, value) { if (name === 'aria-expanded') this.expanded = value; },
      focus() { this.focusCalls++; document.activeElement = this; },
    };
    return {
      button, child, querySelector: () => button,
      addEventListener(type, fn) { this[type] = fn; },
      contains: target => target === child || target === button,
      classList: { contains: c => classes.has(c), remove: c => classes.delete(c), toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } },
    };
  });
  runInNewContext(loadFile('nav-v2.js'), {
    document, window: { matchMedia: () => ({ matches: false }) },
  });
  const click = { stopPropagation() {} };
  return { document, handlers, items, click };
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
  assert.match(main, /<h2>Caregiver Sanctuary Programs &amp; Resources<\/h2>/);
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

test('hero secondary CTA has an opaque high-contrast surface in default, hover and keyboard-focus states', () => {
  const css = loadFile('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  function declarations(selector) {
    const matches = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(match => match[1].split(',').some(part => part.trim() === selector));
    assert.ok(matches.length, `missing ${selector} rule`);
    return Object.fromEntries(matches.flatMap(match => [...match[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()])));
  }
  const palette = declarations(':root');
  function rgb(value) {
    const variable = value.match(/^var\((--[\w-]+)\)$/);
    const hex = variable ? palette[variable[1]] : value;
    assert.match(hex, /^#[\da-f]{6}$/i, 'CTA colors must be opaque, independently of the hero image');
    return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  }
  function luminance(color) {
    const linear = rgb(color).map(channel => {
      const srgb = channel / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  const base = declarations('.hero .btn-outline');
  for (const state of ['', ':hover', ':focus', ':focus-visible']) {
    const style = { ...base, ...(state ? declarations(`.hero .btn-outline${state}`) : {}) };
    const foreground = luminance(style.color);
    const background = luminance(style.background);
    const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    assert.ok(contrast >= 4.5, `${state || 'default'} contrast ${contrast.toFixed(2)} must reach 4.5:1`);
  }
  const focus = declarations('.btn:focus-visible');
  assert.match(focus.outline, /solid/);
  assert.equal(focus['outline-offset'], '2px');
  assert.match(loadFile('sanctuary.html'), /class="btn btn-outline" href="request-support.html">Contact \/ Request Support/);
});

test('existing click/touch expansion, one-open-menu rule and Escape dismissal still work with the combined menu', () => {
  const { handlers, items, click } = navigationFixture();
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

test('Escape from an open dropdown descendant closes it and restores its own toggle focus', () => {
  const { document, handlers, items, click } = navigationFixture();
  for (const item of items) {
    item.button.click(click);
    document.activeElement = item.child;
    handlers.keydown({ key: 'Escape', target: item.child });
    assert.equal(item.button.expanded, 'false');
    assert.equal(document.activeElement, item.button);
    assert.equal(item.button.focusCalls, 1);
    assert.ok(items.every(it => it.button.expanded === 'false'));
  }
});

test('Escape outside the open dropdown or in a closed dropdown does not steal focus', () => {
  for (const targetKind of ['outside', 'closed-child', 'closed-toggle']) {
    const { document, handlers, items, click } = navigationFixture();
    items[0].button.click(click);
    const target = targetKind === 'outside' ? {} : targetKind === 'closed-child' ? items[1].child : items[1].button;
    document.activeElement = target;
    handlers.keydown({ key: 'Escape', target });
    assert.equal(document.activeElement, target, targetKind);
    assert.ok(items.every(it => it.button.expanded === 'false'));
    assert.ok(items.every(it => it.button.focusCalls === 0));
  }
});

test('other keys and outside clicks preserve existing dismissal behavior without restoring toggle focus', () => {
  const { document, handlers, items, click } = navigationFixture();
  items[0].button.click(click);
  document.activeElement = items[0].child;
  handlers.keydown({ key: 'Tab', target: items[0].child });
  assert.equal(items[0].button.expanded, 'true');
  assert.equal(document.activeElement, items[0].child);
  handlers.click();
  assert.ok(items.every(it => it.button.expanded === 'false'));
  assert.ok(items.every(it => it.button.focusCalls === 0));
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

test('O26-02/03/04: Sanctuary, About, and Get Involved place hero text over supplied media without wordmark overlay or side-by-side hero layout', () => {
  const sanctuaryHtml = loadFile('sanctuary.html');
  const sanctuaryHero = sanctuaryHtml.match(/<section class="hero has-media client-video-hero[^"]*">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(sanctuaryHero, 'Sanctuary hero section must exist');
  assert.doesNotMatch(sanctuaryHero, /caregiver-sanctuary-logo\.png|client-sanctuary-wordmark|client-video-layout|client-video-panel/);
  assert.match(sanctuaryHero, /<video class="hero-media" muted loop playsinline data-motion-autoplay preload="metadata" width="720" height="1280" aria-label="Caregiver Sanctuary community video">/);
  assert.doesNotMatch(sanctuaryHero, /\sautoplay(?:\s|>)/, 'motion preference is checked before playback');
  assert.match(sanctuaryHero, /<source src="media\/client-oct16\/sanctuary-video-1\.mp4#t=0\.1" type="video\/mp4">/);
  assert.match(sanctuaryHero, /<div class="hero-scrim" aria-hidden="true"><\/div>\s*<div class="container hero-content">/);
  assert.match(sanctuaryHero, /<h1 class="hero-title-clamp">Caregiver Sanctuary<\/h1>/);
  assert.match(sanctuaryHero, /<a class="btn btn-coral" href="programs\.html">Join Caregiver Sanctuary<\/a>/);
  assert.match(sanctuaryHero, /<a class="btn btn-outline" href="request-support\.html">Contact \/ Request Support<\/a>/);

  for (const rel of ['about.html', 'templates/about.html.j2']) {
    const aboutHtml = loadFile(rel);
    const aboutHero = aboutHtml.match(/<section class="hero has-media about-hero[^"]*">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(aboutHero, `${rel}: About hero section must exist`);
    assert.doesNotMatch(aboutHero, /client-photo-hero|client-hero-layout/);
    assert.match(aboutHero, /<img class="hero-media" src="media\/client-oct16\/about-family-img-1846\.jpg" alt="" aria-hidden="true" width="2058" height="1474" decoding="async">/);
    assert.match(aboutHero, /<div class="hero-scrim" aria-hidden="true"><\/div>\s*<div class="container hero-content">/);
    assert.match(aboutHtml, /<figure class="client-founder-photo">\s*<img src="media\/client-oct16\/founder-img-7045\.jpg"/);
  }

  const getInvolvedHtml = loadFile('get-involved.html');
  const getInvolvedHero = getInvolvedHtml.match(/<section class="hero has-media get-involved-hero[^"]*">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(getInvolvedHero, 'Get Involved hero section must exist');
  assert.doesNotMatch(getInvolvedHero, /client-photo-hero|client-hero-layout/);
  assert.match(getInvolvedHero, /<img class="hero-media" src="media\/client-oct16\/get-involved-header-photo-1\.jpg" alt="" aria-hidden="true" width="4032" height="3024" decoding="async">/);
  assert.match(getInvolvedHero, /<div class="hero-scrim" aria-hidden="true"><\/div>\s*<div class="container hero-content">/);

  const css = loadFile('styles.css');
  assert.match(css, /\.hero\.has-media\.client-video-hero\s+\.hero-media\s*\{[^}]*position:\s*absolute;[^}]*object-fit:\s*cover/);
  assert.match(css, /\.hero\.has-media\.client-video-hero\s+\.hero-scrim\s*\{[^}]*display:\s*block;[^}]*pointer-events:\s*none/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.hero\.has-media\.client-video-hero\s+\.hero-media/);
});
