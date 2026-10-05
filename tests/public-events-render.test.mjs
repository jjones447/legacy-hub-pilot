import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequestGet as getEvents } from '../functions/api/events.js';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const renderSource = source.slice(source.indexOf('function publicEventTime('), source.indexOf("document.addEventListener('DOMContentLoaded', function()", source.indexOf('function publicEventTime(')));
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.textContent = ''; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
}
const now = new Date('2026-10-05T15:00:00Z');
const event = (overrides = {}) => ({ id: 'ev_synthetic', title: 'Synthetic event', type: 'wellness', starts_at: '2026-10-06 10:00', ends_at: '2026-10-06 11:00', location: 'Synthetic room', capacity: 12, registered_count: 3, ...overrides });
function setup(fetchImpl) {
  const grid = new Element('div');
  grid.dataset.eventTimeZone = 'America/Chicago';
  grid.appendChild(Object.assign(new Element('p'), { textContent: 'Schedule pending' }));
  const context = vm.createContext({ document: { createElement: tag => new Element(tag), getElementById: () => grid, querySelectorAll: () => [] }, fetch: fetchImpl, Date, Intl, console: { error() {} } });
  vm.runInContext(renderSource, context);
  return { grid, context };
}
function descendants(element) { return [element, ...element.children.flatMap(descendants)]; }
function button(grid) { return descendants(grid).find(item => item.tagName === 'button'); }
function text(grid) { return descendants(grid).map(item => item.textContent).join(' '); }

test('current published API data builds real registration controls using its exact identity', () => {
  const { grid, context } = setup();
  assert.equal(context.renderPublicEvents([event({ id: 'ev_actual_api_identity' })], grid, now), true);
  assert.match(text(grid), /Synthetic event.*2026-10-06 10:00 \(America\/Chicago\).*Synthetic room/s);
  assert.match(text(grid), /3 registered · capacity 12/);
  assert.equal(button(grid).dataset.eventId, 'ev_actual_api_identity');
  assert.equal(button(grid).dataset.action, 'open-register');
  assert.equal(button(grid).dataset.eventTitle, 'Synthetic event');
  assert.equal(button(grid).disabled, false);
});

test('full and already-started events never expose a registration action', () => {
  for (const overrides of [{ registered_count: 12 }, { starts_at: '2026-10-05 09:00', ends_at: '2026-10-05 11:00' }]) {
    const { grid, context } = setup();
    context.renderPublicEvents([event(overrides)], grid, now);
    assert.equal(button(grid).disabled, true);
    assert.equal(button(grid).dataset.action, undefined);
  }
});

test('uncapped published events preserve counts and open registration', () => {
  const { grid, context } = setup();
  context.renderPublicEvents([event({ capacity: null, ends_at: null, registered_count: 20 })], grid, now);
  assert.equal(button(grid).disabled, false);
  assert.match(text(grid), /20 registered/);
  assert.doesNotMatch(text(grid), /capacity/);
});

test('expired seed dates and unpublished rows are never advertised as upcoming', () => {
  const { grid, context } = setup();
  context.renderPublicEvents([
    event({ starts_at: '2026-07-08 17:00', ends_at: '2026-07-08 18:00' }),
    event({ publish_state: 'draft' }), event({ publish_state: 'archived' })
  ], grid, now);
  assert.equal(button(grid), undefined);
  assert.match(text(grid), /No upcoming published events/);
});

test('malformed or ambiguous rows are not confirmed events or a false empty-calendar claim', () => {
  const { grid, context } = setup();
  context.renderPublicEvents([
    event({ starts_at: '2027-02-30 10:00' }), event({ starts_at: '2027-02-30T10:00:00Z' }),
    event({ starts_at: '2026-10-06T24:00:00Z' }),
    event({ starts_at: 'not a date' }), event({ ends_at: '2026-10-06 09:00' }),
    event({ capacity: 0 }), event({ registered_count: -1 }), event({ registered_count: null }),
    event({ capacity: '12' }), event({ registered_count: true }),
    event({ id: '' }), event({ title: '' })
  ], grid, now);
  assert.equal(button(grid), undefined);
  assert.match(text(grid), /Schedule pending/);
});

test('API-derived title and location are text, never interpreted as HTML', () => {
  const { grid, context } = setup();
  const payload = '<img src=x onerror=alert(1)>';
  context.renderPublicEvents([event({ title: payload, location: payload })], grid, now);
  assert.match(text(grid), /<img src=x onerror=alert\(1\)>/);
  assert.equal(descendants(grid).some(item => item.tagName === 'img'), false);
  assert.doesNotMatch(renderSource, /innerHTML|insertAdjacentHTML/);
});

