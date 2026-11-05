// Caregiver Portal production normal-section dashboard sample source increment.
// In-memory SQLite + synthetic DOM only. No network, provider, mail or deployment side effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import {
  onRequestGet,
  productionSampleCaregiver,
  matchesProductionSampleCaregiver
} from '../functions/api/portal/[[path]].js';

const APP_JS = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const PORTAL_HTML = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');

const QA_ID = '00000000-0000-4000-8000-000000000054';
const QA_EMAIL = 'qa-caregiver-54@example.test';
const OTHER_ID = '00000000-0000-4000-8000-000000000099';
const OTHER_EMAIL = 'second-caregiver@example.test';
const SECRET = 'fictional-qa-dashboard-sample-secret';
const FIXED_NOW = Date.parse('2026-11-04T15:00:00Z');

function makePortalCookie(id, _mode = 'production', expiry = Date.now() + 60_000) {
  const payload = `${id}:${expiry}`;
  const signature = createHmac('sha256', SECRET).update(`session:${payload}`).digest('hex');
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

function createPortalDashboardUi({ fetchHandler = null } = {}) {
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
    focus() {}
    reset() {}
  }

  const ids = [
    'loginView', 'dashView', 'portalDesignPreview', 'portalLogoutBtn', 'portalLogoutStatus', 'loginStatus', 'loginEmail',
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
  const portalLoginLogoutSlice = APP_JS.slice(APP_JS.indexOf('function checkPortalSession('), APP_JS.indexOf('function renderPortalData('));
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
    takePortalHandoff: () => null,
    window: { location: { search: '' }, scrollTo() {} },
    document: {
      getElementById: id => el[id] || null,
      createElement: tag => new Element(tag),
      createTextNode: s => ({ textContent: String(s) }),
      createElementNS: (_ns, tag) => new Element(tag)
    },
    fetch: async (...args) => {
      networkCalls.push(args);
      if (typeof fetchHandler === 'function') {
        return fetchHandler(...args);
      }
      throw new Error('unexpected network call in synthetic UI render');
    },
    localStorage: {
      setItem() { throw new Error('must not persist sample data to localStorage'); }
    }
  });

  vm.runInContext(
    eventTimeSlice + '\n' + wellnessSlice + '\n' + portalLoginLogoutSlice + '\n' + dashboardSlice + '\n' + supportSlice,
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

test('server + UI: explicit production sample tuple enables qa_samples: true for the single configured production caregiver, defaults OFF, never infers from staging QA, and isolates other caregivers', async () => {
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

  // 1. Policy helpers default OFF unless ENVIRONMENT=production + PORTAL_PRODUCTION_SAMPLES_ENABLED + valid ID + email are all explicitly configured
  assert.equal(productionSampleCaregiver({}), null);
  assert.equal(productionSampleCaregiver({
    ENVIRONMENT: 'preview',
    PORTAL_PRODUCTION_SAMPLES_ENABLED: '1',
    PORTAL_PRODUCTION_SAMPLE_CAREGIVER_ID: QA_ID,
    PORTAL_PRODUCTION_SAMPLE_EMAIL: QA_EMAIL
  }), null, 'non-production environment never enables production sample helper');
  assert.equal(productionSampleCaregiver({
    ENVIRONMENT: 'production',
    PORTAL_PRODUCTION_SAMPLES_ENABLED: '0',
    PORTAL_PRODUCTION_SAMPLE_CAREGIVER_ID: QA_ID,
    PORTAL_PRODUCTION_SAMPLE_EMAIL: QA_EMAIL
  }), null, 'explicit disable keeps production sample helper OFF');
  assert.equal(productionSampleCaregiver({
    ENVIRONMENT: 'production',
    PORTAL_PRODUCTION_SAMPLES_ENABLED: '1',
    PORTAL_PRODUCTION_SAMPLE_CAREGIVER_ID: QA_ID
  }), null, 'partial tuple without email stays OFF');
  assert.equal(productionSampleCaregiver({
    ENVIRONMENT: 'production',
    PORTAL_PRODUCTION_SAMPLES_ENABLED: '1',
    PORTAL_PRODUCTION_SAMPLE_CAREGIVER_ID: 'bad id!',
    PORTAL_PRODUCTION_SAMPLE_EMAIL: QA_EMAIL
  }), null, 'malformed caregiver ID stays OFF');
  assert.equal(matchesProductionSampleCaregiver({
    ENVIRONMENT: 'production',
    PORTAL_PRODUCTION_SAMPLES_ENABLED: '1',
    PORTAL_PRODUCTION_SAMPLE_CAREGIVER_ID: QA_ID,
    PORTAL_PRODUCTION_SAMPLE_EMAIL: QA_EMAIL
  }, QA_ID, 'QA-CAREGIVER-54@EXAMPLE.TEST'), true);
  assert.equal(matchesProductionSampleCaregiver({
    ENVIRONMENT: 'production',
    PORTAL_PRODUCTION_SAMPLES_ENABLED: '1',
    PORTAL_PRODUCTION_SAMPLE_CAREGIVER_ID: QA_ID,
    PORTAL_PRODUCTION_SAMPLE_EMAIL: QA_EMAIL
  }, OTHER_ID, QA_EMAIL), false, 'both ID and email must match');

  // 2. Staging QA variables never enable qa_samples on production or when production tuple is unset
  const stagingVarsOnlyOnProdEnv = {
    LEGACY_DB,
    PORTAL_TOKEN_SECRET: SECRET,
    ENVIRONMENT: 'production',
    PORTAL_PREVIEW_MAIL_ENABLED: '1',
    PORTAL_PREVIEW_QA_CAREGIVER_ID: QA_ID,
    PORTAL_PREVIEW_QA_EMAIL: QA_EMAIL
  };
  const noTupleRes = await onRequestGet({
    request: new Request('https://legacy.org/api/portal/me', {
      headers: { Cookie: makePortalCookie(QA_ID, 'production') }
    }),
    env: stagingVarsOnlyOnProdEnv,
    params: { path: ['me'] }
  });
  assert.equal(noTupleRes.status, 200);
  const noTupleBody = await noTupleRes.json();
  assert.equal('qa_samples' in noTupleBody, false, 'staging QA variables are never inferred for production');

  // 3. Explicit production tuple enables qa_samples: true for the single configured production caregiver alongside real data
  const configuredProdEnv = {
    LEGACY_DB,
    PORTAL_TOKEN_SECRET: SECRET,
    ENVIRONMENT: 'production',
    PORTAL_PRODUCTION_SAMPLES_ENABLED: '1',
    PORTAL_PRODUCTION_SAMPLE_CAREGIVER_ID: QA_ID,
    PORTAL_PRODUCTION_SAMPLE_EMAIL: QA_EMAIL
  };
  const qaMeRes = await onRequestGet({
    request: new Request('https://legacy.org/api/portal/me', {
      headers: { Cookie: makePortalCookie(QA_ID, 'production') }
    }),
    env: configuredProdEnv,
    params: { path: ['me'] }
  });
  assert.equal(qaMeRes.status, 200);
  const qaMeBody = await qaMeRes.json();
  assert.equal(qaMeBody.ok, true);
  assert.equal(qaMeBody.qa_samples, true);
  assert.equal(qaMeBody.profile.id, QA_ID);
  assert.equal(qaMeBody.events.length, 1);
  assert.equal(qaMeBody.events[0].title, 'Real Milwaukee Memory Social');

  // 4. Second caregiver on the same configured production environment is isolated and never receives qa_samples
  const otherProdRes = await onRequestGet({
    request: new Request('https://legacy.org/api/portal/me', {
      headers: { Cookie: makePortalCookie(OTHER_ID, 'production') }
    }),
    env: configuredProdEnv,
    params: { path: ['me'] }
  });
  assert.equal(otherProdRes.status, 200);
  const otherProdBody = await otherProdRes.json();
  assert.equal('qa_samples' in otherProdBody, false, 'second caregiver never receives qa_samples');

  // 5. Before #331 form/endpoint is present on production HTML, checkPortalSession() does not fetch /api/portal/support and still renders sample/empty support rows
  const pre331Ui = createPortalDashboardUi({
    fetchHandler: async (url) => {
      if (url === '/api/portal/me') {
        return { ok: true, status: 200, async json() { return qaMeBody; } };
      }
      if (url === '/api/portal/wellness') {
        return { ok: true, status: 200, async json() { return { ok: true, questions: [], history: [] }; } };
      }
      throw new Error(`unexpected fetch before #331 support form is mounted: ${url}`);
    }
  });
  delete pre331Ui.el.portalSupportForm;
  pre331Ui.context.checkPortalSession();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(
    pre331Ui.networkCalls.map(c => c[0]),
    ['/api/portal/me', '/api/portal/wellness'],
    'does not request /api/portal/support when #portalSupportForm is absent'
  );
  assert.equal(collectSampleNodes(pre331Ui.el.portalSupportHistoryRows).length, 3);
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

test('session lifecycle: confirmed logout, changed/absent identity, failed/delayed history, and same-identity pending reconciliation', async () => {
  let mePayload = {
    ok: true,
    qa_samples: true,
    profile: { id: 'fictional-a', first_name: 'A', email: 'a@example.test' },
    grants: [],
    events: []
  };
  let supportResponse = {
    ok: true,
    requests: [{
      request_id: 'req-a-1',
      support_type: 'speak_with_team_member',
      support_type_label: 'A PRIVATE FICTIONAL SUPPORT HISTORY',
      status: 'received',
      status_label: 'Received',
      urgency_label: 'This week',
      contact_preference_label: 'Email',
      submitted_at: '2026-11-01T12:00:00Z',
      last_status_updated_at: '2026-11-01T12:00:00Z'
    }]
  };
  let supportShouldFail = false;
  let delayedSupportResolve = null;
  let delayedWellnessResolve = null;

  const ui = createPortalDashboardUi({
    fetchHandler: async (url) => {
      if (url === '/api/portal/me') {
        return {
          status: 200,
          ok: true,
          redirected: false,
          headers: { get: () => 'application/json' },
          json: async () => mePayload
        };
      }
      if (url === '/api/portal/logout') {
        return {
          status: 200,
          ok: true,
          redirected: false,
          headers: { get: () => 'application/json' },
          json: async () => ({ ok: true })
        };
      }
      if (url === '/api/portal/support') {
        if (delayedSupportResolve) {
          return new Promise(resolve => {
            delayedSupportResolve = resolve;
          });
        }
        if (supportShouldFail) {
          return {
            status: 500,
            ok: false,
            headers: { get: () => 'application/json' },
            json: async () => ({ ok: false })
          };
        }
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => supportResponse
        };
      }
      if (url === '/api/portal/wellness') {
        if (delayedWellnessResolve) {
          return new Promise(resolve => {
            delayedWellnessResolve = resolve;
          });
        }
        return {
          status: 200,
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ questions: [], history: [{ created_at: '2026-11-01T12:00:00Z', score: 85 }], due: false })
        };
      }
      throw new Error(`unexpected fetch url: ${url}`);
    }
  });

  const flushMicrotasks = async (rounds = 2) => {
    for (let i = 0; i < rounds; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };

  // 1. Session A (QA sample caregiver with 1 real support request)
  ui.context.checkPortalSession();
  await flushMicrotasks();

  const totalSampleDomNodes = () =>
    collectSampleNodes(ui.el.portalEventsList).length + collectSampleNodes(ui.el.portalSupportHistoryRows).length;

  assert.equal(ui.el.dashView.style.display, 'block');
  assert.equal(ui.el.portalProfileEmail.textContent, 'a@example.test');
  assert.equal(vm.runInContext('portalQaSamplesActive', ui.context), true);
  assert.equal(totalSampleDomNodes(), 8);
  assert.equal(ui.el.portalQaSampleBanner.hidden, false);
  assert.equal(vm.runInContext('portalSupportRealRequests.length', ui.context), 1);
  assert.match(ui.el.portalSupportHistoryRows.textContent, /A PRIVATE FICTIONAL SUPPORT HISTORY/);

  // Non-default filters before logout
  ui.el.portalEventsFilter.value = 'upcoming';
  ui.el.portalEventsFilter.listeners.change();
  ui.el.portalSupportFilter.value = 'received';
  ui.el.portalSupportFilter.listeners.change();

  // 2. Confirmed logout clears sample state, sample DOM nodes, cached real requests, filter selections, and highlights
  await ui.context.portalLogout();
  assert.equal(ui.el.dashView.style.display, 'none');
  assert.equal(vm.runInContext('portalQaSamplesActive', ui.context), false);
  assert.equal(totalSampleDomNodes(), 0);
  assert.equal(ui.el.portalQaSampleBanner.hidden, true);
  assert.equal(ui.el.portalProfileSampleNote.hidden, true);
  assert.equal(ui.el.portalResourcesSampleNote.hidden, true);
  assert.equal(ui.el.portalUpdatesSampleNote.hidden, true);
  assert.equal(ui.el.portalHighlights.hidden, true);
  assert.equal(ui.el.portalHighlightsList.children.length, 0);
  assert.equal(vm.runInContext('portalSupportRealRequests.length', ui.context), 0);
  assert.equal(ui.el.portalEventsFilter.value, 'all');
  assert.equal(ui.el.portalSupportFilter.value, 'all');

  // 3. Second identity in same document with failed /api/portal/support GET must never resurrect caregiver A's history on filter change
  mePayload = {
    ok: true,
    profile: { id: 'fictional-b', first_name: 'B', email: 'b@example.test' },
    grants: [],
    events: []
  };
  supportShouldFail = true;
  ui.context.checkPortalSession();
  await flushMicrotasks();

  assert.equal(ui.el.portalProfileEmail.textContent, 'b@example.test');
  assert.equal(vm.runInContext('portalQaSamplesActive', ui.context), false);
  assert.equal(totalSampleDomNodes(), 0);
  assert.equal(ui.el.portalSupportHistoryRows.textContent, 'Your support requests are not available right now.');

  for (const nextFilter of ['received', 'in_progress', 'completed', 'real', 'all']) {
    ui.el.portalSupportFilter.value = nextFilter;
    ui.el.portalSupportFilter.listeners.change();
    assert.equal(ui.el.portalSupportHistoryRows.textContent, 'Your support requests are not available right now.');
    assert.equal(ui.el.portalSupportHistoryRows.textContent.includes('A PRIVATE FICTIONAL'), false);
  }

  // 4. Absent identity clears cached support rows, sample state, filter selections, and highlights
  supportShouldFail = false;
  mePayload = {
    ok: true,
    qa_samples: true,
    profile: { id: 'fictional-a', first_name: 'A', email: 'a@example.test' },
    grants: [],
    events: []
  };
  ui.context.checkPortalSession();
  await flushMicrotasks();
  assert.equal(vm.runInContext('portalSupportRealRequests.length', ui.context), 1);

  ui.context.renderPortalData({
    ok: true,
    profile: {},
    grants: [],
    events: []
  });
  assert.equal(vm.runInContext('portalQaSamplesActive', ui.context), false);
  assert.equal(vm.runInContext('portalSupportRealRequests.length', ui.context), 0);
  assert.equal(totalSampleDomNodes(), 0);
  assert.equal(ui.el.portalHighlights.hidden, true);
  assert.equal(ui.el.portalEventsFilter.value, 'all');
  assert.equal(ui.el.portalSupportFilter.value, 'all');

  // 5. Delayed async completions from a prior session are fenced and cannot repopulate current state
  ui.context.renderPortalData({
    ok: true,
    qa_samples: true,
    profile: { id: 'fictional-a', first_name: 'A', email: 'a@example.test' },
    grants: [],
    events: []
  });
  delayedSupportResolve = true;
  delayedWellnessResolve = true;
  const staleSupportPromise = ui.context.loadPortalSupport();
  const staleWellnessPromise = ui.context.loadWellness();
  await flushMicrotasks(2);
  const resolveStaleSupport = delayedSupportResolve;
  const resolveStaleWellness = delayedWellnessResolve;
  delayedSupportResolve = null;
  delayedWellnessResolve = null;

  // Switch to caregiver B before Session A's support/wellness requests finish
  ui.context.renderPortalData({
    ok: true,
    profile: { id: 'fictional-b', first_name: 'B', email: 'b@example.test' },
    grants: [],
    events: []
  });
  ui.context.renderPortalSupport({ ok: true, requests: [] });
  ui.context.renderWellness({ history: [], due: true });

  resolveStaleSupport({
    status: 200,
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => supportResponse
  });
  resolveStaleWellness({
    status: 200,
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ questions: [], history: [{ created_at: '2026-11-01T12:00:00Z', score: 99 }], due: false })
  });
  const staleSupportResult = await staleSupportPromise;
  await staleWellnessPromise;

  assert.equal(staleSupportResult.stale, true);
  assert.equal(vm.runInContext('portalSupportRealRequests.length', ui.context), 0);
  assert.equal(ui.el.portalSupportHistoryRows.textContent.includes('A PRIVATE FICTIONAL'), false);
  assert.equal(ui.el.portalWellnessHistoryRows.textContent.includes('99 out of 100'), false);

  // 6. Same-identity unresolved request reconciliation is preserved across same-identity re-render
  ui.context.renderPortalData({
    ok: true,
    qa_samples: true,
    profile: { id: 'fictional-a', first_name: 'A', email: 'a@example.test' },
    grants: [],
    events: []
  });
  vm.runInContext(
    `portalSupportPendingRequest = {
      requestId: 'req-a-pending',
      signature: 'respite_services|this_week|email||need help',
      submittedAfterMs: 0,
      unresolved: true
    };`,
    ui.context
  );
  // Re-rendering same caregiver A preserves portalSupportPendingRequest
  ui.context.renderPortalData({
    ok: true,
    qa_samples: true,
    profile: { id: 'fictional-a', first_name: 'A', email: 'a@example.test' },
    grants: [],
    events: []
  });
  assert.equal(vm.runInContext('Boolean(portalSupportPendingRequest && portalSupportPendingRequest.unresolved)', ui.context), true);

  supportResponse = {
    ok: true,
    requests: [{
      request_id: 'req-a-pending',
      support_type: 'respite_services',
      support_type_label: 'Respite Services',
      status: 'received',
      status_label: 'Received',
      urgency_label: 'This week',
      contact_preference_label: 'Email',
      submitted_at: '2026-11-04T15:00:00Z',
      last_status_updated_at: '2026-11-04T15:00:00Z'
    }]
  };
  const reconciled = await ui.context.loadPortalSupport();
  assert.equal(reconciled.ok, true);
  assert.equal(vm.runInContext('portalSupportPendingRequest', ui.context), null);
  assert.match(ui.el.portalSupportMsg.textContent, /Confirmed: your support request \(Respite Services\) was saved \(Received\)\./);
});
