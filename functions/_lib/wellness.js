// Caregiver well-being check-in (schema/0012_wellness_checkin.sql).
// A short, plain-language check-in written for Legacy, not a clinical instrument. Shanelle can change
// the wording and the schedule; the stored answers are keyed by question id, so old check-ins stay
// readable if a question is reworded.

export const CHECKIN_EVERY_DAYS = 30;

// value 1..5; `good` says which end of the scale means "doing well".
export const QUESTIONS = [
  { id: 'stress', text: 'Over the past two weeks, how stressed have you felt caring for your loved one?', low: 'Not at all', high: 'Extremely', good: 'low' },
  { id: 'sleep', text: 'How well have you been sleeping?', low: 'Very poorly', high: 'Very well', good: 'high' },
  { id: 'support', text: 'How supported do you feel by the people around you?', low: 'Not at all', high: 'Very supported', good: 'high' },
  { id: 'self_time', text: 'How much time have you had for yourself?', low: 'None', high: 'Plenty', good: 'high' },
];

const NOTE_MAX = 1000;

/** Validate a submission. Returns { ok, answers, note } or { ok: false, error }. */
export function validateCheckin(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Please answer each question.' };
  const answers = {};
  for (const q of QUESTIONS) {
    const v = Number(body.answers ? body.answers[q.id] : undefined);
    if (!Number.isInteger(v) || v < 1 || v > 5) return { ok: false, error: 'Please answer each question.' };
    answers[q.id] = v;
  }
  let note = body.note == null ? '' : String(body.note).trim();
  if (note.length > NOTE_MAX) return { ok: false, error: `The note is too long (${NOTE_MAX} characters at most).` };
  return { ok: true, answers, note: note || null };
}

/** 0..100, where 100 means doing well on every question. */
export function scoreCheckin(answers) {
  let total = 0;
  for (const q of QUESTIONS) {
    const v = answers[q.id];
    total += q.good === 'high' ? v - 1 : 5 - v; // each question 0..4
  }
  return Math.round((total / (QUESTIONS.length * 4)) * 100);
}

function parseSqliteTime(value) {
  if (!value) return NaN;
  return Date.parse(String(value).replace(' ', 'T') + 'Z');
}

/** Is a check-in due? True with no history, or when the latest is CHECKIN_EVERY_DAYS old. */
export function isCheckinDue(latestCreatedAt, now = Date.now()) {
  const last = parseSqliteTime(latestCreatedAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= CHECKIN_EVERY_DAYS * 24 * 60 * 60 * 1000;
}

export async function recordCheckin(db, caregiverId, answers, note, source = 'portal') {
  const score = scoreCheckin(answers);
  await db
    .prepare('INSERT INTO wellness_checkin (caregiver_id, answers_json, score, note, source) VALUES (?, ?, ?, ?, ?)')
    .bind(caregiverId, JSON.stringify(answers), score, note, source)
    .run();
  await db
    .prepare("INSERT INTO audit_log (actor, action, entity, entity_id) VALUES (?, 'wellness.checkin', 'caregiver', ?)")
    .bind(caregiverId, caregiverId)
    .run();
  return score;
}

/** A caregiver's own history, newest last. */
export async function caregiverHistory(db, caregiverId, limit = 24) {
  const { results } = await db
    .prepare(`SELECT score, answers_json, created_at FROM wellness_checkin
              WHERE caregiver_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(caregiverId, limit)
    .all();
  return (results || []).reverse().map((r) => ({ score: r.score, answers: JSON.parse(r.answers_json), created_at: r.created_at }));
}

export const STAFF_RANGES = { month: 31, quarter: 92, year: 366 };

/** Staff chart data: check-ins for the chosen caregivers since the start of the range. */
export async function staffSeries(db, caregiverIds, range = 'quarter', now = Date.now()) {
  const days = STAFF_RANGES[range] || STAFF_RANGES.quarter;
  const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const ids = [...new Set((caregiverIds || []).filter((x) => typeof x === 'string' && x))].slice(0, 10);
  const series = [];
  for (const id of ids) {
    const person = await db.prepare('SELECT id, first_name, last_name FROM caregiver WHERE id = ?').bind(id).first();
    if (!person) continue;
    const { results } = await db
      .prepare('SELECT score, created_at FROM wellness_checkin WHERE caregiver_id = ? AND created_at >= ? ORDER BY created_at ASC, id ASC')
      .bind(id, since)
      .all();
    series.push({ caregiver_id: id, name: `${person.first_name || ''} ${person.last_name || ''}`.trim(), points: results || [] });
  }
  return { range: STAFF_RANGES[range] ? range : 'quarter', since, series };
}

/** Caregivers who have at least one check-in, for the staff selector. */
export async function caregiversWithCheckins(db) {
  const { results } = await db
    .prepare(`SELECT c.id, c.first_name, c.last_name, COUNT(w.id) AS checkins, MAX(w.created_at) AS latest
              FROM wellness_checkin w JOIN caregiver c ON c.id = w.caregiver_id
              GROUP BY c.id ORDER BY c.last_name COLLATE NOCASE, c.first_name COLLATE NOCASE`)
    .all();
  return results || [];
}
