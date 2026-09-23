// Shared identity extraction helper for staff-console and back-office services.
// Evaluates verified Cloudflare Access JWT assertions or dev-mode actor headers.

export function getActor(request, env) {
  // x-dev-actor is honored ONLY in the non-prod dev-console mode (SEC: no audit spoof).
  if (env && env.ALLOW_DEV_CONSOLE === '1') {
    const devActor = request.headers.get('x-dev-actor');
    if (devActor) return devActor;
  }

  // The JWT here is already signature-verified by _middleware.js; decoding for the
  // email is safe.
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return 'anonymous_staff';

  try {
    const parts = jwt.split('.');
    if (parts.length === 3) {
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payloadJson = atob(payloadBase64);
      const payload = JSON.parse(payloadJson);
      return payload.email || payload.sub || 'unknown_staff';
    }
  } catch (e) {
    // Fallback if parsing fails
  }
  return 'invalid_jwt_staff';
}
