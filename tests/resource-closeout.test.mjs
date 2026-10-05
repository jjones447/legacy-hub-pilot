import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('unavailable caregiver resources have visible pending text, not dead download/read actions', () => {
  const html = read('caregiver-tools.html');
  assert.doesNotMatch(html, /data-action="demo-resource-link"/);
  assert.equal((html.match(/Resource link pending/g) || []).length, 5);
  assert.doesNotMatch(html, /<a[^>]+href="#"[^>]*>\s*(?:Read guide|Watch|Download PDF|Open guide)/);
});

test('crisis page does not advertise an unverified hotline or unavailable emergency guide', () => {
  const html = read('crisis-help.html');
  assert.doesNotMatch(html, /Caregiver Support Hotline|Call \/ details|data-action="demo-resource-link"/);
  assert.match(html, /Guide link pending/);
  assert.match(html, /href="tel:988"/);
  assert.match(html, /href="tel:911"/);
  assert.match(html, /href="https:\/\/www\.alz\.org\/help-support"/);
});

test('unconfirmed sample dates and registration counts are not presented as current events', () => {
  for (const page of ['index.html', 'events.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /class="month">Jul|class="month">Aug|18 registered|8 registered|9 registered|6 registered/);
    assert.match(html, /Schedule pending/);
  }
  assert.doesNotMatch(read('events.html'), /data-action="open-register"/);
});

test('request support points directly to real crisis contacts, not a fictitious caregiver hotline', () => {
  const html = read('request-support.html');
  assert.doesNotMatch(html, /for the caregiver support hotline/);
  assert.match(html, /href="crisis-help.html">Crisis &amp; Emergency Help/);
});

test('templates preserve confirmed-event registration and do not disable the live event API', () => {
  const events = read('templates/events.html.j2');
  assert.match(events, /ev\.schedule_confirmed \| default\(false\)/);
  assert.match(events, /data-action="open-register"/);
  assert.match(events, /data-event-id="\{\{ ev\.id/);
  assert.match(read('app.js'), /fetch\('\/api\/events'\)/);
});
