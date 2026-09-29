// The caregiver portal shows only real data: no sample caregiver shortcut, no canned
// application message, no invented saved resources, no sales copy (client meeting 2026-09-29: "we're past demo").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PORTAL = readFileSync(new URL('../portal.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('no demo actions or sample-caregiver shortcut in the portal', () => {
  assert.doesNotMatch(PORTAL, /data-action="demo-/);
  assert.doesNotMatch(PORTAL, /Maria G\.|Jane Doe|sample caregiver/i);
  for (const a of ['demo-portal-login', 'demo-view-application']) {
    assert.ok(!APP.includes(`'${a}'`), `${a} handler removed`);
  }
});

test('no invented saved resources and no sales copy on the dashboard', () => {
  assert.doesNotMatch(PORTAL, /saved Jun/);
  assert.doesNotMatch(PORTAL, /Why this matters/);
  assert.match(PORTAL, /Resources for you/);
});
