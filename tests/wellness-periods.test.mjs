import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_QUARTER_POLICY, quarterPolicy, quarterPeriod, currentQuarter, quarterStatus,
} from '../functions/_lib/wellness-periods.js';
import { CHECKIN_EVERY_DAYS, isCheckinDue } from '../functions/_lib/wellness.js';

const at = value => Date.parse(value);
const status = (id, now, fields = {}) => quarterStatus({
  period: quarterPeriod(id), selected: true, ...fields,
}, at(now));

for (const [quarter, startsOn, endsBefore] of [
  [1, '2026-01-01', '2026-04-01'], [2, '2026-04-01', '2026-07-01'],
  [3, '2026-07-01', '2026-10-01'], [4, '2026-10-01', '2027-01-01'],
]) {
  test(`quarter ${quarter} uses local calendar dates with exclusive end`, () => {
    const period = quarterPeriod(`2026-Q${quarter}`);
    assert.equal(period.startsOn, startsOn);
    assert.equal(period.endsBefore, endsBefore);
    assert.deepEqual(period.policy, DEFAULT_QUARTER_POLICY);
  });
}

for (const [instant, expected] of [
  ['2026-01-01T05:59:59.999Z', '2025-Q4'], ['2026-01-01T06:00:00Z', '2026-Q1'],
  ['2026-04-01T04:59:59.999Z', '2026-Q1'], ['2026-04-01T05:00:00Z', '2026-Q2'],
  ['2026-07-01T04:59:59.999Z', '2026-Q2'], ['2026-07-01T05:00:00Z', '2026-Q3'],
  ['2026-10-01T04:59:59.999Z', '2026-Q3'], ['2026-10-01T05:00:00Z', '2026-Q4'],
  ['2027-01-01T06:00:00Z', '2027-Q1'], ['2028-02-29T18:00:00Z', '2028-Q1'],
  ['2026-03-08T07:59:59Z', '2026-Q1'], ['2026-03-08T08:00:00Z', '2026-Q1'],
  ['2026-11-01T06:59:59Z', '2026-Q4'], ['2026-11-01T07:00:00Z', '2026-Q4'],
]) {
  test(`${instant} is ${expected} in Chicago`, () => {
    assert.equal(currentQuarter(at(instant)).id, expected);
  });
}

test('timezone is configurable and never taken from the server timezone', () => {
  const now = at('2026-10-01T01:00:00Z');
  assert.equal(currentQuarter(now).id, '2026-Q3');
  assert.equal(currentQuarter(now, { timeZone: 'UTC' }).id, '2026-Q4');
  assert.equal(currentQuarter(now, { timeZone: 'Asia/Tokyo' }).id, '2026-Q4');
});

test('policy validation rejects unsupported schedules, versions, zones and fields', () => {
  for (const bad of [null, [], 'UTC', { schedule: 'rolling' }, { version: 2 },
    { timeZone: '' }, { timeZone: 'Not/A_Zone' }, { timeZone: undefined }, { reminder: true }]) {
    assert.throws(() => quarterPolicy(bad));
  }
});

test('clock validation rejects coerced, missing, fractional and impossible instants', () => {
  for (const bad of [undefined, null, true, '2026-10-01', NaN, Infinity, 1.5, 9e15]) {
    assert.throws(() => currentQuarter(bad));
  }
  assert.throws(() => currentQuarter(-62167219200000)); // year zero
});

test('quarter IDs are canonical, bounded and never parsed loosely', () => {
  for (const bad of [null, 2026, '2026-Q0', '2026-Q5', '2026-q1', '26-Q1',
    '2026-Q1 extra', '0000-Q1', '9999-Q4']) assert.throws(() => quarterPeriod(bad));
});

test('calendar quarter status does not depend on a baseline or rolling interval', () => {
  assert.equal(status('2026-Q4', '2026-10-04T12:00:00Z').state, 'due');
  assert.equal(status('2026-Q4', '2026-12-31T18:00:00Z').due, true);
  assert.equal(status('2026-Q4', '2026-10-04T12:00:00Z', { completed: true }).state, 'completed');
});

test('selected missed quarters do not carry into another quarter', () => {
  assert.equal(status('2026-Q3', '2026-10-04T12:00:00Z').state, 'missed');
  assert.equal(status('2026-Q3', '2026-10-04T12:00:00Z').due, false);
  assert.equal(status('2026-Q4', '2026-10-04T12:00:00Z').state, 'due');
  assert.equal(status('2027-Q1', '2026-10-04T12:00:00Z').state, 'upcoming');
});

test('selection and withdrawal suppress collection without deleting completion', () => {
  const now = '2026-10-04T12:00:00Z';
  assert.equal(status('2026-Q4', now, { selected: false }).state, 'not-selected');
  assert.equal(status('2026-Q4', now, { withdrawn: true }).state, 'withdrawn');
  assert.equal(status('2026-Q3', now, { selected: false }).state, 'not-selected');
  assert.equal(status('2026-Q4', now, { withdrawn: true, completed: true }).state, 'completed');
  assert.equal(status('2026-Q3', now, { selected: false, completed: true }).state, 'completed');
});

test('states change at the local quarter boundary, not UTC midnight', () => {
  assert.equal(status('2026-Q3', '2026-10-01T04:59:59.999Z').state, 'due');
  assert.equal(status('2026-Q3', '2026-10-01T05:00:00Z').state, 'missed');
  assert.equal(status('2026-Q4', '2026-10-01T04:59:59.999Z').state, 'upcoming');
  assert.equal(status('2026-Q4', '2026-10-01T05:00:00Z').state, 'due');
});

test('invalid or mismatched snapshots and ambiguous flags fail closed', () => {
  const now = at('2026-10-04T12:00:00Z');
  const period = quarterPeriod('2026-Q4');
  for (const bad of [{ period }, { period, selected: 1 }, { period, selected: true, completed: 'yes' },
    { period: null, selected: true }, { period: { ...period, startsOn: '2026-09-01' }, selected: true },
    { period: { ...period, policy: undefined }, selected: true },
    { period: { ...period, policy: { timeZone: 'UTC' } }, selected: true },
    { period: { ...period, quarter: 3 }, selected: true }]) {
    assert.throws(() => quarterStatus(bad, now));
  }
  assert.throws(() => status('2027-Q1', '2026-10-04T12:00:00Z', { completed: true }));
});

test('input and result policy snapshots cannot be silently mutated', () => {
  const overrides = { timeZone: 'UTC' };
  const period = quarterPeriod('2026-Q4', overrides);
  overrides.timeZone = 'America/Chicago';
  assert.equal(period.policy.timeZone, 'UTC');
  assert.throws(() => { period.policy.timeZone = 'America/Chicago'; });
  assert.throws(() => { period.id = '2026-Q3'; });
});

test('legacy 30-day records retain their existing semantics', () => {
  assert.equal(CHECKIN_EVERY_DAYS, 30);
  assert.equal(isCheckinDue('2026-09-25 12:00:00', at('2026-10-04T12:00:00Z')), false);
});
