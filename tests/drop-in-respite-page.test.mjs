// [pc2-claude-ct-2] Drop-In Respite rebuild (requester spec, Nov 3): page content, the live
// session list filtered to Drop-In Respite events, and the planned-date fallback. Source + vm only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const page = readFileSync(new URL('../drop-in-respite.html', import.meta.url), 'utf8');
const events = readFileSync(new URL('../events.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const renderSource = source.slice(source.indexOf('function publicEventTime('), source.indexOf("document.addEventListener('DOMContentLoaded', function()", source.indexOf('function publicEventTime(')));

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.textContent = ''; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
}
const now = new Date('2026-11-04T15:00:00Z');
const event = (overrides = {}) => ({ id: 'ev_synthetic', title: 'Drop-In Respite — November 19', type: 'other', starts_at: '2026-11-19 10:00', ends_at: '2026-11-19 14:00', location: 'Synthetic hall', capacity: 10, registered_count: 2, ...overrides });
function setup(data) {
  const grid = new Element('div');
  Object.assign(grid.dataset, { eventTimeZone: 'America/Chicago', eventTitlePrefix: 'Drop-In Respite', eventBadge: 'Drop-In Respite', keepWhenEmpty: '' });
  const planned = Object.assign(new Element('div'), { textContent: 'planned date' });
  grid.appendChild(planned);
  const context = vm.createContext({ document: { createElement: tag => new Element(tag), getElementById: () => grid, querySelectorAll: () => [] }, Date, Intl, URL, console: { error() {} } });
  vm.runInContext(renderSource, context);
  return { grid, planned, context };
}
const descendants = el => [el, ...el.children.flatMap(descendants)];
const text = el => descendants(el).map(item => item.textContent).join(' ');

test('the page leads with FREE, every third Thursday, 10 AM–2 PM and the full Ebenezer address', () => {
  assert.match(page, /<h1>FREE Drop-In Respite<\/h1>/);
  assert.match(page, /<p class="lede">A Break for You\. Meaningful Moments for Your Loved One\.<\/p>/);
  assert.match(page, /<ul class="respite-facts"[^>]*>\s*<li><strong>FREE<\/strong><\/li>\s*<li><strong>Every Third Thursday<\/strong><\/li>\s*<li><strong>10 AM&ndash;2 PM<\/strong><\/li>/);
  assert.match(page, /<address>3132 N\. Dr\. Martin Luther King Jr\. Drive<br>Milwaukee, WI 53212<\/address>/);
  assert.match(page, /Ebenezer Ministry &amp; Family Worship Center/);
  assert.equal((page.match(/>Register for Free Respite</g) || []).length, 2);
  assert.match(page, /data-playback-rate="0\.4"/, 'keeps the slower header video');
});

test('the requested sections are present in order, and Memory Social and grant references are gone', () => {
  const order = ['FREE Drop-In Respite', 'Program Details', 'What Makes Our Respite Different?', 'Upcoming Respite Sessions', 'How It Works', 'Bring Respite to Your Faith Community'];
  const positions = order.map(heading => page.indexOf(heading));
  assert.ok(positions.every(p => p > 0), 'every section exists');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'sections follow the requested order');
  for (const area of ['Meaningful Engagement', 'Person-Centered Care', 'Compassionate Support', 'Time for Caregivers']) assert.match(page, new RegExp(`<h3>${area}</h3>`));
  for (const step of ['Register', 'Connect With Our Team', 'Take Some Time for Yourself']) assert.match(page, new RegExp(`<h3>${step}</h3>`));
  assert.match(page, /<em>Advance registration is requested\. Participation is based on individual support needs and available capacity\.<\/em>/);
  assert.match(page, /<a href="get-involved\.html#partner" class="btn btn-coral">Interested in Bringing Respite to Your Faith Community\?<\/a>/);
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
  assert.doesNotMatch(main, /Memory Social|[Gg]rant/);
});

test('the four planned dates show with a contact route, never a Register button that cannot save', () => {
  const grid = page.slice(page.indexOf('id="liveEventsGrid"'), page.indexOf('id="how-it-works"'));
  for (const d of ['November 19, 2026', 'December 17, 2026', 'January 21, 2027', 'February 18, 2027']) assert.match(grid, new RegExp(`<h3 class="fs-19-m-8-0-4">Thursday, ${d}</h3>`));
  assert.equal((grid.match(/href="about\.html#contact">Contact us to register<\/a>/g) || []).length, 4);
  assert.doesNotMatch(grid, /data-action="open-register"/);
  assert.match(page, /data-event-title-prefix="Drop-In Respite" data-event-badge="Drop-In Respite"\s+data-keep-when-empty/);
});

test('the shared registration modal is identical on Events and Drop-In Respite', () => {
  const modal = html => html.slice(html.indexOf('<!-- Registration modal -->'), html.indexOf('</form>', html.indexOf('<!-- Registration modal -->')));
  assert.ok(modal(page).includes('id="regForm" data-action="submit-register"'));
  assert.equal(modal(page), modal(events));
});

test('live sessions: only Drop-In Respite events replace the planned dates, under the program badge', () => {
  const { grid, context } = setup();
  context.renderPublicEvents([event({ id: 'ev_respite_nov' }), event({ id: 'ev_other', title: 'Virtual Support Group', type: 'support_group' })], grid, now);
  const buttons = descendants(grid).filter(item => item.tagName === 'button');
  assert.deepEqual(buttons.map(b => b.dataset.eventId), ['ev_respite_nov']);
  assert.equal(buttons[0].dataset.action, 'open-register');
  assert.match(text(grid), /Drop-In Respite .*Drop-In Respite — November 19/s);
  assert.doesNotMatch(text(grid), /Virtual Support Group|planned date/);
});

test('with no matching published session the planned dates stay; the Events page still empties', () => {
  for (const data of [[], [event({ title: 'Wellness Grant Info Session', type: 'wellness' })], [event({ starts_at: '2026-10-15 10:00', ends_at: '2026-10-15 14:00' })]]) {
    const { grid, planned, context } = setup();
    context.renderPublicEvents(data, grid, now);
    assert.deepEqual(grid.children, [planned]);
  }
  const { grid, context } = setup();
  delete grid.dataset.keepWhenEmpty; delete grid.dataset.eventTitlePrefix;
  context.renderPublicEvents([], grid, now);
  assert.match(text(grid), /No upcoming published events/);
});
