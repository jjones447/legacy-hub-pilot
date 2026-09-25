// Tests for LEGACY-CONSOLE-PLAIN-AND-MIC-R1 (fleet-work#99)
// Verifies:
// 1. Status line counts format correctly for 0, singular, and plural counts.
// 2. Segment tags render as buttons, are keyboard-focusable with visible focus ring, and clicking sets filter and re-runs search.
// 3. POST /api/agent/transcribe with mocked env.AI: text returned, empty audio refused, oversize refused, model failure via internalError.
// 4. Zero occurrences of "demo", "sample", or "prototype" in user-facing console text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestPost as postTranscribe } from '../functions/api/agent/transcribe.js';
import { onRequestPost as postAgent } from '../functions/api/agent/[[path]].js';

const STAFF_HTML = readFileSync(new URL('../staff.html', import.meta.url), 'utf8');
const STAFF_JS = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
const STYLES_CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// 1. Status Line Counts
// ---------------------------------------------------------------------------
test('status line counts: natural zero counts and accurate plural/singular counts', () => {
  // Extract formatStatusLine from staff.js
  const match = STAFF_JS.match(/function\s+formatStatusLine\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'formatStatusLine function found in staff.js');
  const formatStatusLine = new Function(`${match[0]}; return formatStatusLine;`)();

  // Test 1: Zero counts read naturally ("Nothing needs attention")
  const zeroStatus = formatStatusLine({
    needsAttentionCount: 0,
    eventsThisWeekCount: 0,
    grantsInReviewCount: 0,
  });
  assert.equal(
    zeroStatus,
    'Nothing needs attention · no events this week · no grants in review',
    'Zero counts read naturally',
  );

  // Test 2: Target example counts from spec ("3 need attention · 2 events this week · 1 grant in review")
  const exampleStatus = formatStatusLine({
    needsAttentionCount: 3,
    eventsThisWeekCount: 2,
    grantsInReviewCount: 1,
  });
  assert.equal(
    exampleStatus,
    '3 need attention · 2 events this week · 1 grant in review',
    'Example plural/singular counts match exactly',
  );

  // Test 3: Singular counts
  const singularStatus = formatStatusLine({
    needsAttentionCount: 1,
    eventsThisWeekCount: 1,
    grantsInReviewCount: 1,
  });
  assert.equal(
    singularStatus,
    '1 needs attention · 1 event this week · 1 grant in review',
    'Singular counts read naturally',
  );

  // Test 4: Default/empty arguments default to 0
  const defaultStatus = formatStatusLine({});
  assert.equal(
    defaultStatus,
    'Nothing needs attention · no events this week · no grants in review',
    'Empty object defaults to zero counts',
  );
});

