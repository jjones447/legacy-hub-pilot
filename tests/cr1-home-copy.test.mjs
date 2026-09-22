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
    /<h1>A place for caregivers to find support, respite, wellness and community\.<\/h1>/
  );
  assert.match(
    html,
    /<p class="lede">We support family caregivers through respite, wellness, education, resources and meaningful community connection, with specialized support for families navigating dementia and other care needs\.<\/p>/
  );
});

test('home page carries client two-line headline and journey panel copy verbatim', () => {
  const html = file('index.html');
  assert.match(
    html,
    /<h2>Caregiving can change every part of life\.<br>You shouldn't have to navigate it alone\.<\/h2>/
  );
  assert.match(
    html,
    /<p>Caring for someone living with dementia can change every part of life\. As needs evolve, caregivers often find themselves navigating new roles, responsibilities, and decisions while trying to care for themselves, too\. Caregiver Sanctuary provides respite, wellness, practical support, and community to help caregivers feel supported throughout the journey\.<\/p>/
  );
});

test('home page renders HOW WE SUPPORT CAREGIVERS panel with three titled tiles and secondary line', () => {
  const html = file('index.html');
  assert.match(html, /<h2>HOW WE SUPPORT CAREGIVERS<\/h2>/);

  // Assert card grid contains the three tiles with exact titles and no body copy
  assert.match(
    html,
    /<div class="card-grid">\s*<div class="card">\s*<h3>Wellness<\/h3>\s*<\/div>\s*<div class="card">\s*<h3>Respite<\/h3>\s*<\/div>\s*<div class="card">\s*<h3>Community<\/h3>\s*<\/div>\s*<\/div>/
  );

  // Assert secondary line renders
  assert.match(
    html,
    /<p class="mt-32">Plus education, practical resources and connections to trusted support\.<\/p>/
  );
});

test('home page renders Community Wellness Partners block with verbatim copy and sanctuary link', () => {
  const html = file('index.html');
  assert.match(html, /<span class="eyebrow">Community Wellness Partners<\/span>/);
  assert.match(html, /<h2 class="mb-14">Building a Caregiver-Supportive Community<\/h2>/);
  assert.match(
    html,
    /<p class="mb-28">Caregiver support shouldn't stop at home or within traditional care settings\. Through our Community Wellness Partners, we work with local businesses and organizations to create welcoming spaces where caregivers can connect, prioritize their well-being, and feel supported in their community\.<\/p>/
  );
  assert.match(
    html,
    /<a href="sanctuary\.html" class="btn btn-coral">Learn About Community Wellness Partners<\/a>/
  );
});
