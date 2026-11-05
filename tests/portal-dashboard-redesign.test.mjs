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
  const ids = ['portalWelcome', 'portalWelcomeSub', 'portalProfileName', 'portalProfileEmail', 'portalProfilePhone',
    'portalMembershipStatus', 'portalProfileMembershipStatus',
    'portalEventsList', 'portalEventsFilter', 'portalEventsFilterRow', 'portalEventsHeading', 'portalEventsIntro',
    'portalResourcesHeading', 'portalResourcesIntro', 'portalResourcesComingSoon', 'portalWellnessHeading',
    'portalHighlights', 'portalHighlightsList', 'portalWellnessSummary', 'portalWellnessBtn',
    'portalWellnessTrendHint', 'portalWellnessTrend', 'portalWellnessHistory', 'portalWellnessHistoryRows',
    'loginView', 'dashView', 'portalLogoutBtn', 'portalQaSampleBanner',
    'portalProfileCard', 'portalSupportCard', 'portalUpdatesCard',
    'portalWellnessSample', 'portalGrantCard', 'portalSocialsCard', 'portalAccountSummary',
    'portalGrantStatus', 'portalGrantRequestedFor', 'portalGrantAward',
    'portalSocialsCount', 'portalSocialsLastVisit', 'portalSocialsNext',
    'portalEventsSocialsSummary', 'portalQaSocialsCount', 'portalQaSocialsLastVisit', 'portalQaSocialsNext',
    'portalUpdatesGrantSummary', 'portalQaGrantStatus', 'portalQaGrantRequestedFor', 'portalQaGrantAward'];
  const el = Object.fromEntries(ids.map(id => [id, new Element()]));
  el.portalHighlights.hidden = true; el.portalQaSampleBanner.hidden = true;
  el.portalWelcomeSub.hidden = true; el.portalProfileCard.hidden = true;
  el.portalSupportCard.hidden = true; el.portalUpdatesCard.hidden = true;
  el.portalEventsFilterRow.hidden = true; el.portalEventsSocialsSummary.hidden = true; el.portalResourcesComingSoon.hidden = true;
  el.portalEventsFilter.value = 'all';
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

test('welcome uses the warm sanctuary greeting only for the qa_samples identity and preserves #332 Welcome back for ordinary caregivers', () => {
  const h = ui();
  h.context.renderPortalData({ profile: { first_name: 'Ana' }, events: [], grants: [] });
  assert.equal(h.el.portalWelcome.textContent, 'Welcome back, Ana');
  assert.equal(h.el.portalWelcomeSub.hidden, true);
  h.context.renderPortalData({ profile: {}, events: [], grants: [] });
  assert.equal(h.el.portalWelcome.textContent, 'Welcome back, Member');

  h.context.renderPortalData({ qa_samples: true, profile: { first_name: ' Ana ' }, events: [], grants: [] });
  assert.equal(h.el.portalWelcome.textContent, 'Welcome to Your Sanctuary, Ana!');
  assert.equal(h.el.portalWelcomeSub.hidden, false);
  h.context.renderPortalData({ qa_samples: true, profile: {}, events: [], grants: [] });
  assert.equal(h.el.portalWelcome.textContent, 'Welcome to Your Sanctuary!');
  assert.match(html, /Your space to stay connected, find support, and make time for your well-being\./);
});

test('profile shows the real read-only account fields as text (no HTML sink) and preserves Non-member badge for ordinary caregivers', () => {
  const h = ui();
  h.context.renderPortalData({ profile: { first_name: '<img src=x>', last_name: 'Doe', email: 'a@example.invalid', phone: '', sanctuary_member: 0 }, events: [], grants: [] });
  assert.equal(h.el.portalProfileName.textContent, '<img src=x> Doe');
  assert.equal(h.el.portalProfileName.html, undefined);
  assert.equal(h.el.portalProfileEmail.textContent, 'a@example.invalid');
  assert.equal(h.el.portalProfilePhone.textContent, '—');
  assert.match(h.el.portalMembershipStatus.html, /Non-member/);
  assert.equal(h.el.portalProfileCard.hidden, true);

  h.context.renderPortalData({ qa_samples: true, profile: { first_name: '<img src=x>', last_name: 'Doe', email: 'a@example.invalid', phone: '', sanctuary_member: 1 }, events: [], grants: [] });
  assert.equal(h.el.portalProfileCard.hidden, false);
  assert.match(h.el.portalMembershipStatus.html, /Sanctuary member/);
  assert.match(h.el.portalProfileMembershipStatus.html, /Sanctuary member/);
});