test('wall schedules are independent of visitor zone, explicit offsets retain their instant', () => {
  const { context } = setup();
  assert.equal(context.publicEventTime('2026-10-05 10:30', now, 'America/Chicago').future, true);
  assert.equal(context.publicEventTime('2026-10-05 09:30', now, 'America/Chicago').future, false);
  assert.equal(context.publicEventTime('2026-10-05T11:00:00-05:00', now, 'America/Chicago').future, true);
  assert.equal(context.publicEventTime('2026-10-05T14:00:00Z', now, 'America/Chicago').future, false);
});

test('DST missing/repeated wall hours require explicit offsets, valid DST dates resolve', () => {
  const { context } = setup();
  assert.equal(context.publicEventTime('2027-03-14 02:30', now, 'America/Chicago'), null);
  assert.equal(context.publicEventTime('2026-11-01 01:30', now, 'America/Chicago'), null);
  assert.equal(context.publicEventTime('2027-03-14 03:30', now, 'America/Chicago').instant, Date.parse('2027-03-14T08:30:00Z'));
  assert.equal(context.publicEventTime('2026-11-01T01:30:00-05:00', now, 'America/Chicago').instant, Date.parse('2026-11-01T06:30:00Z'));
});

test('invalid time zone and nonarray responses leave the existing pending DOM untouched', () => {
  const { grid, context } = setup();
  assert.equal(context.renderPublicEvents({}, grid, now), false);
  grid.dataset.eventTimeZone = 'Unknown/Zone';
  assert.throws(() => context.renderPublicEvents([event()], grid, now), /time zone/i);
  assert.equal(text(grid).trim(), 'Schedule pending');
});

test('network, HTTP, JSON and API errors preserve pending fallback', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('offline'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new Error('invalid json'); } }),
    async () => ({ ok: true, json: async () => ({ ok: false }) }),
    async () => ({ ok: true, json: async () => ({ ok: true, events: {} }) })
  ]) {
    const { grid, context } = setup(fetchImpl);
    context.loadLiveEvents();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(text(grid).trim(), 'Schedule pending');
  }
});

test('successful API load replaces pending cards without duplicate registration actions', async () => {
  let calls = 0;
  const { grid, context } = setup(async url => {
    assert.equal(url, '/api/events');
    calls++;
    return { ok: true, json: async () => ({ ok: true, events: [event({ starts_at: '2040-10-06 10:00', ends_at: null })] }) };
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    context.loadLiveEvents();
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(calls, 2);
  assert.equal(descendants(grid).filter(item => item.tagName === 'button').length, 1);
  assert.doesNotMatch(text(grid), /Schedule pending/);
});

test('Events template provides a configurable API target without changing the homepage count path', () => {
  const template = readFileSync(new URL('../templates/events.html.j2', import.meta.url), 'utf8');
  assert.match(template, /id="liveEventsGrid" data-event-time-zone="America\/Chicago" aria-live="polite"/);
  assert.match(renderSource, /if \(grid\)/);
  assert.match(renderSource, /b\.dataset\.eventId === e\.id/);
});

test('existing published-events endpoint feeds the renderer and registration-modal identity', async () => {
  const published = event({ id: 'ev_mock_published_123' });
  const response = await getEvents({ env: { LEGACY_DB: { prepare(sql) {
    assert.match(sql, /WHERE e\.publish_state = 'published'/);
    return { all: async () => ({ results: [published] }) };
  } } } });
  const data = await response.json();
  const { grid, context } = setup();
  context.renderPublicEvents(data.events, grid, now);
  const action = button(grid);
  const form = { dataset: {} };
  const title = {};
  const modal = { classList: { add(value) { assert.equal(value, 'open'); } } };
  context.document.getElementById = id => ({ registerModal: modal, regTitle: title, regForm: form })[id];
  context.setFormState = (target, state) => { assert.equal(target, form); assert.equal(state, 'idle'); };
  vm.runInContext(source.slice(source.indexOf('function openRegister('), source.indexOf('function closeRegister(')), context);
  context.openRegister(action.dataset.eventTitle, action.dataset.eventId);
  assert.equal(form.dataset.eventId, published.id);
  assert.equal(title.textContent, 'Register — ' + published.title);
});
