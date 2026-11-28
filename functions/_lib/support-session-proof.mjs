// Call only after authenticating the principal. The Support precondition never
// grants access by itself or supplies the owner/actor to a store operation.
const header = 'X-Support-Session';
const encoder = new TextEncoder();

export function portalSessionValue(cookieHeader) {
  const cookies = (cookieHeader || '').split(';').map(value => value.trim())
    .filter(value => value.startsWith('portal_session='));
  if (cookies.length !== 1) return '';
  try {
    return decodeURIComponent(cookies[0].slice('portal_session='.length));
  } catch {
    return '';
  }
}

async function binding(request, role, principal) {
  const credential = role === 'owner'
    ? portalSessionValue(request.headers.get('Cookie'))
    : request.headers.get('Cf-Access-Jwt-Assertion');
  if (!credential || !principal) return null;
  const key = await crypto.subtle.importKey('raw', encoder.encode(credential),
    {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);
  const data = encoder.encode(JSON.stringify(['support-session-v1', new URL(request.url).origin, role, principal]));
  return {key, data};
}

export async function supportSessionProof(request, role, principal) {
  const bound = await binding(request, role, principal);
  if (!bound) return null;
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', bound.key, bound.data));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function matchesSupportSession(request, role, principal) {
  const value = request.headers.get(header);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return false;
  const bound = await binding(request, role, principal);
  if (!bound) return false;
  const signature = Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', bound.key, signature, bound.data);
}
