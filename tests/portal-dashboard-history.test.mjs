// Synthetic DOM and in-memory fetch only. No provider, service, D1 or browser runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const wellness = app.slice(app.indexOf('let wellnessQuestions ='), app.indexOf('function openWellnessForm('));
const dashboard = app.slice(app.indexOf('function renderPortalData('), app.indexOf('/* ---------- Staff console:'));
const eventTime = app.slice(app.indexOf('function publicEventTime('), app.indexOf('function renderPublicEvents('));
const now = Date.parse('2026-10-13T14:00:00Z');

function ui(reply = { ok: true, history: [], questions: [], due: false }) {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; this.classes = new Set();
      this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) }; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text || ''; }
    set innerHTML(value) { this.html = value; this.children = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    appendChild(child) { this.children.push(child); return child; }
  }
  const ids = ['portalWellnessSummary', 'portalWellnessBtn', 'portalWellnessTrendHint', 'portalWellnessTrend',
    'portalWellnessHistoryRows', 'portalWellnessSampleTrend', 'portalWellnessSampleRows',
    'portalSocialsCount', 'portalSocialsLastVisit', 'portalSocialsNext',
    'portalGrantStatus', 'portalGrantRequestedFor', 'portalGrantAward'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const calls = [];
  const context = vm.createContext({ Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    document: { getElementById: id => elements[id], createElement: tag => new Element(tag),
      createElementNS: (_ns, tag) => new Element(tag) },
    fetch: async (...args) => { calls.push(args); return { ok: reply.ok, json: async () => reply }; },
    localStorage: { setItem() { throw new Error('must not store sample health data'); } }
  });
  vm.runInContext(eventTime + '\n' + wellness + '\n' + dashboard, context);
  return { context, elements, calls };
}
const rows = element => element.children[0]?.children.map(row => row.textContent) || [];

test('sample uses the existing chart renderer without changing saved history or making requests', () => {
  const h = ui();
  const history = Object.freeze([Object.freeze({ created_at: '2026-10-01 12:00:00', score: 20 }),
    Object.freeze({ created_at: '2026-10-12 12:00:00', score: 30 })]);
  h.context.renderWellness({ history, due: false });
  h.context.renderSampleWellness();
  h.context.renderSampleWellness();
  assert.deepEqual(rows(h.elements.portalWellnessHistoryRows), ['2026-10-01 — 20 out of 100', '2026-10-12 — 30 out of 100']);
  assert.match(h.elements.portalWellnessTrend.children[0].attributes['aria-label'], /20, 30$/);
  const sample = h.elements.portalWellnessSampleTrend.children[0];
  assert.match(sample.attributes['aria-label'], /^SAMPLE DATA, not your saved check-ins/);
  assert.equal(h.elements.portalWellnessSampleTrend.children.length, 1);
  assert.equal(rows(h.elements.portalWellnessSampleRows).length, 5);
  assert.doesNotMatch(h.elements.portalWellnessSummary.textContent, /sample|42|56|68|72/i);
  assert.equal(history.length, 2);
  assert.equal(h.calls.length, 0, 'sample/history rendering cannot fetch or save');
});

test('empty real history stays empty beside a separately labeled sample', async () => {
  const h = ui();
  await h.context.loadWellness();
  assert.equal(h.elements.portalWellnessHistoryRows.textContent, 'No saved check-ins yet.');
  assert.equal(h.elements.portalWellnessTrend.children.length, 0);
  assert.equal(h.elements.portalWellnessSampleTrend.children.length, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], '/api/portal/wellness');
  assert.equal(h.calls[0][1].credentials, 'same-origin');
  assert.equal(h.calls[0][1].method, undefined, 'only the existing history GET');
});

test('sample can illustrate the UI on a failed history read without inventing saved health records', async () => {
  const h = ui({ ok: false });
  h.context.renderWellness({ history: [{ created_at: '2026-10-01', score: 99 }, { created_at: '2026-10-02', score: 95 }], due: false });
  await h.context.loadWellness();
  assert.equal(h.elements.portalWellnessSummary.textContent, 'Your wellness check-ins are not available right now.');
  assert.equal(h.elements.portalWellnessTrend.children.length, 0);
  assert.equal(rows(h.elements.portalWellnessHistoryRows).length, 0);
  assert.equal(h.elements.portalWellnessHistoryRows.textContent, 'Your saved history is not available right now.');
  assert.equal(h.elements.portalWellnessSampleTrend.children.length, 1);
  assert.equal(h.calls.length, 1);
});

