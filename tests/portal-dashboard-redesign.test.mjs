// Caregiver Portal dashboard redesign (Legacy request, Oct 30). Synthetic DOM only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const wellness = app.slice(app.indexOf('let wellnessQuestions ='), app.indexOf('function openWellnessForm('));
const dashboard = app.slice(app.indexOf('function renderPortalData('), app.indexOf('/* ---------- Staff console:'));
const eventTime = app.slice(app.indexOf('function publicEventTime('), app.indexOf('function renderPublicEvents('));
const now = Date.parse('2026-10-30T15:00:00Z');

function ui({ search = '' } = {}) {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; this.hidden = false;
      this.classes = new Set(); this.classList = { toggle: (n, on) => on ? this.classes.add(n) : this.classes.delete(n), add: n => this.classes.add(n) }; }
    set textContent(v) { this.text = String(v); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(''); }
    set innerHTML(v) { this.html = v; this.children = []; this.text = ''; }
    setAttribute(k, v) { this.attributes[k] = v; }
    appendChild(c) { this.children.push(c); return c; }
  }
  const ids = ['portalWelcome', 'portalProfileName', 'portalProfileEmail', 'portalProfilePhone', 'portalMembershipStatus',
    'portalEventsList', 'portalHighlights', 'portalHighlightsList', 'portalWellnessSummary', 'portalWellnessBtn',
    'portalWellnessTrendHint', 'portalWellnessTrend', 'portalWellnessHistoryRows', 'loginView', 'dashView',
    'portalDesignPreview', 'portalLogoutBtn', 'portalWellnessSample'];
  const el = Object.fromEntries(ids.map(id => [id, new Element()]));
  el.portalDesignPreview.hidden = true; el.portalHighlights.hidden = true;
  const calls = [];
  const context = vm.createContext({
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
    Intl, URLSearchParams,
    window: { location: { search } },
    document: { getElementById: id => el[id], createElement: t => new Element(t), createTextNode: s => ({ textContent: s }),
      createElementNS: (_n, t) => new Element(t) },
    fetch: async (...a) => { calls.push(a); throw new Error('no network in this test'); },
  });
  vm.runInContext(eventTime + '\n' + wellness + '\n' + dashboard, context);
  return { context, el, calls };
}
const texts = list => list.children.map(c => c.textContent);

test('welcome uses the first name, with a warm fallback', () => {
  const h = ui();
  h.context.renderPortalData({ profile: { first_name: ' Ana ' }, events: [], grants: [] });
  assert.equal(h.el.portalWelcome.textContent, 'Welcome to Your Sanctuary, Ana!');
  h.context.renderPortalData({ profile: {}, events: [], grants: [] });
  assert.equal(h.el.portalWelcome.textContent, 'Welcome to Your Sanctuary!');
  assert.match(html, /Your space to stay connected, find support, and make time for your well-being\./);
});

test('profile shows the real read-only account fields as text (no HTML sink)', () => {
  const h = ui();
  h.context.renderPortalData({ profile: { first_name: '<img src=x>', last_name: 'Doe', email: 'a@example.invalid', phone: '', sanctuary_member: 1 }, events: [], grants: [] });
  assert.equal(h.el.portalProfileName.textContent, '<img src=x> Doe');
  assert.equal(h.el.portalProfileName.html, undefined);
  assert.equal(h.el.portalProfileEmail.textContent, 'a@example.invalid');
  assert.equal(h.el.portalProfilePhone.textContent, '—');
  assert.match(h.el.portalMembershipStatus.html, /Sanctuary member/);
});

