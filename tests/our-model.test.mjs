// [pc2-claude-ct-2] Our Model page and links (requester, Nov 15 2026, ts 1794761678.248889).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const page = read('our-model.html');
const text = page.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('Our Model carries the requested sections in order', () => {
  const order = ['The Caregiver Sanctuary Model', 'Caregiver Wellness, Rooted in Community', 'We use the power of community to care for the caregiver.',
    'How Our Model Works', 'Different Needs. One Connected Approach.', 'Family Caregiver', 'Respite & Relief', 'Education & Guidance',
    'Connection & Peer Support', 'Wellness & Restoration', 'Community Partnerships', 'These aren’t separate pieces of our work.',
    'The Caregiver Journey', 'Meeting Caregivers Where They Are', '01 Connect', '02 Listen', '03 Support', '04 Stay Connected', '05 Learn & Improve',
    'Why Community Matters', 'Caregiving Happens Beyond the Healthcare Setting', 'That’s why community matters.',
    'Partnerships That Make a Difference', 'Supporting Caregivers Is Something We Can Do Together', 'Healthcare Partnerships', 'Workplace Partnerships',
    'Community & Faith Partnerships', 'Explore Partnership Opportunities', 'Learning From Experience', 'What We’ve Learned Is Shaping What’s Next',
    'meaningful, accessible, and sustainable.', 'There’s a Place for You in This Community', 'Find Caregiver Support', 'Partner With Legacy'];
  const at = order.map(t => text.indexOf(t));
  at.forEach((p, i) => assert.ok(p >= 0, order[i]));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.equal((page.match(/class="om-area om-area-\d"/g) || []).length, 5);
  assert.equal((page.match(/class="om-step"/g) || []).length, 5);
  assert.match(page, /<a href="programs\.html" class="btn btn-coral">Find Caregiver Support<\/a>/);
  assert.equal((page.match(/href="get-involved\.html#partner"/g) || []).length >= 2, true);
  assert.doesNotMatch(text, /evidence-based|scientifically validated/i);
  assert.match(page, /<link rel="stylesheet" href="our-model\.css\?v=[0-9a-f]{12}">/);
});

test('About menu lists Our Model right after Overview; home and Sanctuary link to it', () => {
  assert.match(read('templates/_header.html.j2'), /<a href="about\.html">Overview<\/a>\n\s*<a href="our-model\.html">Our Model<\/a>/);
  const home = read('index.html');
  const model = home.indexOf('Caregiver Support Rooted in Community');
  assert.ok(model > 0 && model < home.indexOf('home-support-heading'), 'model section comes before How We Support Caregivers');
  assert.match(home, /<a href="our-model\.html" class="btn btn-coral">Explore Our Model<\/a>/);
  const sanctuary = read('sanctuary.html');
  assert.match(sanctuary, /Our services are connected through the Caregiver Sanctuary Model, bringing together respite, education, wellness, peer support, and community relationships to care for the caregiver\./);
  assert.match(sanctuary, /<a class="more" href="our-model\.html">Learn About Our Model &rarr;<\/a>/);
});
