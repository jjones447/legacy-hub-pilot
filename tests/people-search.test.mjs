// [pc2-claude-ct-2] People search (requester, Nov 12 2026, ts 1794499587.407689 / 1794499835.090709).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as caregivers from '../functions/_lib/domain/caregivers.js';

const schema = name => readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8');
const html = readFileSync(new URL('../staff.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');
let raw, db;
function d1(sqlite) {
  const wrap = (sql, params = []) => ({
    bind: (...p) => wrap(sql, p),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    run: async () => sqlite.prepare(sql).run(...params),
  });
  return { prepare: sql => wrap(sql) };
}
beforeEach(() => {
  raw = new DatabaseSync(':memory:');
  raw.exec(schema('0001_init.sql'));
  raw.exec(schema('candidates/0021_caregiver_identity.sql'));
  db = d1(raw);
});

test('the candidate migration adds a nullable yes/no marker and leaves existing rows not yet identified', () => {
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(schema('0001_init.sql'));
  fresh.prepare(`INSERT INTO caregiver (id, first_name) VALUES ('cg_before', 'Existing')`).run();
  fresh.exec(schema('candidates/0021_caregiver_identity.sql'));
  assert.equal(fresh.prepare(`SELECT is_caregiver FROM caregiver WHERE id = 'cg_before'`).get().is_caregiver, null);
  assert.throws(() => fresh.prepare(`UPDATE caregiver SET is_caregiver = 'maybe' WHERE id = 'cg_before'`).run(), /CHECK/);
  fresh.prepare(`UPDATE caregiver SET is_caregiver = 'yes' WHERE id = 'cg_before'`).run();
});

test('staff can set Caregiver? to yes, no or back to not yet identified; other values are refused', async () => {
  raw.prepare(`INSERT INTO caregiver (id, first_name) VALUES ('cg_p', 'Pat')`).run();
  for (const value of ['yes', 'no', null, '']) {
    const v = await caregivers.validate(db, { id: 'cg_p', operation: 'update', payload: { is_caregiver: value }, staffConsole: true });
    assert.equal(v.ok, true, String(value));
    assert.equal(v.payload.is_caregiver, value === '' ? null : value);
  }
  const bad = await caregivers.validate(db, { id: 'cg_p', operation: 'update', payload: { is_caregiver: 'maybe' }, staffConsole: true });
  assert.equal(bad.status, 400);
  // Without the Staff Console opt-in (any other caller) the field is refused.
  const other = await caregivers.validate(db, { id: 'cg_p', operation: 'update', payload: { is_caregiver: 'yes' } });
  assert.match(other.error, /forbidden field: is_caregiver/);
});

test('the assistant mapper surface is unchanged: Caregiver? is staff-console only', () => {
  assert.equal(caregivers.ALLOWED_CAREGIVER_UPDATE_FIELDS.includes('is_caregiver'), false);
  assert.deepEqual(caregivers.STAFF_ONLY_CAREGIVER_UPDATE_FIELDS, ['is_caregiver']);
});

test('the console says People, offers the Type filter and shows Caregiver? per person', () => {
  assert.match(html, /<h4 id="caregiverListHeading">People<\/h4>/);
  assert.match(html, /<option value="caregiver">People<\/option>/);
  const type = html.match(/<select id="caregiverSearchType"[\s\S]*?<\/select>/)?.[0] || '';
  assert.deepEqual([...type.matchAll(/<option value="([^"]*)">([^<]+)<\/option>/g)].map(m => `${m[1]}=${m[2]}`),
    ['=All people', 'yes=Caregivers', 'no=Not caregivers', 'unknown=Not yet identified']);
  assert.match(html, /<th>Person<\/th><th>Contact<\/th><th>Caregiver\?<\/th>/);
  assert.match(js, /if \(personType\) params\.set\('caregiver', personType\);/);
  assert.match(js, /cg\.is_caregiver === 'yes' \? 'Yes' : cg\.is_caregiver === 'no' \? 'No' : 'Not yet identified'/);
  // Only a changed marker is sent, so ordinary edits never depend on the new column.
  assert.match(js, /\(caregiverSelect\.value \|\| ''\) !== \(caregiverSelect\.dataset\.current \|\| ''\)/);
});

test('the search route filters by Type and refuses unknown values', () => {
  const route = readFileSync(new URL('../functions/api/staff/[[path]].js', import.meta.url), 'utf8');
  assert.match(route, /if \(caregiverType === 'yes' \|\| caregiverType === 'no'\) \{\s*conditions\.push\(`c\.is_caregiver = \?`\);/);
  assert.match(route, /caregiverType === 'unknown'\) \{\s*conditions\.push\(`c\.is_caregiver IS NULL`\);/);
  assert.match(route, /caregiver must be yes, no or unknown/);
});
