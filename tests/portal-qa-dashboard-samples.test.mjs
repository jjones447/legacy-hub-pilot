// Caregiver Portal staging QA dashboard sample source increment (PhaseOne D2 acceptance).
// In-memory SQLite + synthetic DOM only. No network, provider, mail or deployment side effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet } from '../functions/api/portal/[[path]].js';

const APP_JS = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const PORTAL_HTML = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');

const QA_ID = '00000000-0000-4000-8000-000000000054';
const QA_EMAIL = 'qa-caregiver-54@example.test';
const OTHER_ID = '00000000-0000-4000-8000-000000000099';
const OTHER_EMAIL = 'second-caregiver@example.test';
const SECRET = 'fictional-qa-dashboard-sample-secret';
const FIXED_NOW = Date.parse('2026-11-04T15:00:00Z');

function makePortalCookie(id, mode = 'preview', expiry = Date.now() + 60_000) {
  const payload = `${id}:${expiry}`;
  const prefix = mode === 'preview' ? `preview-qa:${QA_ID}:${QA_EMAIL}:` : '';
  const signature = createHmac('sha256', SECRET).update(`${prefix}session:${payload}`).digest('hex');
  return `portal_session=${encodeURIComponent(`${payload}:${signature}`)}`;
}

function makePortalDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0001_init', '0003_grant_award', '0005_portal_login']) {
    sqlite.exec(readFileSync(new URL(`../schema/${name}.sql`, import.meta.url), 'utf8'));
  }
  const prep = sql => {
    const bound = params => ({
      sql,
      params,
      async first() { return sqlite.prepare(sql).get(...params) ?? null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...params) }; },
      async run() {
        const result = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: result.changes } };
      }
    });
    return { ...bound([]), bind: (...params) => bound(params) };
  };
  return {
    sqlite,
    LEGACY_DB: {
      prepare: prep,
      async batch(items) {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const results = items.map(item => {
            const rows = sqlite.prepare(item.sql).all(...item.params);
            return { success: true, results: rows, meta: { changes: sqlite.prepare('SELECT changes() n').get().n } };
          });
          sqlite.exec('COMMIT');
          return results;
        } catch (err) {
          sqlite.exec('ROLLBACK');
          throw err;
        }
      }
    }
  };
}

