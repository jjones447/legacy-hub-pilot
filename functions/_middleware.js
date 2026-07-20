// Root middleware: (1) baseline security headers on every response, and
// (2) fail-closed auth on the staff/agent console surfaces via real Cloudflare
// Access JWT signature verification.
//
// Replaces the earlier crude fail-closed stopgap (SEC-1/SEC-2). This VERIFIES the
// `Cf-Access-Jwt-Assertion` JWT (RS256 signature against the team's JWKS, plus
// aud/iss/exp checks) instead of trusting the header's presence — which also closes
// the *.pages.dev bypass (verification is hostname-independent).
//
// Config (set when Cloudflare Access is provisioned — see runbook):
//   CF_ACCESS_TEAM_DOMAIN  e.g. "legacy.cloudflareaccess.com"
//   CF_ACCESS_AUD          the Access application's Audience (AUD) tag
// Until BOTH are set, console surfaces stay 403 (fail closed). A non-prod escape
// (ALLOW_DEV_CONSOLE="1") lets a preview/dev environment exercise the console.

const CONSOLE_API_PREFIXES = ['/api/staff/', '/api/agent/'];
const CONSOLE_PAGES = ['/staff.html'];

let _jwks = { url: null, keys: null, at: 0 };
const JWKS_TTL_MS = 10 * 60 * 1000;

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

async function fetchJwks(teamDomain, fetchImpl) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const now = Date.now();
  if (_jwks.url === url && _jwks.keys && now - _jwks.at < JWKS_TTL_MS) return _jwks.keys;
  const resp = await fetchImpl(url, { cf: { cacheTtl: 600 } });
  if (!resp.ok) throw new Error(`jwks ${resp.status}`);
  const data = await resp.json();
  _jwks = { url, keys: data.keys || [], at: now };
  return _jwks.keys;
}

// Returns the verified payload, or null if the token is invalid for ANY reason.
export async function verifyAccessJwt(token, { teamDomain, aud, fetchImpl = fetch, now = Date.now() }) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  let header, payload;
  try {
    header = JSON.parse(b64urlToString(h));
    payload = JSON.parse(b64urlToString(p));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  const nowSec = Math.floor(now / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < nowSec) return null;
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSec) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;

  let keys;
  try {
    keys = await fetchJwks(teamDomain, fetchImpl);
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  let ok = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`)
    );
  } catch {
    return null;
  }
  return ok ? payload : null;
}

function withSecurityHeaders(resp) {
  const h = new Headers(resp.headers);
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  // NOTE: enforced Content-Security-Policy deferred — needs per-page browser testing
  // against inline styles/handlers before enforcing, to avoid breaking the live site.
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

function forbidden() {
  return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const path = new URL(request.url).pathname;
  const isConsole =
    CONSOLE_API_PREFIXES.some((p) => path.startsWith(p)) || CONSOLE_PAGES.includes(path);

  if (isConsole) {
    // Non-prod escape for preview/demo (never set in production).
    if (env.ALLOW_DEV_CONSOLE === '1') {
      return withSecurityHeaders(await next());
    }
    // Real verification. Fail closed until Cloudflare Access is configured.
    const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
    const aud = env.CF_ACCESS_AUD;
    if (!teamDomain || !aud) return withSecurityHeaders(forbidden());
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    const payload = await verifyAccessJwt(token, { teamDomain, aud });
    if (!payload) return withSecurityHeaders(forbidden());
    // Verified. Endpoints may now safely decode the (verified) JWT for the actor email.
  }

  return withSecurityHeaders(await next());
}
