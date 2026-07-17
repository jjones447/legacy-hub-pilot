// Root middleware — fail-closed gate for the staff/agent console surfaces.
//
// SECURITY STOPGAP (pc1-cc-gui-2, 2026-07-17): an adversarial review found the
// /api/staff/* and /api/agent/* endpoints ship with NO in-code authentication and
// are reachable unauthenticated on the public internet (incl. the *.pages.dev
// bypass of any future Cloudflare Access policy). Until full CF Access JWT
// signature verification lands (slice-SEC SEC-1/SEC-2), fail CLOSED: these
// surfaces return 403 in production.
//
// The only escape is an explicit non-production flag: set ALLOW_DEV_CONSOLE="1"
// in a preview/dev environment to exercise the console. Production leaves it
// unset, so the consoles are dark. Everything else (public site, /api/portal/*,
// /api/intake, /api/events, /api/webhooks/*) passes straight through untouched.
//
// This does NOT replace real auth — presence of a Cf-Access-Jwt-Assertion header
// is deliberately NOT accepted here, because this middleware does not verify the
// JWT signature (an attacker can set the header). Full verification is the P0
// follow-up. This stopgap exists only to close the wide-open hole immediately.

const CONSOLE_PREFIXES = ['/api/staff/', '/api/agent/'];

export async function onRequest(context) {
  const { request, next, env } = context;
  const path = new URL(request.url).pathname;

  const isConsole = CONSOLE_PREFIXES.some((p) => path.startsWith(p));
  if (isConsole && env.ALLOW_DEV_CONSOLE !== '1') {
    return new Response(
      JSON.stringify({ ok: false, error: 'forbidden' }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    );
  }

  return next();
}