// ---------------------------------------------------------------------------
// 2. Segment Tags Filter & Focus
// ---------------------------------------------------------------------------
test('segment tags: rendered as buttons, keyboard-focusable, visible focus ring, and filter logic', () => {
  // Verify staff.js renders clickable buttons for segment tags
  assert.match(
    STAFF_JS,
    /<button[^>]*class="segment-tag-btn"[^>]*data-action="filter-segment"/,
    'searchCaregivers renders segment tags as buttons with filter-segment action',
  );

  // Verify CSS visible focus ring styling
  assert.match(
    STYLES_CSS,
    /\.segment-tag-btn:(focus|focus-visible)[\s\S]*?outline:/,
    'styles.css includes visible outline focus ring for .segment-tag-btn',
  );

  // Verify filterBySegment logic in staff.js
  const matchFilter = STAFF_JS.match(/function\s+filterBySegment\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(matchFilter, 'filterBySegment found in staff.js');

  // Simulate DOM select and filterBySegment execution
  let searchCalledWith = null;
  const mockOptions = [
    { value: '', textContent: 'All segments' },
    { value: 'dementia', textContent: 'Dementia' },
    { value: 'als', textContent: 'ALS' },
  ];
  const mockSelect = {
    options: mockOptions,
    value: '',
    appendChild(opt) {
      mockOptions.push(opt);
    }
  };

  const fakeDocument = {
    getElementById(id) {
      if (id === 'caregiverSearchSegment') return mockSelect;
      return null;
    },
    createElement(tag) {
      return { tag, value: '', textContent: '' };
    }
  };

  const fakeSearchCaregivers = (offset) => {
    searchCalledWith = offset;
  };

  const runFilter = new Function(
    'document',
    'searchCaregivers',
    `${matchFilter[0]}; return filterBySegment;`
  )(fakeDocument, fakeSearchCaregivers);

  // Run filter with an existing segment 'dementia'
  runFilter('dementia');
  assert.equal(mockSelect.value, 'dementia', 'Sets select value to dementia');
  assert.equal(searchCalledWith, 0, 'Re-runs searchCaregivers(0)');

  // Run filter with a new segment tag not in preset options
  runFilter('respite');
  assert.equal(mockSelect.value, 'respite', 'Dynamically creates option and sets value');
  assert.equal(searchCalledWith, 0, 'Re-runs searchCaregivers(0)');

  // Verify click listener handles filter-segment
  assert.match(
    STAFF_JS,
    /action\s*===\s*['"]filter-segment['"]/,
    'Click listener handles filter-segment action',
  );
});

// ---------------------------------------------------------------------------
// 3. POST /api/agent/transcribe with Mocked env.AI
// ---------------------------------------------------------------------------
test('POST /api/agent/transcribe: text returned from Workers AI Whisper', async () => {
  let aiCalledWith = null;
  const mockEnv = {
    AI: {
      async run(model, options) {
        aiCalledWith = { model, options };
        return { text: 'Add a support group on October 15 at 6 PM on Google Meet.' };
      }
    }
  };

  const audioPayload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const req = new Request('https://legacy-hub.pages.dev/api/agent/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: audioPayload,
  });

  const res = await postTranscribe({ request: req, env: mockEnv });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/json');

  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.text, 'Add a support group on October 15 at 6 PM on Google Meet.');

  assert.ok(aiCalledWith);
  assert.equal(aiCalledWith.model, '@cf/openai/whisper-large-v3-turbo');
  assert.ok(aiCalledWith.options.audio instanceof Uint8Array);
  assert.equal(aiCalledWith.options.audio.length, 8);
});

test('POST /api/agent/transcribe: empty audio is refused with 400', async () => {
  const mockEnv = {
    AI: {
      async run() {
        return { text: 'should not be called' };
      }
    }
  };

  // Empty Uint8Array body
  const emptyReq = new Request('https://legacy-hub.pages.dev/api/agent/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: new Uint8Array(0),
  });

  const res = await postTranscribe({ request: emptyReq, env: mockEnv });
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'no_audio');
});

test('POST /api/agent/transcribe: oversize audio (>25 MB) is refused with 413', async () => {
  const mockEnv = {
    AI: {
      async run() {
        return { text: 'should not be called' };
      }
    }
  };

  // 1. Content-Length header check (> 25MB)
  const reqWithHeader = new Request('https://legacy-hub.pages.dev/api/agent/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/webm',
      'Content-Length': String(26 * 1024 * 1024),
    },
    body: new Uint8Array(10),
  });

  const resHeader = await postTranscribe({ request: reqWithHeader, env: mockEnv });
  assert.equal(resHeader.status, 413);
  const dataHeader = await resHeader.json();
  assert.equal(dataHeader.ok, false);
  assert.equal(dataHeader.error, 'audio_too_large');

  // 2. Buffer byteLength check (> 25MB)
  const largeBuffer = new Uint8Array(25 * 1024 * 1024 + 1);
  const reqWithBuffer = {
    url: 'https://legacy-hub.pages.dev/api/agent/transcribe',
    method: 'POST',
    headers: {
      get(k) {
        if (k.toLowerCase() === 'content-type') return 'audio/webm';
        return null;
      }
    },
    async arrayBuffer() {
      return largeBuffer.buffer;
    }
  };

  const resBuffer = await postTranscribe({ request: reqWithBuffer, env: mockEnv });
  assert.equal(resBuffer.status, 413);
  const dataBuffer = await resBuffer.json();
  assert.equal(dataBuffer.ok, false);
  assert.equal(dataBuffer.error, 'audio_too_large');
});