function createPortalDashboardUi() {
  class Element {
    constructor(tag = 'div') {
      this.tag = tag;
      this.children = [];
      this.attributes = {};
      this.style = {};
      this.hidden = false;
      this.open = false;
      this.value = '';
      this.disabled = false;
      this.listeners = {};
      this.classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(n => this.classes.add(n)),
        remove: (...names) => names.forEach(n => this.classes.delete(n)),
        contains: n => this.classes.has(n),
        toggle: (n, force) => {
          const on = force === undefined ? !this.classes.has(n) : Boolean(force);
          if (on) this.classes.add(n);
          else this.classes.delete(n);
          return on;
        }
      };
    }
    set textContent(v) {
      this.text = String(v ?? '');
      this.children = [];
    }
    get textContent() {
      return (this.text || '') + this.children.map(c => c.textContent).join('');
    }
    set innerHTML(v) {
      this.html = String(v ?? '');
      this.children = [];
      this.text = '';
    }
    get innerHTML() {
      return this.html || '';
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    }
    getAttribute(k) {
      return this.attributes[k] ?? null;
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    }
    reset() {}
  }

  const ids = [
    'loginView', 'dashView', 'portalDesignPreview', 'portalLogoutBtn',
    'portalWelcome', 'portalProfileName', 'portalProfileEmail', 'portalProfilePhone', 'portalMembershipStatus',
    'portalQaSampleBanner', 'portalProfileSampleNote', 'portalResourcesSampleNote', 'portalUpdatesSampleNote',
    'portalHighlights', 'portalHighlightsList',
    'portalEventsList', 'portalEventsFilter', 'portalEventsFilterRow',
    'portalSupportHistory', 'portalSupportHistoryRows', 'portalSupportFilter', 'portalSupportFilterRow',
    'portalSupportBtn', 'portalSupportForm', 'portalSupportType', 'portalSupportUrgency',
    'portalSupportContactPref', 'portalSupportEmail', 'portalSupportPhone', 'portalSupportDetail',
    'portalSupportSubmitBtn', 'portalSupportCancelBtn', 'portalSupportMsg',
    'portalWellnessSummary', 'portalWellnessBtn', 'portalWellnessTrendHint', 'portalWellnessTrend',
    'portalWellnessHistory', 'portalWellnessHistoryRows', 'portalWellnessForm', 'portalWellnessMsg'
  ];
  const el = Object.fromEntries(ids.map(id => [id, new Element()]));
  el.portalDesignPreview.hidden = true;
  el.portalHighlights.hidden = true;
  el.portalQaSampleBanner.hidden = true;
  el.portalProfileSampleNote.hidden = true;
  el.portalResourcesSampleNote.hidden = true;
  el.portalUpdatesSampleNote.hidden = true;
  el.portalEventsFilter.value = 'all';
  el.portalSupportFilter.value = 'all';
  el.portalSupportHistory.open = true;
  el.portalWellnessHistory.open = true;

  const eventTimeSlice = APP_JS.slice(APP_JS.indexOf('function publicEventTime('), APP_JS.indexOf('function renderPublicEvents('));
  const dashboardSlice = APP_JS.slice(APP_JS.indexOf('function renderPortalData('), APP_JS.indexOf('/* ---------- Staff console:'));
  const wellnessSlice = APP_JS.slice(APP_JS.indexOf('let wellnessQuestions ='), APP_JS.indexOf('function openWellnessForm('));
  const supportSlice = APP_JS.slice(
    APP_JS.indexOf('/* ---------- Portal: My Support requests'),
    APP_JS.indexOf("document.addEventListener('click'", APP_JS.indexOf('/* ---------- Portal: My Support requests'))
  );

  const networkCalls = [];
  const context = vm.createContext({
    Date: class extends Date {
      constructor(...a) { super(...(a.length ? a : [FIXED_NOW])); }
      static now() { return FIXED_NOW; }
    },
    Intl,
    URLSearchParams,
    crypto: globalThis.crypto,
    window: { location: { search: '' } },
    document: {
      getElementById: id => el[id] || null,
      createElement: tag => new Element(tag),
      createTextNode: s => ({ textContent: String(s) }),
      createElementNS: (_ns, tag) => new Element(tag)
    },
    fetch: async (...args) => {
      networkCalls.push(args);
      throw new Error('unexpected network call in synthetic UI render');
    },
    localStorage: {
      setItem() { throw new Error('must not persist sample data to localStorage'); }
    }
  });

  vm.runInContext(
    eventTimeSlice + '\n' + wellnessSlice + '\n' + dashboardSlice + '\n' + supportSlice,
    context
  );
  context.initPortalSectionFilters();

  return { context, el, networkCalls };
}

function collectSampleNodes(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.attributes && (node.attributes['data-portal-sample-item'] || node.attributes['data-sample-item'])) {
    out.push(node);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectSampleNodes(child, out);
  }
  return out;
}

function collectInteractiveTags(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (['form', 'input', 'button', 'select', 'textarea'].includes(node.tag) || (node.attributes && node.attributes['data-action'])) {
    out.push(node.tag || node.attributes['data-action']);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectInteractiveTags(child, out);
  }
  return out;
}