test('My Events groups real registrations into upcoming (soonest first) and past, with type labels', () => {
  const h = ui();
  h.context.renderPortalData({ profile: {}, grants: [], events: [
    { title: 'Later Social', type: 'memory_social', starts_at: '2026-11-12 14:00', registration_status: 'registered' },
    { title: 'Past Workshop', type: 'caregiver_event', starts_at: '2026-10-01 18:00', registration_status: 'attended' },
    { title: 'Soon Group', type: 'support_group', starts_at: '2026-11-04 17:00', registration_status: 'registered', location: 'Online' },
  ] });
  const groups = h.el.portalEventsList.children;
  assert.deepEqual(groups.map(g => g.children[0].textContent), ['Upcoming', 'Past']);
  assert.deepEqual(groups[0].children.slice(1).map(i => i.children[1].children[0].textContent), ['Soon Group', 'Later Social']);
  assert.match(groups[0].children[1].textContent, /Support Group · 2026-11-04 17:00 · Online/);
  assert.deepEqual(groups[1].children.slice(1).map(i => i.children[1].children[0].textContent), ['Past Workshop']);
});

test('highlights show only real account information and hide when there is none', () => {
  const h = ui();
  h.context.renderPortalData({ profile: {}, grants: [], events: [] });
  assert.equal(h.el.portalHighlights.hidden, true);
  h.context.renderPortalData({ profile: {}, grants: [], events: [
    { title: 'Soon Group', type: 'support_group', starts_at: '2026-11-04 17:00', registration_status: 'registered' }] });
  assert.equal(h.el.portalHighlights.hidden, false);
  assert.deepEqual(texts(h.el.portalHighlightsList), ['📅Your next event: Soon Group · 2026-11-04 17:00']);
  h.context.renderWellness({ history: [], due: true });
  assert.equal(h.el.portalHighlightsList.children.length, 2);
  assert.match(texts(h.el.portalHighlightsList)[1], /time for a quick wellness check-in/);
  h.context.renderWellness({ history: [], due: false });
  h.context.renderPortalData({ profile: {}, grants: [], events: [] });
  assert.equal(h.el.portalHighlights.hidden, true);
  assert.doesNotMatch(html, /intake (?:is )?(?:complete|incomplete)|announcement:|perk:/i, 'no invented intake status, announcements or perks');
});

test('the next-event highlight is the first future REGISTERED event, even after an earlier attended or no-show entry', () => {
  const h = ui();
  h.context.renderPortalData({ profile: {}, grants: [], events: [
    { title: 'Earlier Attended', type: 'workshop', starts_at: '2026-11-02 10:00', registration_status: 'attended' },
    { title: 'Earlier No-show', type: 'workshop', starts_at: '2026-11-03 10:00', registration_status: 'no_show' },
    { title: 'Later Registered', type: 'support_group', starts_at: '2026-11-11 17:00', registration_status: 'registered' }] });
  assert.equal(h.el.portalHighlights.hidden, false);
  assert.deepEqual(texts(h.el.portalHighlightsList), ['📅Your next event: Later Registered · 2026-11-11 17:00']);
  assert.equal(h.el.portalEventsList.children[0].children.length, 4, 'the full upcoming list still shows all three entries');
  h.context.renderPortalData({ profile: {}, grants: [], events: [
    { title: 'Only Attended', type: 'workshop', starts_at: '2026-11-02 10:00', registration_status: 'attended' }] });
  assert.equal(h.el.portalHighlights.hidden, true);
});

test('design preview (?preview=sample) shows the layout with labeled fictional data and makes no requests', () => {
  const h = ui({ search: '?preview=sample' });
  assert.equal(h.context.portalDesignPreviewRequested(), true);
  assert.equal(h.context.initPortalDesignPreview(), true);
  assert.equal(h.el.dashView.style.display, 'block');
  assert.equal(h.el.loginView.style.display, 'none');
  assert.equal(h.el.portalDesignPreview.hidden, false);
  assert.equal(h.el.portalLogoutBtn.hidden, true);
  assert.equal(h.el.portalWellnessSample.hidden, true);
  assert.ok(h.el.portalWellnessBtn.classes.has('d-none'), 'no check-in can be submitted');
  assert.equal(h.el.portalWelcome.textContent, 'Welcome to Your Sanctuary, Jordan!');
  assert.equal(h.el.portalWellnessTrend.children.length, 0, 'no fictional wellness scores');
  assert.equal(h.calls.length, 0);
  assert.equal(ui({ search: '' }).context.portalDesignPreviewRequested(), false);
  assert.match(html, /Design preview with sample information\.<\/strong> This is not a real account/);
});