test('POST /api/agent/transcribe: model failure goes through internalError with 500', async () => {
  const mockEnv = {
    AI: {
      async run() {
        throw new Error('Cloudflare Workers AI capacity exceeded');
      }
    }
  };

  const audioPayload = new Uint8Array([10, 20, 30]);
  const req = new Request('https://legacy-hub.pages.dev/api/agent/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: audioPayload,
  });

  const res = await postTranscribe({ request: req, env: mockEnv });
  assert.equal(res.status, 500);

  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'internal_error');
});

test('POST /api/agent/[[path]].js routes /api/agent/transcribe cleanly', async () => {
  const mockEnv = {
    AI: {
      async run() {
        return { text: 'Transcribed from path router' };
      }
    }
  };

  const audioPayload = new Uint8Array([1, 2, 3]);
  const req = new Request('https://legacy-hub.pages.dev/api/agent/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/webm' },
    body: audioPayload,
  });

  const res = await postAgent({ request: req, env: mockEnv });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.text, 'Transcribed from path router');
});

// ---------------------------------------------------------------------------
// 4. Plain Labels and Zero "demo", "sample", or "prototype" in Console Text
// ---------------------------------------------------------------------------
test('staff console header, plain labels, empty state, and zero demo/sales copy', () => {
  // Title and header brand
  assert.ok(STAFF_HTML.includes('<title>Legacy Hub · Staff console</title>'));
  assert.ok(STAFF_HTML.includes('Legacy Hub<small>Staff console</small>'));
  assert.ok(STAFF_HTML.includes('<h2>Legacy Hub · Staff console</h2>'));
  assert.ok(STAFF_HTML.includes('id="staffStatusLine"'));

  // Sales banner removed
  assert.ok(!STAFF_HTML.includes('One caregiver record · every workflow'));
  assert.ok(!STAFF_HTML.includes('Today at Legacy'));
  assert.ok(!STAFF_HTML.includes('no spreadsheets'));

  // Plain one-line explanations under all 6 panels
  assert.ok(STAFF_HTML.includes('Search and filter caregiver records by name, contact, status, or segment.'));
  assert.ok(STAFF_HTML.includes('Open follow-ups and action items requiring staff review.'));
  assert.ok(STAFF_HTML.includes('Schedule, manage, and take attendance for community events and respite sessions.'));
  assert.ok(STAFF_HTML.includes('Track grant applications from review through award, course completion, and closeout.'));
  assert.ok(STAFF_HTML.includes('View and manage caregiver contact details, program attendance, grants, and staff notes.'));
  assert.ok(STAFF_HTML.includes('Direct editor for published site content and pages.'));

  // Assistant plain labels
  assert.ok(STAFF_HTML.includes('id="chatEmptyState"'));
  assert.ok(STAFF_HTML.includes('Tell me what to change, for example: Add a support group on October 15 at 6 PM on Google Meet.'));
  assert.ok(!STAFF_HTML.includes('draft → preview → confirm'));
  assert.ok(STAFF_JS.includes("Here's what will change:"));
  assert.ok(!STAFF_JS.includes('Mapped your request to a structured content change'));

  // Mic button next to Send
  assert.ok(STAFF_HTML.includes('id="micBtn"'));
  assert.ok(STAFF_HTML.includes('data-action="agent-mic"'));

  // Zero demo, sample, or prototype in staff.html
  const forbiddenPattern = /\b(demo|sample|prototype)\b/i;
  assert.ok(
    !forbiddenPattern.test(STAFF_HTML),
    `Found forbidden demo/sample/prototype copy in staff.html: ${STAFF_HTML.match(forbiddenPattern)?.[0]}`,
  );
});
