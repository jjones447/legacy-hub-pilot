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

// Direct child element ids of the real summary grid, read from the actual portal.html markup.
function summaryGridChildren() {
  const start = html.indexOf('id="portalAccountSummary"');
  const body = html.slice(html.indexOf('>', start) + 1);
  const ids = [];
  let depth = 0;
  for (const tag of body.matchAll(/<(\/?)div\b([^>]*)>/g)) {
    if (tag[1]) { if (depth-- === 0) break; continue; }
    if (depth++ === 0) ids.push((tag[2].match(/\bid="([^"]+)"/) || [])[1]);
  }
  return ids;
}

test('summary preview is opt-in, resets on reload and keeps the real wellness card visible', () => {
  const h = ui();
  const listeners = {};
  let focused = 0;
  const cardIds = summaryGridChildren();
  assert.ok(cardIds.includes('portalWellnessTile'), 'wellness card sits directly in the summary grid');
  assert.ok(cardIds.length >= 6 && cardIds.every(Boolean));
  const sampleEnd = html.indexOf('</details>', html.indexOf('id="portalWellnessSample"'));
  assert.ok(sampleEnd < html.indexOf('id="portalAccountSummary"'), 'real cards are outside the sample disclosure');
  const cards = cardIds.map(id => ({ id, hidden: id !== 'portalWellnessTile' }));
  h.elements.portalWellnessSample = { open: true, addEventListener(type, callback) { listeners[type] = callback; } };
  h.elements.portalAccountSummary = { hidden: false, children: cards };
  h.elements.portalPreviewReturn = { addEventListener(type, callback) { listeners.return = callback; } };
  h.elements.portalPreviewToggle = { focus() { focused++; } };
  const visible = () => cards.filter(card => !card.hidden).map(card => card.id);
  const history = Object.freeze([Object.freeze({ created_at: '2026-10-01', score: 20 }), Object.freeze({ created_at: '2026-10-12', score: 30 })]);
  h.context.renderWellness({ history, due: false });
  const before = JSON.stringify(rows(h.elements.portalWellnessHistoryRows));
  h.context.initPortalSummaryPreview();
  assert.equal(h.elements.portalWellnessSample.open, false);
  assert.deepEqual(visible(), cardIds);
  h.elements.portalWellnessSample.open = true;
  listeners.toggle();
  assert.deepEqual(visible(), ['portalWellnessTile'], 'samples replace the other cards; real check-ins stay');
  assert.equal(h.elements.portalAccountSummary.hidden, false, 'the grid that holds the real wellness card is never hidden');
  listeners.return();
  assert.equal(h.elements.portalWellnessSample.open, false);
  assert.deepEqual(visible(), cardIds);
  assert.equal(focused, 1);
  assert.equal(JSON.stringify(rows(h.elements.portalWellnessHistoryRows)), before);
  assert.match(h.elements.portalWellnessTrend.children[0].attributes['aria-label'], /20, 30$/);
  assert.equal(h.calls.length, 0);
});

test('empty real history stays empty beside a separately labeled sample', async () => {
  const h = ui();
  await h.context.loadWellness();
  assert.equal(h.elements.portalWellnessHistoryRows.textContent, 'No saved check-ins yet.');
  assert.equal(h.elements.portalWellnessTrend.children.length, 0);
  assert.equal(h.elements.portalWellnessSampleTrend.children.length, 0, 'no fictional wellness scores');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], '/api/portal/wellness');
  assert.equal(h.calls[0][1].credentials, 'same-origin');
  assert.equal(h.calls[0][1].method, undefined, 'only the existing history GET');
});

