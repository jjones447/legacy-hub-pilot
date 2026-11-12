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

// ---- Community Series events by title convention (requester, Nov 12 thread 1794493253.041949)
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const renderSource = app.slice(app.indexOf('function publicEventTime('), app.indexOf("document.addEventListener('DOMContentLoaded', function()", app.indexOf('function publicEventTime(')));
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.textContent = ''; }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = c; }
}
const all = el => [el, ...el.children.flatMap(all)];
function grid(dataset) {
  const g = new El('div');
  Object.assign(g.dataset, dataset);
  const ctx = vm.createContext({ document: { createElement: t => new El(t), getElementById: () => g, querySelectorAll: () => [] }, Date, Intl, URL, console: { error() {} } });
  vm.runInContext(renderSource, ctx);
  return { g, ctx };
}
const now = new Date('2026-11-12T15:00:00Z');
const ev = (o) => ({ id: 'ev_x', title: 'X', type: 'other', starts_at: '2026-11-20 10:00', ends_at: '2026-11-20 12:00', location: 'Fictional cafe', capacity: 10, registered_count: 1, ...o });

test('the Community Series page lists only "Community Series" titled events, each with its own Register button', () => {
  assert.match(page, /id="liveEventsGrid" data-event-time-zone="America\/Chicago"\s+data-event-title-prefix="Community Series" data-event-badge="Community Series"/);
  const dataset = { eventTimeZone: 'America/Chicago', eventTitlePrefix: 'Community Series', eventBadge: 'Community Series', emptyText: 'none' };
  const { g, ctx } = grid(dataset);
  ctx.renderPublicEvents([
    ev({ id: 'ev_cs_coffee', title: 'Community Series — Coffee & Conversation' }),
    ev({ id: 'ev_respite', title: 'Drop-In Respite — November 19' }),
    ev({ id: 'ev_group', title: 'Virtual Support Group', type: 'support_group' }),
  ], g, now);
  const buttons = all(g).filter(n => n.tagName === 'button');
  assert.deepEqual(buttons.map(b => b.dataset.eventId), ['ev_cs_coffee']);
  assert.equal(buttons[0].dataset.action, 'open-register');
  assert.match(all(g).map(n => n.textContent).join(' '), /Community Series .*Community Series — Coffee & Conversation/s);
});

test('with no Community Series events the page says so plainly; the Events page default text is unchanged', () => {
  const custom = 'No Community Series gatherings are scheduled right now. Check back soon, or see all upcoming events.';
  assert.ok(page.includes(`data-empty-text="${custom}"`));
  const { g, ctx } = grid({ eventTimeZone: 'America/Chicago', eventTitlePrefix: 'Community Series', emptyText: custom });
  ctx.renderPublicEvents([ev({ title: 'Drop-In Respite — November 19' })], g, now);
  assert.equal(g.children.length, 1);
  assert.equal(g.children[0].textContent, custom);
  const plain = grid({ eventTimeZone: 'America/Chicago' });
  plain.ctx.renderPublicEvents([], plain.g, now);
  assert.match(plain.g.children[0].textContent, /^No upcoming published events/);
});

test('the Community Series registration modal is identical to the Events one', () => {
  const events = readFileSync(new URL('../events.html', import.meta.url), 'utf8');
  const modal = html => html.slice(html.indexOf('<!-- Registration modal -->'), html.indexOf('</form>', html.indexOf('<!-- Registration modal -->')));
  assert.ok(modal(page).includes('id="regForm" data-action="submit-register"'));
  assert.equal(modal(page), modal(events));
});
