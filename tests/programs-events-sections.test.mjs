// [pc2-claude-ct-2] Programs & Events: Drop-In Respite, Event Respite, Family Education (requester, Nov 15 2026, ts 1794765216.599549).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../programs-events.html', import.meta.url), 'utf8');
const section = id => page.slice(page.indexOf(`id="${id}"`), page.indexOf('</section>', page.indexOf(`id="${id}"`)));

test('the three sections use her copy, keep alternating backgrounds and drop "Content coming"', () => {
  assert.doesNotMatch(page, /Content coming|badge-phase2/);
  const drop = section('drop-in');
  assert.match(drop, /Sometimes, you just need a few hours to yourself\./);
  assert.match(drop, /compassionate, non-medical supervision, we provide peace of mind while you rest, run errands, attend appointments, or simply take time for yourself\./);
  assert.match(drop, /<a class="btn btn-outline" href="drop-in-respite\.html">Explore Drop-In Respite<\/a>/);
  const event = section('event-respite');
  assert.match(page, /<section class="section-sand pe-program" id="event-respite">/);
  assert.match(event, /bring respite services directly to community events/);
  assert.match(event, /Whether you’re hosting a conference, workshop, or community gathering/);
  assert.match(event, /<a class="btn btn-outline" href="get-involved\.html#partner">Partner With Us<\/a>/);
  const ed = section('family-ed');
  for (const t of ['moments when you’re just not sure what to do next.', 'Our educational offerings include:', 'Care at Home with Lauryn', 'Dementia Live',
    'We also offer workshops throughout the year']) assert.ok(ed.includes(t), t);
  assert.match(ed, /<a class="btn btn-outline" href="events\.html">Explore Education &amp; Workshops<\/a>/);
  assert.match(page, /<link rel="stylesheet" href="programs-events\.css\?v=[0-9a-f]{12}">/);
});