test('server + UI: intended preview QA caregiver receives qa_samples: true while other caregivers and production profiles are denied sample flags', async () => {
  const { sqlite, LEGACY_DB } = makePortalDb();
  sqlite.prepare(
    `INSERT INTO caregiver (id, first_name, last_name, email, phone, sanctuary_member, status)
     VALUES (?, 'Jacob', 'QA', ?, '414-555-0154', 1, 'active')`
  ).run(QA_ID, QA_EMAIL);
  sqlite.prepare(
    `INSERT INTO caregiver (id, first_name, last_name, email, phone, sanctuary_member, status)
     VALUES (?, 'Alex', 'Neighbor', ?, '414-555-0199', 0, 'active')`
  ).run(OTHER_ID, OTHER_EMAIL);

  sqlite.prepare(
    `INSERT INTO event (id, title, type, starts_at, ends_at, location, publish_state)
     VALUES ('ev-real-1', 'Real Milwaukee Memory Social', 'memory_social', '2026-11-06 11:00', '2026-11-06 12:30', 'Sanctuary Hall', 'published')`
  ).run();
  sqlite.prepare(
    `INSERT INTO registration (event_id, caregiver_id, status, source)
     VALUES ('ev-real-1', ?, 'registered', 'web_form')`
  ).run(QA_ID);

  const previewEnv = {
    LEGACY_DB,
    PORTAL_TOKEN_SECRET: SECRET,
    ENVIRONMENT: 'preview',
    PORTAL_PREVIEW_MAIL_ENABLED: '1',
    PORTAL_PREVIEW_QA_CAREGIVER_ID: QA_ID,
    PORTAL_PREVIEW_QA_EMAIL: QA_EMAIL
  };

  // 1. Authenticated QA caregiver on preview receives qa_samples: true alongside real data
  const qaMeRes = await onRequestGet({
    request: new Request('https://staging.legacy-hub-pilot.pages.dev/api/portal/me', {
      headers: { Cookie: makePortalCookie(QA_ID, 'preview') }
    }),
    env: previewEnv,
    params: { path: ['me'] }
  });
  assert.equal(qaMeRes.status, 200);
  const qaMeBody = await qaMeRes.json();
  assert.equal(qaMeBody.ok, true);
  assert.equal(qaMeBody.qa_samples, true);
  assert.equal(qaMeBody.profile.id, QA_ID);
  assert.equal(qaMeBody.events.length, 1);
  assert.equal(qaMeBody.events[0].title, 'Real Milwaukee Memory Social');

  // 2. Second caregiver on preview is denied before reading profile/sample flags (401)
  const otherPreviewRes = await onRequestGet({
    request: new Request('https://staging.legacy-hub-pilot.pages.dev/api/portal/me', {
      headers: { Cookie: makePortalCookie(OTHER_ID, 'preview') }
    }),
    env: previewEnv,
    params: { path: ['me'] }
  });
  assert.equal(otherPreviewRes.status, 401);

  // 3. On production (or non-QA session), /api/portal/me never emits qa_samples even if env vars exist
  const prodEnv = {
    LEGACY_DB,
    PORTAL_TOKEN_SECRET: SECRET,
    ENVIRONMENT: 'production',
    PORTAL_PREVIEW_QA_CAREGIVER_ID: QA_ID,
    PORTAL_PREVIEW_QA_EMAIL: QA_EMAIL
  };
  const qaProdRes = await onRequestGet({
    request: new Request('https://legacy.org/api/portal/me', {
      headers: { Cookie: makePortalCookie(QA_ID, 'production') }
    }),
    env: prodEnv,
    params: { path: ['me'] }
  });
  assert.equal(qaProdRes.status, 200);
  const qaProdBody = await qaProdRes.json();
  assert.equal('qa_samples' in qaProdBody, false, 'production profile selection remains separate');

  const otherProdRes = await onRequestGet({
    request: new Request('https://legacy.org/api/portal/me', {
      headers: { Cookie: makePortalCookie(OTHER_ID, 'production') }
    }),
    env: prodEnv,
    params: { path: ['me'] }
  });
  assert.equal(otherProdRes.status, 200);
  const otherProdBody = await otherProdRes.json();
  assert.equal('qa_samples' in otherProdBody, false, 'second caregiver never receives qa_samples');
});

