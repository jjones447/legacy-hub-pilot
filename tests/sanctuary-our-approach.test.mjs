// [pc2-claude-ct-2] Sanctuary "Our Approach" copy (requester, Nov 3 20:05Z) replaces "The idea".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../sanctuary.html', import.meta.url), 'utf8');
const section = page.slice(page.indexOf('<section id="what">'), page.indexOf('</section>', page.indexOf('<section id="what">')));

test('the Sanctuary "what" section uses the requester\'s Our Approach copy verbatim', () => {
  assert.match(section, /<span class="eyebrow">Our Approach<\/span><h2>What Is Caregiver Sanctuary\?<\/h2>/);
  // Requester, Nov 15 (ts 1794763820.351269): new Our Approach copy and a Learn About Our Model button.
  for (const line of [
    'Caring for a loved one with dementia can bring a lot of changes, questions, and responsibilities. And somewhere in the middle of all that, it’s easy to forget about yourself.',
    'Caregiver Sanctuary was created with caregivers in mind.',
    'We bring together respite, education, wellness opportunities, and people who understand what you’re experiencing.',
    'Whatever brings you here, we want you to feel welcome and know you don’t have to figure everything out alone.',
  ]) assert.ok(section.includes(line), line);
  assert.match(section, /<a class="btn btn-coral" href="our-model\.html">Learn About Our Model<\/a>/);
  assert.doesNotMatch(section, /The idea|Join free as a caregiver member|approach to caregiver support: by partnering/);
  // Requester, Nov 12 (ts 1794514035.669429): no buttons that only scroll the same page.
  assert.doesNotMatch(section, /Explore today's Sanctuary programs/);
});
