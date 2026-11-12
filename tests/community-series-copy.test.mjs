// [pc2-claude-ct-2] Community Series page copy (requester rewrite, Nov 12 2026, thread 1794493253.041949).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../community-series.html', import.meta.url), 'utf8');

test('Community Series uses the requested headings, copy and buttons in order', () => {
  const order = [
    '<h1 class="hero-title-clamp">Caregiver Sanctuary Community Series</h1>',
    '<p class="lede">Connection. Community. Time for You.</p>',
    'Caregiving can be isolating.',
    'Our Caregiver Sanctuary Community Series was created to change that.',
    'Created with dementia family caregivers in mind',
    '<h2>What to Expect</h2>',
    'From conversations over coffee to creative activities and wellness experiences',
    '<h2>Join an Upcoming Gathering</h2>',
    '<a class="btn btn-coral" href="events.html">View Upcoming Events</a>',
    '<h2>Partner With Us</h2>',
    'We believe supporting caregivers is a community effort.',
    'Interested in hosting a gathering or partnering with us?',
    '<a class="btn btn-coral" href="get-involved.html#partner">Become a Caregiver Sanctuary Partner</a>',
  ];
  const positions = order.map(text => page.indexOf(text));
  positions.forEach((p, i) => assert.ok(p > 0, order[i]));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.doesNotMatch(page, /Schedule coming|Registration links coming|What the series is/);
});

test('the duplicate Community Calendar is gone everywhere (requester, Nov 12 thread 1794493560.124909)', async () => {
  const { readdirSync } = await import('node:fs');
  const root = new URL('../', import.meta.url);
  for (const name of readdirSync(root).filter(n => n.endsWith('.html'))) {
    const html = readFileSync(new URL(name, root), 'utf8');
    assert.doesNotMatch(html, /Community Calendar|programs-events\.html#calendar|href="#calendar"|id="calendar"/, name);
  }
  const sanctuary = readFileSync(new URL('sanctuary.html', root), 'utf8');
  assert.match(sanctuary, /<h4 class="fs-18-mb-14">Upcoming Events<\/h4>/, 'Upcoming Events stays');
});
