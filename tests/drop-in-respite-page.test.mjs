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
const PLANNED = ['2026-11-19', '2026-12-17', '2027-01-21', '2027-02-18'];
function setup() {
  const grid = new Element('div');
  Object.assign(grid.dataset, { eventTimeZone: 'America/Chicago', eventTitlePrefix: 'Drop-In Respite', eventBadge: 'Drop-In Respite', keepWhenEmpty: '' });
  for (const date of PLANNED) grid.appendChild(Object.assign(new Element('div'), { textContent: `planned ${date}`, dataset: { plannedDate: date } }));
  const context = vm.createContext({ document: { createElement: tag => new Element(tag), getElementById: () => grid, querySelectorAll: () => [] }, Date, Intl, URL, console: { error() {} } });
  vm.runInContext(renderSource, context);
  return { grid, context };
}
const session = (date, overrides = {}) => event({ id: `ev_respite_${date}`, title: `Drop-In Respite — ${date}`, starts_at: `${date} 10:00`, ends_at: `${date} 14:00`, ...overrides });
// What each slot of the grid now shows: "planned <date>" or the live event id behind its Register button.
const slots = grid => grid.children.map(el => el.dataset.plannedDate ? `planned ${el.dataset.plannedDate}` : descendants(el).find(item => item.tagName === 'button')?.dataset.eventId);
const descendants = el => [el, ...el.children.flatMap(descendants)];
const text = el => descendants(el).map(item => item.textContent).join(' ');

