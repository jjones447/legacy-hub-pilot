// New Wellness Journey scheduling, separate from legacy 30-day wellness.js.
// Source-only policy: no collection, storage, enrollment or reminder side effects.
// Store period ID AND policy snapshot with future responses; never reinterpret
// historical periods after a policy edit. Baseline responses are not quarterly completions.
export const DEFAULT_QUARTER_POLICY = Object.freeze({
  schedule: 'calendar-quarter', version: 1, timeZone: 'America/Chicago',
});

export function quarterPolicy(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Quarter policy must be an object');
  }
  if (Object.keys(overrides).some(key => !Object.hasOwn(DEFAULT_QUARTER_POLICY, key))) {
    throw new TypeError('Unknown quarter policy field');
  }
  const policy = { ...DEFAULT_QUARTER_POLICY, ...overrides };
  if (policy.schedule !== 'calendar-quarter' || policy.version !== 1 ||
      typeof policy.timeZone !== 'string' || !policy.timeZone.trim()) {
    throw new TypeError('Unsupported quarter policy');
  }
  // Fail closed on unsupported zones rather than falling back to server timezone.
  policy.timeZone = new Intl.DateTimeFormat('en-US', { timeZone: policy.timeZone })
    .resolvedOptions().timeZone;
  return Object.freeze(policy);
}

function instant(value) {
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new TypeError('An explicit epoch-millisecond instant is required');
  }
  return value;
}

function periodParts(id) {
  if (typeof id !== 'string' || !/^[0-9]{4}-Q[1-4]$/.test(id)) {
    throw new TypeError('Invalid quarter ID');
  }
  const year = Number(id.slice(0, 4));
  if (year < 1 || year > 9998) throw new RangeError('Unsupported quarter year');
  return { year, quarter: Number(id.slice(-1)) };
}

function periodIndex(id) {
  const { year, quarter } = periodParts(id);
  return year * 4 + quarter - 1;
}

const dateKey = (year, month) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;

export function quarterPeriod(id, overrides = {}) {
  const { year, quarter } = periodParts(id);
  const policy = quarterPolicy(overrides);
  const startMonth = (quarter - 1) * 3 + 1;
  return Object.freeze({
    id, year, quarter,
    // Local calendar dates, NOT UTC timestamps. End is exclusive.
    startsOn: dateKey(year, startMonth),
    endsBefore: quarter === 4 ? dateKey(year + 1, 1) : dateKey(year, startMonth + 3),
    policy,
  });
}

export function currentQuarter(now, overrides = {}) {
  instant(now);
  const policy = quarterPolicy(overrides);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: policy.timeZone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: 'numeric', era: 'short',
  }).formatToParts(new Date(now));
  const value = type => parts.find(part => part.type === type)?.value;
  if (value('era') !== 'AD') throw new RangeError('Unsupported quarter year');
  const year = Number(value('year'));
  const quarter = Math.floor((Number(value('month')) - 1) / 3) + 1;
  return quarterPeriod(`${String(year).padStart(4, '0')}-Q${quarter}`, policy);
}

// Caller supplies ONE period's persisted selection snapshot, not today's selection
// for every historical quarter. This helper does not infer prior participation.
// A later withdrawal stops collection but does not erase an existing completion.
export function quarterStatus({ period, selected, completed = false, withdrawn = false }, now) {
  if (typeof selected !== 'boolean' || typeof completed !== 'boolean' || typeof withdrawn !== 'boolean') {
    throw new TypeError('Selection, completion and withdrawal must be explicit booleans');
  }
  if (!period || typeof period !== 'object') throw new TypeError('A period snapshot is required');
  if (!period.policy || Object.keys(DEFAULT_QUARTER_POLICY)
    .some(key => !Object.hasOwn(period.policy, key))) {
    throw new TypeError('A complete persisted policy snapshot is required');
  }
  const canonical = quarterPeriod(period.id, period.policy);
  if (period.year !== canonical.year || period.quarter !== canonical.quarter ||
      period.startsOn !== canonical.startsOn || period.endsBefore !== canonical.endsBefore) {
    throw new TypeError('Period snapshot does not match its policy');
  }
  const current = currentQuarter(now, canonical.policy);
  const difference = periodIndex(canonical.id) - periodIndex(current.id);
  if (completed && difference > 0) throw new RangeError('A future quarter cannot be completed');
  const state = completed ? 'completed' : !selected ? 'not-selected' : withdrawn ? 'withdrawn'
    : difference > 0 ? 'upcoming' : difference < 0 ? 'missed' : 'due';
  return Object.freeze({ period: canonical, state, due: state === 'due' });
}
