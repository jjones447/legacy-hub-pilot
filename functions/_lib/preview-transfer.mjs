// Authenticate cross-environment proposals independently of public version hashes.
// Use a dedicated random secret in both existing deployment environments.
// Missing configuration fails closed; never reuse other application credentials.
export const PREVIEW_TRANSFER_TTL_SECONDS = 300;
const PRODUCTION_ORIGINS = new Set([
  'https://caregiversanctuary.org',
  'https://www.caregiversanctuary.org',
  'https://legacy-hub-5qo.pages.dev',
]);
export const isPreviewTransferSource = origin => PRODUCTION_ORIGINS.has(origin);
export function previewTransferConfigured(env) {
  return typeof env?.PREVIEW_TRANSFER_SECRET === 'string'
    && env.PREVIEW_TRANSFER_SECRET.length >= 32
    && env.PREVIEW_TRANSFER_SECRET.length <= 512;
}
async function transferKey(env, usage) {
  if (!previewTransferConfigured(env)) return null;
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.PREVIEW_TRANSFER_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
export async function signPreviewTransfer(token, env) {
  const key = await transferKey(env, 'sign');
  if (!key) return null;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyPreviewTransfer(token, signature, env) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const key = await transferKey(env, 'verify');
  if (!key) return false;
  const bytes = Uint8Array.from(signature.match(/../g), hex => parseInt(hex, 16));
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(token));
}