test('My Events groups registrations into upcoming and past with type labels for qa_samples, and keeps flat #332 list for ordinary caregivers', () => {
  const h = ui();
  const realEvents = [
    { title: 'Later Social', type: 'memory_social', starts_at: '2026-11-12 14:00', registration_status: 'registered' },
    { title: 'Past Workshop', type: 'caregiver_event', starts_at: '2026-10-01 18:00', registration_status: 'attended' },
    { title: 'Soon Group', type: 'support_group', starts_at: '2026-11-04 17:00', registration_status: 'registered', location: 'Online' },
  ];
  // Ordinary caregiver: flat #332 list in original order, no type prefix, no Upcoming/Past group headings
  h.context.renderPortalData({ profile: {}, grants: [], events: realEvents });
  assert.equal(h.el.portalEventsFilterRow.hidden, true);
  assert.equal(h.el.portalEventsList.children.length, 3);
  assert.deepEqual(h.el.portalEventsList.children.map(item => item.children[1].children[0].textContent), ['Later Social', 'Past Workshop', 'Soon Group']);
  assert.equal(h.el.portalEventsList.children[2].children[1].children[3].textContent, '2026-11-04 17:00 · Online');

  // QA sample identity: grouped Upcoming/Past with type prefix (filtering to 'real' to inspect real event ordering)
  h.context.renderPortalData({ qa_samples: true, profile: {}, grants: [], events: realEvents });
  assert.equal(h.el.portalEventsFilterRow.hidden, false);
  h.context.filterPortalEvents('real');
  const groups = h.el.portalEventsList.children;
  assert.deepEqual(groups.map(g => g.children[0].textContent), ['Upcoming', 'Past']);
  assert.deepEqual(groups[0].children.slice(1).map(i => i.children[1].children[0].textContent), ['Soon Group', 'Later Social']);
  assert.match(groups[0].children[1].textContent, /Support Group · 2026-11-04 17:00 · Online/);
  assert.deepEqual(groups[1].children.slice(1).map(i => i.children[1].children[0].textContent), ['Past Workshop']);
});

test('highlights appear only when qa_samples is active and hide for ordinary caregivers or when empty', () => {
  const h = ui();
  // Ordinary caregiver never sees highlights strip even with upcoming events and due wellness
  h.context.renderPortalData({ profile: {}, grants: [], events: [
    { title: 'Soon Group', type: 'support_group', starts_at: '2026-11-04 17:00', registration_status: 'registered' }] });
  h.context.renderWellness({ history: [], due: true });
  assert.equal(h.el.portalHighlights.hidden, true);

  // QA sample caregiver sees highlights; when filtered to 'real' with no events and due=false, highlights hide
  h.context.renderWellness({ history: [], due: false });
  h.context.renderPortalData({ qa_samples: true, profile: {}, grants: [], events: [] });
  h.context.filterPortalEvents('real');
  assert.equal(h.el.portalHighlights.hidden, true);

  h.context.renderPortalData({ qa_samples: true, profile: {}, grants: [], events: [
    { title: 'Soon Group', type: 'support_group', starts_at: '2026-11-04 17:00', registration_status: 'registered' }] });
  h.context.filterPortalEvents('real');
  assert.equal(h.el.portalHighlights.hidden, false);
  assert.deepEqual(texts(h.el.portalHighlightsList), ['📅Your next event: Soon Group · 2026-11-04 17:00']);
  h.context.renderWellness({ history: [], due: true });
  assert.equal(h.el.portalHighlightsList.children.length, 2);
  assert.match(texts(h.el.portalHighlightsList)[1], /time for a quick wellness check-in/);
  assert.doesNotMatch(html, /intake (?:is )?(?:complete|incomplete)|announcement:|perk:/i, 'no invented intake status, announcements or perks');
});

test('the next-event highlight is the first future REGISTERED event, even after an earlier attended or no-show entry', () => {
  const h = ui();
  h.context.renderPortalData({ qa_samples: true, profile: {}, grants: [], events: [
    { title: 'Earlier Attended', type: 'workshop', starts_at: '2026-11-02 10:00', registration_status: 'attended' },
    { title: 'Earlier No-show', type: 'workshop', starts_at: '2026-11-03 10:00', registration_status: 'no_show' },
    { title: 'Later Registered', type: 'support_group', starts_at: '2026-11-11 17:00', registration_status: 'registered' }] });
  h.context.filterPortalEvents('real');
  assert.equal(h.el.portalHighlights.hidden, false);
  assert.deepEqual(texts(h.el.portalHighlightsList), ['📅Your next event: Later Registered · 2026-11-11 17:00']);
  assert.equal(h.el.portalEventsList.children[0].children.length, 4, 'the full upcoming list still shows all three entries');
  h.context.renderPortalData({ qa_samples: true, profile: {}, grants: [], events: [
    { title: 'Only Attended', type: 'workshop', starts_at: '2026-11-02 10:00', registration_status: 'attended' }] });
  h.context.filterPortalEvents('real');
  assert.equal(h.el.portalHighlights.hidden, true);
});

