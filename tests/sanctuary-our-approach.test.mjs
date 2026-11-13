// [pc2-claude-ct-2] Sanctuary "Our Approach" copy (requester, Nov 3 20:05Z) replaces "The idea".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../sanctuary.html', import.meta.url), 'utf8');
const section = page.slice(page.indexOf('<section id="what">'), page.indexOf('</section>', page.indexOf('<section id="what">')));

test('the Sanctuary "what" section uses the requester\'s Our Approach copy verbatim', () => {
  assert.match(section, /<span class="eyebrow">Our Approach<\/span><h2>What Is Caregiver Sanctuary\?<\/h2>/);
  for (const line of [
    "Caregiving doesn't happen in isolation, and neither should support.",
    "Caregiver Sanctuary is Legacy's approach to creating a community where caregivers feel supported, connected, and valued. Through respite services, caregiver education, wellness experiences, and partnerships with local businesses and community organizations, we're making support more accessible in the places where caregivers live, work, and connect.",
    'Our goal is simple: to create more opportunities for caregivers to care for themselves while caring for someone they love.',
    'Because caregivers deserve care, too.',
  ]) assert.ok(section.includes(line), line);
  assert.doesNotMatch(section, /The idea|Join free as a caregiver member|approach to caregiver support: by partnering/);
  // Requester, Nov 12 (ts 1794514035.669429): no buttons that only scroll the same page.
  assert.doesNotMatch(section, /Explore today's Sanctuary programs/);
});
