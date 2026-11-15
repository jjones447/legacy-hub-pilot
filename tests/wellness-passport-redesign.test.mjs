// [pc2-claude-ct-2] Caregiver Wellness Passport redesign (requester draft, Nov 12 2026, thread 1794494849.192649).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../wellness-passport.html', import.meta.url), 'utf8');
const text = page.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the five sections carry the requested copy in order', () => {
  const order = [
    'Caregiver Wellness Passport',
    'Your Wellness. Your Journey. Your Pace.',
    'When you’re caring for someone else, your own needs can easily take a back seat.',
    'The Caregiver Wellness Passport was created to encourage family caregivers to make their own well-being a priority.',
    'Through everyday wellness activities, Legacy programs, and community experiences, caregivers can explore different areas of wellness, earn points, and work toward meaningful milestones and rewards.',
    'Because taking care of yourself matters, too.',
    'How the Wellness Passport Works',
    'every step is an opportunity to invest in yourself.',
    '01 | Explore Your Wellness',
    '02 | Earn Points',
    'Complete and log wellness activities to earn 10 points per activity.',
    '03 | Reach Milestones',
    'You can move through the Passport at your own pace.',
    'Discover Your Seven Wellness Pillars',
    'CONNECT Find your people.', 'RESTORE Make room to recharge.', 'MOVE Move in ways that work for you.',
    'NOURISH Give your body what it needs.', 'EXPLORE Try something new.',
    'LEARN Keep discovering and growing.', 'PREPARE Plan for your well-being.',
    'Your Wellness Journey, One Milestone at a Time',
    'ROOTED 50 Points Participate in activities across at least 3 wellness pillars. Reward: Legacy Welcome Gift',
    'GROWING 100 Points Participate in activities across at least 4 wellness pillars. Reward: Wellness Partner Reward',
    'THRIVING 150 Points Participate in activities across at least 6 wellness pillars. Reward: Premium Wellness Experience',
    'FLOURISHING 200 Points Participate in activities across all 7 wellness pillars. Reward: Eligibility to apply for a Wellness Grant',
    'Each completed and logged activity earns 10 points.',
    'Reaching the Flourishing milestone does not guarantee grant approval or funding.',
    'It’s Time to Make Room for You',
    'Start your journey, explore what wellness means to you, and celebrate the progress you make.',
  ];
  const positions = order.map(t => text.indexOf(t));
  positions.forEach((p, i) => assert.ok(p >= 0, order[i]));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.equal((page.match(/class="wp-pillar /g) || []).length, 7);
  assert.equal((page.match(/class="wp-milestone"/g) || []).length, 4);
});

test('both Start buttons open the existing membership process and no grant button is featured', () => {
  const ctas = page.match(/<a [^>]*>Start Your Wellness Journey<\/a>/g) || [];
  assert.equal(ctas.length, 2);
  ctas.forEach(a => assert.match(a, /data-action="open-membership"/));
  assert.match(page, /id="membershipModal"/);
  assert.doesNotMatch(page, /data-action="open-grant-apply"/);
  assert.match(page, /id="grantApplyModal"/, 'grant application machinery stays on the page, unfeatured');
});

test('the five-category outline and internal tracking language are gone', () => {
  assert.doesNotMatch(text, /Program Structure|five key areas|Engagement Tracking|Wellness Grant Eligibility|Caregiver Sanctuary Program Participation/);
  assert.match(page, /<link rel="stylesheet" href="wellness-passport\.css\?v=[0-9a-f]{12}">/);
});
