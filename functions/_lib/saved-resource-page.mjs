import { listSavedResources } from './domain/saved-resources.mjs';

const utf8 = new TextEncoder();
const salt = utf8.encode('legacy.portal.saved-resources.cursor.v1');

async function sessionCursorKey(secret, session) {
  if (typeof secret !== 'string' || !secret.length) throw new Error('Portal secret unavailable');
  const material = await crypto.subtle.importKey('raw', utf8.encode(secret), 'HKDF', false, ['deriveKey']);
  const info = utf8.encode(JSON.stringify([session.caregiverId, session.expiresAtMs]));
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function encodeCursor(after, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = utf8.encode(JSON.stringify(after));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const bytes = new Uint8Array(iv.length + ciphertext.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(ciphertext), iv.length);
  return 'v1.' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Only the authenticated adapter supplies session and secret. Clients supply cursor.
export async function listSavedResourcePage(db, session, secret, cursor = null) {
  let after = null;
  let key;
  if (cursor !== null) {
    if (typeof cursor !== 'string' || cursor.length > 384 || !cursor.startsWith('v1.')) {
      return { status: 'invalid_cursor' };
    }
    const hex = cursor.slice(3);
    if (hex.length <= 56 || hex.length % 2 || /[^0-9a-f]/.test(hex)) return { status: 'invalid_cursor' };
    const bytes = Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
    key = await sessionCursorKey(secret, session);
    try {
      const data = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12),
      );
      after = JSON.parse(new TextDecoder().decode(data));
    } catch (error) {
      if (error.name !== 'OperationError') throw error;
      return { status: 'invalid_cursor' };
    }
  }

  const page = await listSavedResources(db, session, after);
  if (page.status !== 'ok') return page;
  const nextCursor = page.next
    ? await encodeCursor(page.next, key ?? await sessionCursorKey(secret, session))
    : null;
  return { status: 'ok', items: page.items, nextCursor };
}