test('immediate in-section visibility: QA caregiver sees labeled samples across sections without opening a collapsed demo, while real history is preserved', () => {
  assert.doesNotMatch(PORTAL_HTML, /id="portalWellnessSample"|Preview a filled-out portal \(sample data\)/);

  const ui = createPortalDashboardUi();
  const mePayload = {
    ok: true,
    qa_samples: true,
    profile: {
      id: QA_ID,
      first_name: 'Jacob',
      last_name: 'QA',
      email: QA_EMAIL,
      phone: '414-555-0154',
      sanctuary_member: 1
    },
    grants: [],
    events: [
      {
        id: 'ev-real-1',
        title: 'Real Milwaukee Memory Social',
        type: 'memory_social',
        starts_at: '2026-11-06 11:00',
        location: 'Sanctuary Hall',
        registration_status: 'registered'
      }
    ]
  };
  const supportPayload = {
    ok: true,
    profile_contact: { email: QA_EMAIL, phone: '414-555-0154' },
    requests: [
      {
        request_id: '11111111-1111-4111-8111-111111111111',
        support_type: 'speak_with_team_member',
        support_type_label: 'Speak With a Legacy Team Member',
        urgency: 'next_few_days',
        urgency_label: 'Next few days',
        contact_preference: 'email',
        contact_preference_label: 'Email',
        status: 'received',
        status_label: 'Received',
        submitted_at: '2026-11-03T18:00:00Z',
        last_status_updated_at: '2026-11-03T18:00:00Z'
      }
    ]
  };

  ui.context.renderPortalData(mePayload);
  ui.context.renderPortalSupport(supportPayload);
  ui.context.renderWellness({
    history: [{ created_at: '2026-11-01T12:00:00Z', score: 80 }],
    due: false
  });

  // Top QA sample banner and section notes are immediately visible (not collapsed)
  assert.equal(ui.el.portalQaSampleBanner.hidden, false);
  assert.equal(ui.el.portalProfileSampleNote.hidden, false);
  assert.equal(ui.el.portalResourcesSampleNote.hidden, false);
  assert.equal(ui.el.portalUpdatesSampleNote.hidden, false);

  // Real profile fields are preserved intact
  assert.equal(ui.el.portalProfileName.textContent, 'Jacob QA');
  assert.equal(ui.el.portalProfileEmail.textContent, QA_EMAIL);
  assert.equal(ui.el.portalProfilePhone.textContent, '414-555-0154');
  assert.match(ui.el.portalMembershipStatus.innerHTML, /Sanctuary member/);

  // My Events immediately shows Upcoming (1 real + 3 sample) and Past (2 sample)
  const eventGroups = ui.el.portalEventsList.children;
  assert.equal(eventGroups.length, 2);
  assert.equal(eventGroups[0].children[0].textContent, 'Upcoming');
  assert.equal(eventGroups[1].children[0].textContent, 'Past');
  const eventsText = ui.el.portalEventsList.textContent;
  assert.match(eventsText, /Real Milwaukee Memory Social/);
  assert.match(eventsText, /\[SAMPLE\] Thursday Afternoon Memory Social/);
  assert.match(eventsText, /\[SAMPLE\] Virtual Caregiver Support Group/);
  assert.match(eventsText, /\[SAMPLE\] Restorative Breath & Caregiver Renewal/);
  assert.match(eventsText, /\[SAMPLE\] Family Dementia Education Workshop/);
  assert.match(eventsText, /\[SAMPLE\] Autumn Gathering Memory Social/);
  assert.equal(collectSampleNodes(ui.el.portalEventsList).length, 5);

  // My Support immediately shows 1 real request + 3 sample requests across statuses
  const supportList = ui.el.portalSupportHistoryRows.children[0];
  assert.equal(supportList.tag, 'ol');
  assert.equal(supportList.children.length, 4);
  const supportText = ui.el.portalSupportHistoryRows.textContent;
  assert.match(supportText, /Speak With a Legacy Team Member/);
  assert.match(supportText, /\[SAMPLE\] Respite Services/);
  assert.match(supportText, /\[SAMPLE\] Caregiver Support & Guidance/);
  assert.match(supportText, /\[SAMPLE\] Community Resources & Referrals/);
  assert.equal(collectSampleNodes(ui.el.portalSupportHistoryRows).length, 3);

  // Highlights include both real next event and labeled [SAMPLE / TEST] highlights
  assert.equal(ui.el.portalHighlights.hidden, false);
  const highlightItems = ui.el.portalHighlightsList.children.map(c => c.textContent);
  assert.ok(highlightItems.some(t => t.includes('Your next event: Real Milwaukee Memory Social')));
  assert.ok(highlightItems.some(t => t.includes('[SAMPLE / TEST] Sample upcoming event:')));
  assert.ok(highlightItems.some(t => t.includes('[SAMPLE / TEST] Sample support follow-up (In Progress):')));

  // Wellness section contains ONLY the real saved check-in, zero fictional scores
  assert.equal(ui.el.portalWellnessTrend.children.length, 0);
  assert.equal(ui.el.portalWellnessHistoryRows.children[0].children.length, 1);
  assert.equal(ui.el.portalWellnessHistoryRows.textContent, '2026-11-01 — 80 out of 100');
  assert.doesNotMatch(ui.el.portalWellnessHistoryRows.textContent, /SAMPLE/i);
});