test('failed history read clears old scores and never creates fictional health records', async () => {
  const h = ui({ ok: false });
  h.context.renderWellness({ history: [{ created_at: '2026-10-01', score: 99 }, { created_at: '2026-10-02', score: 95 }], due: false });
  await h.context.loadWellness();
  assert.equal(h.elements.portalWellnessSummary.textContent, 'Your wellness check-ins are not available right now.');
  assert.equal(h.elements.portalWellnessTrend.children.length, 0);
  assert.equal(rows(h.elements.portalWellnessHistoryRows).length, 0);
  assert.equal(h.elements.portalWellnessHistoryRows.textContent, 'Your saved history is not available right now.');
  assert.equal(h.elements.portalWellnessSampleTrend.children.length, 0, 'no fictional wellness scores');
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
  assert.match(sample, /preview adds no check-ins or scores/);
  assert.doesNotMatch(sample, /<form|<input|data-action=/);
  assert.match(sample, /id="portalPreviewReturn">Return to my records/);
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

test('card copy distinguishes account registrations, the public calendar/library and unbuilt features', () => {
  assert.match(html, /Events you registered for on the Events page, including Memory Socials, support group sessions/);
  assert.match(html, /Browse all events/);
  assert.match(html, /Guides, tools and trusted local help for caregivers in the shared Resource Hub\. This library is public, not a personalized saved list\./);
  assert.match(html, /Coming soon<\/span> Saving your favorite resources here/);
  assert.match(html, /Coming soon<\/span> Your past requests and their status will appear here/);
  assert.match(html, /Coming soon<\/span> Announcements, upcoming opportunities and member benefits/);
});

test('dashboard cards follow the requested order; wellness is a full-width card; grant and socials cards are gone', () => {
  const gridStart = html.indexOf('id="portalAccountSummary"');
  const sample = html.indexOf('id="portalWellnessSample"');
  assert.ok(gridStart > 0 && sample < gridStart);
  const grid = html.slice(gridStart, html.indexOf('</section>', gridStart));
  const order = ['My Profile &amp; Intake', 'My Support', 'My Events', 'My Wellness', 'My Resources', 'Sanctuary Updates &amp; Perks'];
  const at = order.map(label => grid.indexOf(label));
  assert.ok(at.every(i => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.doesNotMatch(html, /My Wellness Grant|My Memory Socials|Resource library|portalGrantStatus|portalSocialsCount/);
  assert.match(html, /class="panel m-0 portal-card portal-wellness-section" id="portalWellnessTile"/);
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(styles, /#dashView \.portal-card-grid > \.portal-wellness-section[^}]*grid-column: 1 \/ -1/);
  assert.match(styles, /#dashView #portalWellnessHistory > summary[^}]*16px/);
  assert.match(styles, /#dashView #portalWellnessHistoryRows ol[^}]*padding-inline-start: 24px/);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*#dashView \.portal-summary-grid[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});

test('whole-portal examples remain opt-in, fictional, outside actual records and have no write controls', () => {
  const match = html.match(/<details([^>]+)id="portalWellnessSample">([\s\S]*?)<\/details>/);
  assert.ok(match); assert.doesNotMatch(match[1], /\bopen(?:\s|=|$)/);
  assert.match(match[2], /Preview a filled-out portal \(sample data\)/);
  for (const area of ['profile', 'support', 'events', 'resources']) assert.match(match[2], new RegExp(`data-portal-sample="${area}"`));
  assert.doesNotMatch(match[2], /data-portal-sample="(?:grant|socials)"/);
  assert.match(match[2], /fictional illustrations, not your records/);
  assert.match(match[2], /Nothing here registers you or sends a request/);
  assert.doesNotMatch(match[2], /<form\b|<input\b|data-action=|href="(?:\/api|https?:)/);
  assert.doesNotMatch(match[2], /data-portal-sample="wellness"|portalWellnessSampleTrend|out of 100/);
  assert.equal((match[2].match(/Sample registration/g) || []).length, 3);
  for (const id of ['portalEventsList', 'portalProfileName', 'portalWellnessHistoryRows', 'portalWellnessForm']) assert.equal(match[2].includes(`id="${id}"`), false, id);
});
