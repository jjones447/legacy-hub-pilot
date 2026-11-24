// Pure candidate contract. Not authentication, a route, a writer or an activation gate.
export const SUPPORT_NEEDS = Object.freeze(['break', 'care', 'connect', 'resources', 'unsure']);
export const CONTACT_METHODS = Object.freeze(['phone', 'text', 'email']);
export const REQUEST_STATUSES = Object.freeze(['received', 'in_review', 'followed_up', 'closed']);
const keys = ['request_id', 'needs', 'preferred_contact', 'message'];
const plain = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const dataOnly = value => Reflect.ownKeys(value).every(key => typeof key === 'string' &&
  Object.getOwnPropertyDescriptor(value, key)?.get === undefined &&
  Object.getOwnPropertyDescriptor(value, key)?.set === undefined);
export function validateSupportRequest(body) {
  if (!plain(body) || !dataOnly(body) || Object.keys(body).some(k => !keys.includes(k))) return null;
  const { request_id, needs, preferred_contact, message = '' } = body;
  // Identity/contact addresses come from verified server context, never this body.
  if (typeof request_id !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(request_id)) return null;
  if (!Array.isArray(needs) || Object.getPrototypeOf(needs) !== Array.prototype ||
      !dataOnly(needs) || needs.length < 1 || needs.length > SUPPORT_NEEDS.length ||
      Reflect.ownKeys(needs).some(k => k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k))) return null;
  const chosen = [];
  for (let i = 0; i < needs.length; i++) {
    if (!Object.hasOwn(needs, i) || typeof needs[i] !== 'string' ||
        !SUPPORT_NEEDS.includes(needs[i]) || chosen.includes(needs[i])) return null;
    chosen.push(needs[i]);
  }
  if (!CONTACT_METHODS.includes(preferred_contact) || typeof message !== 'string' ||
      message.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) return null;
  // Stable option order makes retries independent of checkbox click order.
  return Object.freeze({ request_id, needs: Object.freeze(SUPPORT_NEEDS.filter(n => chosen.includes(n))),
    preferred_contact, message: message.trim() });
}
const labels = Object.freeze({received:'Received',in_review:'In Review',followed_up:'Followed Up',closed:'Closed'});
export function projectSupportStatus(value) {
  // Legacy followup open/done/dismissed does not prove these transitions.
  return typeof value === 'string' && Object.hasOwn(labels, value)
    ? Object.freeze({code:value,label:labels[value]}) : null;
}
export function canAdvanceSupportStatus(before, after) {
  // Initial creation is received. Staff workflow must record explicit reviewed transitions.
  const next = {received:['in_review'],in_review:['followed_up','closed'],followed_up:['in_review','closed'],closed:[]};
  return typeof before === 'string' && Object.hasOwn(next,before) && next[before].includes(after);
}
