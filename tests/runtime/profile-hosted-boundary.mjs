// Hosted synthetic-owner qualification boundary, never a product login route.
// Dependency injection is for unit tests; the deployed entry pins handlers/manifest.
const API = '/api/portal/profile';
const ASSETS = new Set(['/', '/caregiver-profile.js', '/styles.css', '/fixture-start.js']);
const TYPES = { '/': 'text/html; charset=utf-8', '/caregiver-profile.js': 'text/javascript; charset=utf-8',
  '/styles.css': 'text/css; charset=utf-8', '/fixture-start.js': 'text/javascript; charset=utf-8' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function headers(type = 'application/json; charset=utf-8') {
  return { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
}
function deny(status = 403) { return new Response('{"ok":false,"error":"fixture_unavailable"}', { status, headers: headers() }); }
function validManifest(manifest) {
  // Require an actual dedicated fixture preview alias, never a production/default host.
  if (!/^https:\/\/profile-fixture-[a-z0-9-]+\.legacy-hub-5qo\.pages\.dev$/.test(manifest.origin || '')) return false;
  if (!Number.isSafeInteger(manifest.startsAt) || !Number.isSafeInteger(manifest.expiresAt)
      || manifest.expiresAt <= manifest.startsAt || manifest.expiresAt - manifest.startsAt > 3600000) return false;
  return Array.isArray(manifest.owners) && manifest.owners.length === 3
    && new Set(manifest.owners).size === 3
    && manifest.owners.every(id => /^profile_ct13_20261121_(?:a|b|archived)_[0-9a-f]{8}$/.test(id));
}
function sessionPrefilter(header, owners, now, end) {
  if (typeof header !== 'string' || header.length > 4096) return null;
  const matches = header.split(';').map(part => part.trim()).filter(part => part.startsWith('portal_session='));
  if (matches.length !== 1) return null;
  const encoded = matches[0].slice('portal_session='.length);
  let decoded; try { decoded = decodeURIComponent(encoded); } catch { return null; }
  const parts = decoded.split(':');
  if (parts.length !== 3 || !owners.includes(parts[0]) || !/^\d{13}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return null;
  const expiry = Number(parts[1]);
  if (expiry <= now || expiry > end || expiry > now + 300000) return null;
  // Drop all unrelated cookies; the product parser sees exactly the prefiltered one.
  return 'portal_session=' + encodeURIComponent(decoded);
}
export function createHostedProfileFixture({ manifest, get, post, now = Date.now }) {
  // Snapshot the compile-time manifest; no request/env/config can activate it.
  const fixed = Object.freeze({ origin: manifest.origin, startsAt: manifest.startsAt,
    expiresAt: manifest.expiresAt, owners: Object.freeze([...manifest.owners]) });
  return {
    async fetch(request, env) {
      try {
        const time = now(), url = new URL(request.url);
        if (!validManifest(fixed) || time < fixed.startsAt || time >= fixed.expiresAt
            || env.ENVIRONMENT !== 'preview' || url.origin !== fixed.origin
            || url.username || url.password || url.search || url.hash) return deny();
        const origin = request.headers.get('Origin');
        if ((origin !== null && origin !== fixed.origin)
            || ![null, 'same-origin', 'none'].includes(request.headers.get('Sec-Fetch-Site'))) return deny();
        if (url.pathname !== API) {
          if (request.method !== 'GET' || !ASSETS.has(url.pathname)) return deny(404);
          // Fixed assets only, with no cookies/authorization/request headers forwarded.
          const asset = await env.ASSETS.fetch(new Request(fixed.origin + url.pathname));
          if (asset.status !== 200) return deny(404);
          return new Response(asset.body, { headers: headers(TYPES[url.pathname]) });
        }
        if (!['GET', 'POST'].includes(request.method)) return deny(405);
        if (request.method === 'POST' && origin !== fixed.origin) return deny();
        const cookie = sessionPrefilter(request.headers.get('Cookie'), fixed.owners, time, fixed.expiresAt);
        if (!cookie) return deny(401);
        const secret = env.PROFILE_FIXTURE_SECRET;
        if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return deny();
        // Code-enforced non-use, NOT capability isolation of attached preview secrets.
        const handlerEnv = Object.freeze({ LEGACY_DB: env.LEGACY_DB, PORTAL_TOKEN_SECRET: secret,
          ENVIRONMENT: 'profile_hosted_fixture', PORTAL_PROFILE_ENABLED: '1' });
        const forwarded = new Headers({ Cookie: cookie });
        if (origin !== null) forwarded.set('Origin', origin);
        if (request.headers.has('Content-Type')) forwarded.set('Content-Type', request.headers.get('Content-Type'));
        const safeRequest = new Request(request.url, { method: request.method, headers: forwarded,
          ...(request.method === 'POST' ? { body: request.body, duplex: 'half' } : {}) });
        // The unchanged handler verifies signature/expiry/current owner and write CAS.
        const response = await (request.method === 'GET' ? get : post)({ request: safeRequest, env: handlerEnv });
        return new Response(response.body, { status: response.status, headers: headers() });
      } catch {
        // Never serialize/log request headers, env, secrets or exception contents.
        return deny(500);
      }
    },
  };
}