test('history dates/scores are text nodes rather than a health-data HTML injection sink', () => {
  const h = ui();
  h.context.renderWellnessHistory(h.elements.portalWellnessHistoryRows,
    [{ created_at: '<img src=x>', score: '<svg onload=alert(1)>' }], 'Empty');
  const row = h.elements.portalWellnessHistoryRows.children[0].children[0];
  assert.equal(row.tag, 'li');
  assert.match(row.textContent, /<svg onload=/);
  assert.equal(row.html, undefined);
});

test('sample disclosure is caregiver-visible, separate from the real check-in form, and has no submit control', () => {
  assert.match(html, /View my saved check-in history/);
  assert.match(html, /latest 24 saved check-ins, oldest to newest/);
  const sample = html.match(/<details[^>]+id="portalWellnessSample">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(sample);
  assert.match(sample, /SAMPLE DATA/);
  assert.match(sample, /not your check-ins.*never saved to your health record/);
  assert.doesNotMatch(sample, /<form|<input|<button|data-action=/);
});

test('next social ignores past, invalid and nonregistered entries; real account data stays unchanged', () => {
  const h = ui();
  const events = Object.freeze([
    { type: 'memory_social', registration_status: 'registered', starts_at: '2026-10-12T14:00:00Z', title: 'Past' },
    { type: 'memory_social', registration_status: 'registered', starts_at: 'not-a-date', title: 'Invalid' },
    { type: 'memory_social', registration_status: 'registered', starts_at: null, title: 'Missing' },
    { type: 'memory_social', registration_status: 'registered', starts_at: '2026-10-14T15:00:00+01:00', title: 'First future' },
    { type: 'memory_social', registration_status: 'registered', starts_at: '2026-10-14T14:30:00Z', title: 'Later future' },
    { type: 'memory_social', registration_status: 'attended', starts_at: '2025-01-01T14:00:00Z', title: 'Prior year' },
    { type: 'memory_social', registration_status: 'attended', starts_at: '2026-01-01T14:00:00Z', title: 'This year' },
    { type: 'memory_social', registration_status: 'attended', starts_at: 'bad-date', title: 'Unknown visit date' },
    { type: 'wellness', registration_status: 'registered', starts_at: '2026-10-13T15:00:00Z', title: 'Not a social' }
  ].map(Object.freeze));
  const before = JSON.stringify(events);
  h.context.renderPortalData({ profile: {}, events, grants: [] });
  assert.equal(h.elements.portalSocialsCount.textContent, '3 socials');
  assert.equal(h.elements.portalSocialsLastVisit.textContent, '2026-01-01');
  assert.equal(h.elements.portalSocialsNext.textContent, 'First future · 2026-10-14');
  assert.equal(JSON.stringify(events), before);
});

test('next social is empty when none of the account registrations has a valid future date', () => {
  const h = ui();
  h.context.renderPortalData({ profile: {}, grants: [], events: [
    { type: 'memory_social', registration_status: 'registered', starts_at: '2024-01-01' },
    { type: 'memory_social', registration_status: 'registered', starts_at: '' }
  ] });
  assert.equal(h.elements.portalSocialsNext.textContent, '—');
  assert.equal(h.elements.portalSocialsLastVisit.textContent, '—');
});

test('next social shares public calendar timezone/invalid-date handling rather than rolling impossible dates', () => {
  const h = ui();
  h.context.renderPortalData({ profile: {}, grants: [], events: [
    { type: 'memory_social', registration_status: 'registered', starts_at: '2027-02-31T14:00:00Z', title: 'Impossible calendar date' },
    { type: 'memory_social', registration_status: 'registered', starts_at: '2027-03-14 02:30:00', title: 'DST gap' },
    { type: 'memory_social', registration_status: 'registered', starts_at: '2026-10-13 09:30:00', title: 'Chicago future' }
  ] });
  assert.equal(h.elements.portalSocialsNext.textContent, 'Chicago future · 2026-10-13');
});

test('tile copy distinguishes account registrations, public calendar/library and all-time attendance', () => {
  assert.match(html, /Your registrations.*public calendar/);
  assert.match(html, /Attended \(all time\)/);
  assert.doesNotMatch(html, /Attended \(2026\)/);
  assert.match(html, /library is public, not a personalized saved list/);
});
