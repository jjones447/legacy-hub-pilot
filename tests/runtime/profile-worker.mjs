// Local qualification adapter only. Excluded from site assets and Pages functions.
// Not a deployed login flow: the runner supplies a fixture-only signed session.
import { onRequestGet, onRequestPost } from '../../functions/api/portal/[[path]].js';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== '127.0.0.1' || env.ENVIRONMENT !== 'profile_local_fixture'
        || env.PROFILE_LOCAL_FIXTURE !== '1' || env.EMAIL_API_KEY
        || env.PREVIEW_MAIL_ENABLED || env.PORTAL_PREVIEW_MAIL_ENABLED) {
      return new Response('Local fixture unavailable', { status: 403 });
    }
    if (url.pathname === '/api/portal/profile') {
      const handler = request.method === 'GET' ? onRequestGet : request.method === 'POST' ? onRequestPost : null;
      return handler ? handler({ request, env }) : new Response(null, { status: 405 });
    }
    // No mint, login, verification, staff, deployment or provider-control endpoint.
    if (request.method === 'GET' && !url.search && ['/', '/caregiver-profile.js', '/styles.css'].includes(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
    return new Response(null, { status: 404 });
  },
};
