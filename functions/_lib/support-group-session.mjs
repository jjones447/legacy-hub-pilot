// The same authored session list used by templates/programs.html.j2. The dates
// are static/readOnly page-section data, not client labels or editable D1 copy.
import pageSections from '../../content/page-sections.json' with { type: 'json' };

export const SUPPORT_GROUP_SOURCE = 'site_form:support_group';
export const SUPPORT_GROUP_MEET = 'https://meet.google.com/dmc-orwi-afk';
export const isSupportGroup = body => body?.kind === 'support_request' && body?.source === SUPPORT_GROUP_SOURCE;

export function supportGroupSession(date) {
  if (date === null || date === undefined) return { date: null, label: 'Every Wednesday, 5–6 PM Central' };
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  const sessions = pageSections.items?.['programs.support_group']?.sessions;
  const matches = Array.isArray(sessions) ? sessions.filter(session => session?.date === date) : [];
  if (matches.length !== 1 || typeof matches[0].label !== 'string' || !matches[0].label.trim()) return null;
  return { date, label: `${matches[0].label} Central (America/Chicago)` };
}

export function validateSupportGroupSession(body) {
  if (!isSupportGroup(body)) return Object.hasOwn(body, 'session_date') ? 'session_date is only valid for support-group sign-up' : null;
  return supportGroupSession(body.session_date) ? null : 'invalid or unavailable support-group session_date';
}
