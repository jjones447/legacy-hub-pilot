// Tests for LEGACY-CR1-HOME-COPY-R1: client change request home page copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);

function file(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

test('home page carries client banner headline and lede verbatim', () => {
  const html = file('index.html');
  assert.match(
    html,
    /<h1[^>]*>A place for caregivers to find support, respite, wellness and community<\/h1>/
  );
  assert.match(
    html,
    /<p class="lede"[^>]*>We support family caregivers through respite, wellness, education, resources and meaningful community connection, with specialized support for families navigating dementia and other care needs\.<\/p>/
  );
});

test('home page carries client two-line headline and journey panel copy verbatim', () => {
  const html = file('index.html');
  assert.match(
    html,
    /<h2[^>]*>Caregiving can change every part of life\.<br>You shouldn't have to navigate it alone\.<\/h2>/
  );
  assert.match(
    html,
    /<p[^>]*>Caring for someone living with dementia can change every part of life\. As needs evolve, caregivers often find themselves navigating new roles, responsibilities, and decisions while trying to care for themselves, too\. Caregiver Sanctuary provides respite, wellness, practical support, and community to help caregivers feel supported throughout the journey\.<\/p>/
  );
});

test('home support preserves client copy with sentence-case presentation and useful existing-route cards', () => {
  const html = file('index.html');
  const support = html.match(/<section class="section-sand home-support">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(support, 'homepage support section exists');
  assert.match(support, /<h2 class="home-support-heading" data-cs="home.support.heading">HOW WE SUPPORT CAREGIVERS<\/h2>/);
  assert.deepEqual([...support.matchAll(/<h3>([^<]+)<\/h3>/g)].map(match => match[1]), ['Wellness', 'Respite', 'Community']);
  const routes = [...support.matchAll(/<a class="more" href="([^"]+)">/g)].map(match => match[1]);
  assert.deepEqual(routes, ['wellness-passport.html', 'drop-in-respite.html', 'community-series.html']);
  for (const route of routes) assert.match(file(route), /<!DOCTYPE html>/i);

  // Descriptions are reused verbatim from existing program pages, not new service claims.
  for (const [description, source] of [
    ['Connect with wellness activities, partner experiences, and grant benefits.', 'drop-in-respite.html'],
    ['Time to breathe while your loved one is somewhere safe, engaged and cared for.', 'community-series.html'],
    ['Gatherings and wellness sessions for caregivers across the community.', 'drop-in-respite.html'],
  ]) {
    assert.ok(support.includes(description));
    assert.ok(file(source).includes(description));
  }
  const css = file('styles.css');
  assert.match(css, /\.home-support-heading\s*\{[^}]*text-transform:\s*lowercase/);
  assert.match(css, /\.home-support-heading::first-letter\s*\{[^}]*text-transform:\s*uppercase/);
  assert.match(css, /\.home-support \.card-grid\s*\{[^}]*minmax\(0, 1fr\)/);

  // Assert secondary line renders
  assert.match(
    html,
    /<p class="mt-32"[^>]*>Plus education, practical resources and connections to trusted support\.<\/p>/
  );
});

test('home page and template omit the client-removed Community Wellness Partners band', () => {
  for (const path of ['index.html', 'templates/index.html.j2']) {
    const source = file(path);
    assert.doesNotMatch(source, /home\.community_wellness_partners/, `${path}: no removed-band content hooks or template fields`);
    assert.doesNotMatch(source, /<span class="eyebrow"[^>]*>Community Wellness Partners<\/span>/);
    assert.doesNotMatch(source, /Building a Caregiver-Supportive Community/);
    assert.doesNotMatch(source, /Caregiver support shouldn't stop at home or within traditional care settings/);
    assert.doesNotMatch(source, /Learn About Community Wellness Partners/);
    assert.match(source, /<section class="stats-band">/, `${path}: following impact section remains`);
    assert.match(source, /<h2>Building stronger communities together\.<\/h2>/, `${path}: separate partners section remains`);
  }

  // Removing this one band must not remove the existing partner/network navigation.
  const html = file('index.html');
  assert.match(html, /href="community-wellness-partners\.html"/);
  assert.match(html, /href="sanctuary\.html#network"/);
  assert.match(file('templates/index.html.j2'), /{% include '_header\.html\.j2' %}/);
  const header = file('templates/_header.html.j2');
  assert.match(header, /href="community-wellness-partners\.html"/);
  assert.match(header, /href="sanctuary\.html#network"/);
});

test('homepage partner logos link to official pages with preserved assets and keyboard focus', () => {
  const expected = [
    ['https://www.molinahealthcare.com/', 'molina-healthcare.png', 'Molina Healthcare', '180', '54'],
    ['https://www.alz.org/', 'alzheimers-association.svg', "Alzheimer's Association", '714', '135'],
    ['https://www.wecenergygroup.com/community/we-energies-community.htm', 'we-energies-foundation.jpg', 'We Energies Foundation', '255', '77'],
    ['https://www.packers.com/community/packers-foundation', 'green-bay-packers-foundation.png', 'Green Bay Packers Foundation', '1280', '720'],
    ['https://wpp.med.wisc.edu/', 'wisconsin-partnership-program.jpg', 'Wisconsin Partnership Program, University of Wisconsin School of Medicine and Public Health', '1280', '548'],
    ['https://www.nonprofitmanagementfund.org/', 'nonprofit-management-fund.png', 'Nonprofit Management Fund', '1403', '616'],
    ['https://www.greatermilwaukeefoundation.org/', 'greater-milwaukee-foundation.webp', 'Greater Milwaukee Foundation', '2478', '739'],
    ['https://bader.org/', 'bader-philanthropies.png', 'Bader Philanthropies', '11433', '3985'],
    ['https://veridianhomes.com/about/veridian-foundation/', 'veridian-foundation.png', 'Veridian Foundation', '3199', '778'],
  ];
  for (const path of ['index.html', 'templates/index.html.j2']) {
    const list = file(path).match(/<ul class="client-partner-logos"[^>]*>([\s\S]*?)<\/ul>/)?.[1];
    assert.ok(list, `${path}: existing partner list remains`);
    const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1]);
    assert.equal(items.length, expected.length, `${path}: all nine supplied logos remain`);
    for (const [index, [href, asset, alt, width, height]] of expected.entries()) {
      const link = items[index].match(/^<a href="([^"]+)">(<img [^>]+>)<\/a>$/);
      assert.ok(link, `${path}: logo ${index + 1} is a native same-tab anchor`);
      assert.equal(link[1], href);
      const attributes = Object.fromEntries([...link[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      assert.deepEqual(attributes, {
        src: `media/client-oct16/partners/${asset}`, alt, width, height,
        loading: 'lazy', decoding: 'async',
      }, `${path}: exact supplied image, meaningful accessible name, order and dimensions`);
    }
  }
  const css = file('styles.css');
  assert.match(css, /\.client-partner-logos a\s*\{[^}]*display:\s*block;[^}]*width:\s*100%/);
  assert.match(css, /\.client-partner-logos a:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--plum\);[^}]*outline-offset:\s*6px/);
  assert.match(css, /\.client-partner-logos img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100px;[^}]*object-fit:\s*contain/);
});
