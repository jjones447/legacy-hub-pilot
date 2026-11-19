// [pc2-claude-ct-2] Caregiver Sanctuary page update (requester, Nov 15 2026, ts 1794763820.351269).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../sanctuary.html', import.meta.url), 'utf8');
const main = page.match(/<main id="main">([\s\S]*?)<\/main>/)[1];
const text = main.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&rarr;/g, '→').replace(/\s+/g, ' ');

test('sections appear in the requested order with her copy', () => {
  const order = ['A Place for You, Too.', 'it’s easy for your own needs to get pushed aside.', 'Explore Programs & Events', 'Request Support',
    'Become a member', 'What Is Caregiver Sanctuary?', 'Learn About Our Model', 'Coming Soon', 'A Place to Call Your Own',
    '7828 W Appleton Avenue, Milwaukee, WI', 'we’re not open for visits just yet.', 'Stay Connected',
    'Sometimes you just need to talk to someone who gets it.', 'Explore the Support Group', 'Need a little time to yourself?', 'Explore Respite Services',
    'Making Events More Accessible for Family Caregivers', 'Bring Respite to Your Event', 'Caregiving can make it hard to find time for the things you enjoy.',
    'Explore the Community Series', 'Caregiver Wellness Passport', 'Learn What’s Coming', 'There are so many things you learn along the way',
    'Explore Education & Workshops', 'Upcoming Events', 'Our Community in Action', 'Bringing Caregiver Support Into Our Community',
    'Some partners help by sharing resources or displaying a Caregiver Sanctuary decal.', 'Community Partners Who Care', 'Explore Our Partners',
    'Helping Our Community Better Understand Dementia', 'Training is available to interested organizations, but it is not required for every Caregiver Sanctuary Partner.',
    'Learn About Our Training', 'Become a Caregiver Sanctuary Partner', 'You don’t have to provide caregiving services to make a difference in a caregiver’s life.'];
  const at = order.map(t => text.indexOf(t));
  at.forEach((p, i) => assert.ok(p >= 0, order[i]));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('links follow her instructions; nothing says the space is open or that every partner is trained', () => {
  for (const [label, href] of [['Explore Programs &amp; Events', 'programs-events.html'], ['Request Support', 'request-support.html'],
    ['Learn About Our Model', 'our-model.html'], ['Stay Connected', 'membership.html']]) {
    assert.match(main, new RegExp(`href="${href.replace('.', '\\.')}">${label}</a>`), label);
  }
  for (const [label, href] of [['Explore the Support Group', 'programs-events.html#support-group'], ['Explore Respite Services', 'drop-in-respite.html'],
    ['Bring Respite to Your Event', 'get-involved.html#partner'], ['Explore the Community Series', 'community-series.html'], ['Learn What’s Coming', 'wellness-passport.html'],
    ['Explore Education &amp; Workshops', 'events.html']]) {
    assert.ok(main.includes(`href="${href}">${label} &rarr;</a>`), label);
  }
  assert.match(main, /href="membership\.html">Become a member &rarr;<\/a>/, 'membership stays visible');
  assert.equal((main.match(/sanctuary-coming-soon">Coming Soon</g) || []).length, 2, 'physical space and Wellness Passport');
  assert.doesNotMatch(text, /Every Caregiver Sanctuary Partner completes|All Caregiver Sanctuary Partners complete|Our trained partners|Visit Us|Hours:/i);
  assert.match(page, /<link rel="stylesheet" href="sanctuary\.css\?v=[0-9a-f]{12}">/);
});