test('the header has the heading and lede with no same-page buttons; details carry the time and full address', () => {
  assert.match(page, /<h1>Drop-In Respite Program<\/h1>/, 'requester, Nov 4: no FREE in the header');
  // Requester, Nov 12 (ts 1794514035.669429): buttons only for new pages, so no "How it works" jump.
  assert.match(page, /<p class="lede">A Break for You\. Meaningful Moments for Your Loved One\.<\/p>\s*<\/div>/);
  assert.doesNotMatch(page, /href="#how-it-works" class="btn/);
  // Requester, Nov 3 19:54Z: no FREE / Every Third Thursday / 10–2 bubbles in the header.
  assert.doesNotMatch(page, /respite-facts/);
  assert.match(page, /<dt>When<\/dt><dd>Every Third Thursday of the Month<\/dd>\s*<dt>Time<\/dt><dd>10:00 AM &ndash; 2:00 PM<\/dd>/);
  assert.match(page, /<address>3132 N\. Dr\. Martin Luther King Jr\. Drive<br>Milwaukee, WI 53212<\/address>/);
  assert.match(page, /Ebenezer Ministry &amp; Family Worship Center/);
  assert.doesNotMatch(page, /href="#sessions" class="btn/, 'no button that only scrolls to the sessions');
  assert.match(page, /data-playback-rate="0\.75"/, 'keeps the slower header video');
});

test('the requested sections are present in order, and Memory Social and grant references are gone', () => {
  const order = ['Drop-In Respite Program', 'Program Details', 'What Makes Our Respite Different?', 'Upcoming Respite Sessions', 'How It Works', 'Bring Respite to Your Faith Community'];
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
  for (const iso of PLANNED) assert.match(grid, new RegExp(`<div class="card event-card" data-planned-date="${iso}">`));
  assert.equal((grid.match(/href="about\.html#contact">Contact us to register<\/a>/g) || []).length, 4);
  assert.doesNotMatch(grid, /data-action="open-register"/);
  assert.match(page, /data-event-title-prefix="Drop-In Respite" data-event-badge="Drop-In Respite"\s+data-keep-when-empty/);
});

test('the shared registration modal is identical on Events and Drop-In Respite', () => {
  const modal = html => html.slice(html.indexOf('<!-- Registration modal -->'), html.indexOf('</form>', html.indexOf('<!-- Registration modal -->')));
  assert.ok(modal(page).includes('id="regForm" data-action="submit-register"'));
  assert.equal(modal(page), modal(events));
});

test('each published session replaces only its own planned date: none, one, some, all (review 5757140409)', () => {
  const cases = [
    [[], ['planned 2026-11-19', 'planned 2026-12-17', 'planned 2027-01-21', 'planned 2027-02-18']],
    [['2026-11-19'], ['ev_respite_2026-11-19', 'planned 2026-12-17', 'planned 2027-01-21', 'planned 2027-02-18']],
    [['2026-12-17', '2027-02-18'], ['planned 2026-11-19', 'ev_respite_2026-12-17', 'planned 2027-01-21', 'ev_respite_2027-02-18']],
    [PLANNED, PLANNED.map(date => `ev_respite_${date}`)],
  ];
  for (const [published, expected] of cases) {
    const { grid, context } = setup();
    context.renderPublicEvents(published.map(date => session(date)), grid, now);
    assert.deepEqual(slots(grid), expected, `published: ${published.join(', ') || 'none'}`);
  }
  // A live card keeps the real event identity and the program badge.
  const { grid, context } = setup();
  context.renderPublicEvents([session('2026-11-19')], grid, now);
  const live = grid.children[0];
  const register = descendants(live).find(item => item.tagName === 'button');
  assert.equal(register.dataset.action, 'open-register');
  assert.equal(register.dataset.eventId, 'ev_respite_2026-11-19');
  assert.match(text(live), /Drop-In Respite .*Drop-In Respite — 2026-11-19/s);
});

test('other programs are ignored; an unplanned respite date joins in order; passed planned dates drop out', () => {
  const { grid, context } = setup();
  context.renderPublicEvents([
    event({ id: 'ev_other', title: 'Virtual Support Group', type: 'support_group', starts_at: '2026-12-02 17:00', ends_at: '2026-12-02 18:00' }),
    session('2027-03-18'),
    session('2027-01-21'),
  ], grid, now);
  assert.deepEqual(slots(grid), ['planned 2026-11-19', 'planned 2026-12-17', 'ev_respite_2027-01-21', 'planned 2027-02-18', 'ev_respite_2027-03-18']);
  assert.doesNotMatch(text(grid), /Virtual Support Group/);

  const later = setup();
  later.context.renderPublicEvents([session('2027-01-21')], later.grid, new Date('2026-12-20T15:00:00Z'));
  assert.deepEqual(slots(later.grid), ['ev_respite_2027-01-21', 'planned 2027-02-18']);
});

test('malformed or past data never removes a future planned date; the Events page still empties', () => {
  for (const data of [[event({ title: 'Wellness Grant Info Session', type: 'wellness' })], [session('2026-10-15')], [session('2026-11-19', { starts_at: 'not a date' })]]) {
    const { grid, context } = setup();
    context.renderPublicEvents(data, grid, now);
    assert.deepEqual(slots(grid), PLANNED.map(date => `planned ${date}`));
  }
  const { grid, context } = setup();
  delete grid.dataset.keepWhenEmpty; delete grid.dataset.eventTitlePrefix;
  context.renderPublicEvents([], grid, now);
  assert.match(text(grid), /No upcoming published events/);
});

test('an offset start that rolls over midnight UTC replaces the planned card for the day it shows (41 review of #355)', () => {
  const { grid, context } = setup();
  // 2026-12-18T02:00:00Z is Thursday, December 17 at 8 PM in Chicago.
  const late = session('2026-12-17', { id: 'ev_respite_offset', starts_at: '2026-12-18T02:00:00Z', ends_at: '2026-12-18T03:00:00Z' });
  assert.equal(context.renderPublicEvents([late], grid, now), true);
  assert.deepEqual(slots(grid), ['planned 2026-11-19', 'ev_respite_offset', 'planned 2027-01-21', 'planned 2027-02-18']);
  assert.match(text(grid), /Thursday, December 17, 2026 · 8:00 PM – 9:00 PM/);
});
