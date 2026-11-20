// Separate request-local capability; never grants the human assistant confirmation proof.
const VERIFIED_PUBLISHER = Symbol('verified-legacy-publisher');
export const PUBLISHER_ACTOR = 'service:legacy-publisher';
export function setVerifiedPublisher(data, enabled) { data[VERIFIED_PUBLISHER] = enabled === true; }
export function publisherActor(data) { return data?.[VERIFIED_PUBLISHER] === true ? PUBLISHER_ACTOR : null; }
export function isPublisherPayload(payload, env) {
  const pinned = env?.LEGACY_PUBLISHER_CLIENT_ID;
  return typeof pinned === 'string' && pinned.length > 0 && pinned.length <= 256
    && !payload?.email && typeof payload?.common_name === 'string' && payload.common_name === pinned;
}
export function publisherRouteAllowed(request, env) {
  const url = new URL(request.url);
  if (request.method === 'POST' && /^\/api\/agent\/publisher\/(draft|preview|confirm)$/.test(url.pathname)) return true;
  // TEST acceptance reads only. No People writes, exports, assistant or workflow mutation.
  if (env.ENVIRONMENT === 'preview' && request.method === 'GET') {
    return ['/staff', '/staff/', '/staff.html', '/api/staff/caregivers'].includes(url.pathname);
  }
  return false;
}