test('section filters include and exclude expected sample and real items across My Events and My Support', () => {
  const ui = createPortalDashboardUi();
  ui.context.renderPortalData({
    ok: true,
    qa_samples: true,
    profile: { first_name: 'Jacob' },
    grants: [],
    events: [
      {
        id: 'ev-real-1',
        title: 'Real Milwaukee Memory Social',
        type: 'memory_social',
        starts_at: '2026-11-06 11:00',
        registration_status: 'registered'
      }
    ]
  });
  ui.context.renderPortalSupport({
    ok: true,
    requests: [
      {
        request_id: '11111111-1111-4111-8111-111111111111',
        support_type: 'speak_with_team_member',
        support_type_label: 'Speak With a Legacy Team Member',
        status: 'received',
        status_label: 'Received',
        submitted_at: '2026-11-03T18:00:00Z',
        last_status_updated_at: '2026-11-03T18:00:00Z'
      }
    ]
  });

  const setEventsFilter = value => {
    ui.el.portalEventsFilter.value = value;
    ui.el.portalEventsFilter.listeners.change();
    return ui.el.portalEventsList.textContent;
  };

  // Upcoming only
  let evText = setEventsFilter('upcoming');
  assert.match(evText, /Real Milwaukee Memory Social/);
  assert.match(evText, /\[SAMPLE\] Thursday Afternoon Memory Social/);
  assert.doesNotMatch(evText, /\[SAMPLE\] Family Dementia Education Workshop/);
  assert.doesNotMatch(evText, /\[SAMPLE\] Autumn Gathering Memory Social/);

  // Past only
  evText = setEventsFilter('past');
  assert.match(evText, /\[SAMPLE\] Family Dementia Education Workshop/);
  assert.match(evText, /\[SAMPLE\] Autumn Gathering Memory Social/);
  assert.doesNotMatch(evText, /Real Milwaukee Memory Social/);
  assert.doesNotMatch(evText, /\[SAMPLE\] Thursday Afternoon Memory Social/);

  // Memory Socials only
  evText = setEventsFilter('memory_social');
  assert.match(evText, /Real Milwaukee Memory Social/);
  assert.match(evText, /\[SAMPLE\] Thursday Afternoon Memory Social/);
  assert.match(evText, /\[SAMPLE\] Autumn Gathering Memory Social/);
  assert.doesNotMatch(evText, /\[SAMPLE\] Virtual Caregiver Support Group/);
  assert.doesNotMatch(evText, /\[SAMPLE\] Restorative Breath & Caregiver Renewal/);

  // Support Groups only
  evText = setEventsFilter('support_group');
  assert.match(evText, /\[SAMPLE\] Virtual Caregiver Support Group/);
  assert.doesNotMatch(evText, /\[SAMPLE\] Thursday Afternoon Memory Social/);

  // Workshops & Caregiver Events only
  evText = setEventsFilter('caregiver_event');
  assert.match(evText, /\[SAMPLE\] Family Dementia Education Workshop/);
  assert.doesNotMatch(evText, /\[SAMPLE\] Virtual Caregiver Support Group/);

  // Wellness Sessions only
  evText = setEventsFilter('wellness');
  assert.match(evText, /\[SAMPLE\] Restorative Breath & Caregiver Renewal/);
  assert.doesNotMatch(evText, /\[SAMPLE\] Thursday Afternoon Memory Social/);

  // Real registrations only (excludes all samples)
  evText = setEventsFilter('real');
  assert.match(evText, /Real Milwaukee Memory Social/);
  assert.doesNotMatch(evText, /SAMPLE \/ TEST/);
  assert.equal(collectSampleNodes(ui.el.portalEventsList).length, 0);

  // Sample entries only (excludes real registration)
  evText = setEventsFilter('sample');
  assert.doesNotMatch(evText, /Real Milwaukee Memory Social/);
  assert.match(evText, /\[SAMPLE\] Thursday Afternoon Memory Social/);
  assert.equal(collectSampleNodes(ui.el.portalEventsList).length, 5);

  // Restore all events
  evText = setEventsFilter('all');
  assert.match(evText, /Real Milwaukee Memory Social/);
  assert.equal(collectSampleNodes(ui.el.portalEventsList).length, 5);

  const setSupportFilter = value => {
    ui.el.portalSupportFilter.value = value;
    ui.el.portalSupportFilter.listeners.change();
    return ui.el.portalSupportHistoryRows.textContent;
  };

  // Received only (1 real + 1 sample)
  let supText = setSupportFilter('received');
  assert.match(supText, /Speak With a Legacy Team Member/);
  assert.match(supText, /\[SAMPLE\] Caregiver Support & Guidance/);
  assert.doesNotMatch(supText, /\[SAMPLE\] Respite Services/);
  assert.doesNotMatch(supText, /\[SAMPLE\] Community Resources & Referrals/);

  // In Progress only (1 sample)
  supText = setSupportFilter('in_progress');
  assert.match(supText, /\[SAMPLE\] Respite Services/);
  assert.doesNotMatch(supText, /Speak With a Legacy Team Member/);
  assert.doesNotMatch(supText, /\[SAMPLE\] Caregiver Support & Guidance/);

  // Completed only (1 sample)
  supText = setSupportFilter('completed');
  assert.match(supText, /\[SAMPLE\] Community Resources & Referrals/);
  assert.doesNotMatch(supText, /\[SAMPLE\] Respite Services/);

  // Real requests only (excludes all samples)
  supText = setSupportFilter('real');
  assert.match(supText, /Speak With a Legacy Team Member/);
  assert.doesNotMatch(supText, /SAMPLE \/ TEST/);
  assert.equal(collectSampleNodes(ui.el.portalSupportHistoryRows).length, 0);

  // Sample entries only (excludes real request)
  supText = setSupportFilter('sample');
  assert.doesNotMatch(supText, /Speak With a Legacy Team Member/);
  assert.equal(collectSampleNodes(ui.el.portalSupportHistoryRows).length, 3);
});

