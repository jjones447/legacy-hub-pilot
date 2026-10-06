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
    /<h1[^>]*>A place for caregivers to find support, respite, wellness and community\.<\/h1>/
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

test('home page renders Community Wellness Partners block with verbatim copy and sanctuary link', () => {
  const html = file('index.html');
  assert.match(html, /<span class="eyebrow"[^>]*>Community Wellness Partners<\/span>/);
  assert.match(html, /<h2 class="mb-14"[^>]*>Building a Caregiver-Supportive Community<\/h2>/);
  assert.match(
    html,
    /<p class="mb-28"[^>]*>Caregiver support shouldn't stop at home or within traditional care settings\. Through our Community Wellness Partners, we work with local businesses and organizations to create welcoming spaces where caregivers can connect, prioritize their well-being, and feel supported in their community\.<\/p>/
  );
  assert.match(
    html,
    /<a href="sanctuary\.html" class="btn btn-coral"[^>]*>Learn About Community Wellness Partners<\/a>/
  );
});