test('query-string design preview (?preview=sample) is removed from production source and cannot unlock a fictional dashboard', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const h = ui({ search: '?preview=sample' });
  assert.equal(typeof h.context.portalDesignPreviewRequested, 'undefined');
  assert.equal(typeof h.context.initPortalDesignPreview, 'undefined');
  assert.doesNotMatch(html, /portalDesignPreview|Design preview with sample information/);
  assert.doesNotMatch(css, /portal-design-preview/);
  assert.doesNotMatch(app, /portalDesignPreviewRequested|initPortalDesignPreview/);
});

test('real grant status and Memory Socials summary remain visible in both ordinary #332 layout and the qa_samples 6-card layout', () => {
  const h = ui();
  // Ordinary caregiver (#332 layout): standalone #portalGrantCard and #portalSocialsCard are visible, while #portalEventsSocialsSummary and #portalUpdatesCard are hidden
  h.context.renderPortalData({
    profile: { first_name: 'Maria', sanctuary_member: 1 },
    grants: [{ status: 'awarded', requested_for: 'Respite weekend', amount: '$500', care_package: 'Self-Care Box' }],
    events: [
      { title: 'Past Social', type: 'memory_social', starts_at: '2026-10-10 14:00', registration_status: 'attended' },
      { title: 'Upcoming Social', type: 'memory_social', starts_at: '2026-11-12 14:00', registration_status: 'registered' }
    ]
  });
  assert.equal(h.el.portalGrantCard.hidden, false);
  assert.equal(h.el.portalSocialsCard.hidden, false);
  assert.equal(h.el.portalEventsSocialsSummary.hidden, true);
  assert.equal(h.el.portalUpdatesCard.hidden, true);
  assert.equal(h.el.portalGrantStatus.textContent, 'awarded');
  assert.equal(h.el.portalGrantRequestedFor.textContent, 'Respite weekend');
  assert.equal(h.el.portalGrantAward.textContent, 'Awarded: $500 (Self-Care Box)');
  assert.equal(h.el.portalSocialsCount.textContent, '1 socials');
  assert.equal(h.el.portalSocialsLastVisit.textContent, '2026-10-10');
  assert.equal(h.el.portalSocialsNext.textContent, 'Upcoming Social · 2026-11-12');

  // Named sample identity (qa_samples: true): #portalEventsSocialsSummary inside My Events and #portalUpdatesGrantSummary inside Sanctuary Updates & Perks are visible with the real values
  h.context.renderPortalData({
    qa_samples: true,
    profile: { first_name: 'Jacob', sanctuary_member: 1 },
    grants: [{ status: 'awarded', requested_for: 'Respite weekend', amount: '$500', care_package: 'Self-Care Box' }],
    events: [
      { title: 'Past Social', type: 'memory_social', starts_at: '2026-10-10 14:00', registration_status: 'attended' },
      { title: 'Upcoming Social', type: 'memory_social', starts_at: '2026-11-12 14:00', registration_status: 'registered' }
    ]
  });
  assert.equal(h.el.portalGrantCard.hidden, true);
  assert.equal(h.el.portalSocialsCard.hidden, true);
  assert.equal(h.el.portalEventsSocialsSummary.hidden, false);
  assert.equal(h.el.portalUpdatesCard.hidden, false);
  assert.equal(h.el.portalUpdatesGrantSummary.hidden, false);
  assert.equal(h.el.portalQaGrantStatus.textContent, 'awarded');
  assert.equal(h.el.portalQaGrantRequestedFor.textContent, 'Respite weekend');
  assert.equal(h.el.portalQaGrantAward.textContent, 'Awarded: $500 (Self-Care Box)');
  assert.equal(h.el.portalQaSocialsCount.textContent, '1 socials');
  assert.equal(h.el.portalQaSocialsLastVisit.textContent, '2026-10-10');
  assert.equal(h.el.portalQaSocialsNext.textContent, 'Upcoming Social · 2026-11-12');
});