test('reload stability, read-only sample safety, and second-caregiver isolation', () => {
  const ui = createPortalDashboardUi();
  const qaMe = {
    ok: true,
    qa_samples: true,
    profile: { first_name: 'Jacob' },
    grants: [],
    events: [{ id: 'ev-1', title: 'Real Event', type: 'memory_social', starts_at: '2026-11-06 11:00', registration_status: 'registered' }]
  };
  const qaSupport = {
    ok: true,
    requests: [{
      request_id: '11111111-1111-4111-8111-111111111111',
      support_type: 'respite_services',
      support_type_label: 'Respite Services',
      status: 'received',
      status_label: 'Received',
      submitted_at: '2026-11-03T18:00:00Z',
      last_status_updated_at: '2026-11-03T18:00:00Z'
    }]
  };

  ui.context.renderPortalData(qaMe);
  ui.context.renderPortalSupport(qaSupport);
  const firstEventsSnapshot = ui.el.portalEventsList.textContent;
  const firstSupportSnapshot = ui.el.portalSupportHistoryRows.textContent;
  const firstHighlightsSnapshot = ui.el.portalHighlightsList.textContent;

  // Reload / re-render produces the exact same deterministic view without duplicating samples
  ui.context.renderPortalData(qaMe);
  ui.context.renderPortalSupport(qaSupport);
  assert.equal(ui.el.portalEventsList.textContent, firstEventsSnapshot);
  assert.equal(ui.el.portalSupportHistoryRows.textContent, firstSupportSnapshot);
  assert.equal(ui.el.portalHighlightsList.textContent, firstHighlightsSnapshot);
  assert.equal(collectSampleNodes(ui.el.portalEventsList).length, 5);
  assert.equal(collectSampleNodes(ui.el.portalSupportHistoryRows).length, 3);

  // Sample items have zero interactive controls or data-action attributes and make no network calls
  for (const sampleNode of [
    ...collectSampleNodes(ui.el.portalEventsList),
    ...collectSampleNodes(ui.el.portalSupportHistoryRows)
  ]) {
    assert.deepEqual(collectInteractiveTags(sampleNode), []);
  }
  assert.equal(ui.networkCalls.length, 0);

  // Second caregiver session (no qa_samples) hides banner, sample notes, and all sample entries
  ui.context.renderPortalData({
    ok: true,
    profile: { first_name: 'Alex' },
    grants: [],
    events: []
  });
  ui.context.renderPortalSupport({
    ok: true,
    requests: []
  });
  assert.equal(ui.el.portalQaSampleBanner.hidden, true);
  assert.equal(ui.el.portalProfileSampleNote.hidden, true);
  assert.equal(ui.el.portalResourcesSampleNote.hidden, true);
  assert.equal(ui.el.portalUpdatesSampleNote.hidden, true);
  assert.equal(collectSampleNodes(ui.el.portalEventsList).length, 0);
  assert.equal(collectSampleNodes(ui.el.portalSupportHistoryRows).length, 0);
  assert.doesNotMatch(ui.el.portalEventsList.textContent, /SAMPLE \/ TEST/);
  assert.doesNotMatch(ui.el.portalSupportHistoryRows.textContent, /SAMPLE \/ TEST/);
  assert.equal(ui.el.portalHighlights.hidden, true);
});
