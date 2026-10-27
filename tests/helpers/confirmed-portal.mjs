// Exercise the actual non-consuming landing and explicit browser-form POST.
// Synthetic Request/Response objects only; never a server, mail send or fetch.
import { onRequestGet, onRequestPost } from '../../functions/api/portal/[[path]].js';

export async function prepareConfirmation(url, env, cookie) {
  const landing = await onRequestGet({ env, request: new Request(url, {
    headers: cookie ? { Cookie: cookie } : {},
  }) });
  if (landing.status !== 200) return { landing };
  const html = await landing.text();
  const values = Object.fromEntries(['token', 'csrf', 'proof'].map(name => {
    const value = html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1];
    if (!value) throw new Error('Missing synthetic confirmation form field');
    return [name, value];
  }));
  const browserCookie = landing.headers.get('Set-Cookie')?.split(';')[0];
  if (!browserCookie) throw new Error('Missing synthetic confirmation nonce cookie');
  const endpoint = new URL('/api/portal/verify', url);
  return { landing, html, values, cookie: browserCookie,
    request(overrides = {}) {
      const headers = { Origin: endpoint.origin, Cookie: browserCookie,
        'Content-Type': 'application/x-www-form-urlencoded', ...overrides.headers };
      return new Request(endpoint, { method: 'POST', headers,
        body: overrides.body ?? new URLSearchParams({ ...values, ...overrides.values }) });
    },
  };
}

export async function confirmPortal({ request, env }) {
  const form = await prepareConfirmation(request.url, env);
  if (!form.request) return form.landing;
  return onRequestPost({ env, request: form.request() });
}
