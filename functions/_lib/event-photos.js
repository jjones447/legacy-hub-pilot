// Photo-specific storage: arbitrary R2 keys never enter the generic event-update API.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_DIMENSION = 10000;
export const MAX_PHOTO_PIXELS = 40000000;
const KEY = /^event-photos\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.(jpg|png|webp)$/;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const isEventPhotoKey = key => typeof key === 'string' && KEY.test(key);

export class PhotoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function invalid() { throw new PhotoError(400, 'Choose a valid JPEG, PNG or WebP photo.'); }
function dimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) invalid();
  if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION || width * height > MAX_PHOTO_PIXELS) {
    throw new PhotoError(400, 'Resize the photo to at most 10,000 pixels per side and 40 megapixels.');
  }
  return { width, height };
}
export function inspectPhoto(bytes, declaredType) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) invalid();
  if (bytes.length > MAX_PHOTO_BYTES) throw new PhotoError(413, 'Choose a photo smaller than 5 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let type, extension, size;
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) {
    if (view.getUint32(8) !== 13 || ascii(12, 4) !== 'IHDR') invalid();
    const depths = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
    if (!depths[bytes[25]]?.includes(bytes[24]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) invalid();
    size = dimensions(view.getUint32(16), view.getUint32(20));
    let offset = 8, imageData = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), chunk = ascii(offset + 4, 4);
      if (length > bytes.length - offset - 12) invalid();
      if (chunk === 'IHDR' && offset !== 8) invalid();
      if (chunk === 'IDAT' && length) imageData = true;
      offset += length + 12;
      if (chunk === 'IEND') {
        if (length || offset !== bytes.length) invalid();
        ended = true; break;
      }
    }
    if (!imageData || !ended) invalid();
    type = 'image/png'; extension = 'png';
  } else if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let offset = 2, scan = false;
    const sof = new Set([192,193,194,195,197,198,199,201,202,203,205,206,207]);
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      if (marker === 218) {
        if (!size || length < 6 || offset + length >= bytes.length - 2) invalid();
        scan = true; break;
      }
      if (sof.has(marker)) {
        if (size || length < 8) invalid();
        size = dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
    if (!size || !scan) invalid();
    type = 'image/jpeg'; extension = 'jpg';
  } else if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (view.getUint32(4, true) + 8 !== bytes.length) invalid();
    let offset = 12, hasFrame = false;
    while (offset + 8 <= bytes.length) {
      const chunk = ascii(offset, 4), length = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + length > bytes.length) invalid();
      if (chunk === 'VP8X' && length === 10) {
        if (bytes[start] & 2) throw new PhotoError(400, 'Choose a still JPEG, PNG or WebP photo.');
        const read24 = at => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
        size = dimensions(1 + read24(start + 4), 1 + read24(start + 7));
      } else if (chunk === 'VP8 ' && length >= 10 && !(bytes[start] & 1)
        && bytes[start + 3] === 157 && bytes[start + 4] === 1 && bytes[start + 5] === 42) {
        const frame = dimensions(view.getUint16(start + 6, true) & 16383, view.getUint16(start + 8, true) & 16383);
        if (size && (frame.width !== size.width || frame.height !== size.height)) invalid();
        size = frame; hasFrame = true;
      } else if (chunk === 'VP8L' && length >= 5 && bytes[start] === 47) {
        const bits = view.getUint32(start + 1, true);
        if (bits >>> 29) invalid();
        const frame = dimensions(1 + (bits & 16383), 1 + ((bits >>> 14) & 16383));
        if (size && (frame.width !== size.width || frame.height !== size.height)) invalid();
        size = frame; hasFrame = true;
      }
      offset = start + length + (length & 1);
    }
    if (!size || !hasFrame || offset !== bytes.length) invalid();
    type = 'image/webp'; extension = 'webp';
  } else invalid();
  if (declaredType !== type) invalid();
  return { ...size, type, extension };
}

// Bound the stream BEFORE multipart decoding; Content-Length is not trusted.
export async function photoForm(request) {
  const limit = MAX_PHOTO_BYTES + 32768;
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType) || contentType.length > 250) {
    throw new PhotoError(400, 'A photo upload must use multipart form data.');
  }
  if (Number(request.headers.get('content-length')) > limit) throw new PhotoError(413, 'Choose a photo smaller than 5 MB.');
  if (!request.body) invalid();
  const reader = request.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new PhotoError(413, 'Choose a photo smaller than 5 MB.');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let form;
  try { form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData(); }
  catch { throw new PhotoError(400, 'The photo upload was incomplete. Select the file again.'); }
  const allowed = new Set(['photo', 'alt', 'request_id', 'expected_photo_key', 'remove']);
  for (const name of form.keys()) {
    if (!allowed.has(name) || form.getAll(name).length !== 1) throw new PhotoError(400, 'Invalid photo upload fields.');
  }
  return form;
}

export async function readEventPhoto(env, event) {
  const key = event?.photo_key;
  if (!isEventPhotoKey(key) || !env.MEDIA) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  const object = await env.MEDIA.get(key);
  const type = MIME[KEY.exec(key)[1]], meta = object?.customMetadata;
  if (!object || object.size < 1 || object.size > MAX_PHOTO_BYTES || object.httpMetadata?.contentType !== type
    || meta?.kind !== 'event-photo' || meta.event_id !== event.id || !/^[a-f0-9]{64}$/.test(meta.sha256 || '')) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const headers = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (object.httpEtag) headers.etag = object.httpEtag;
  return new Response(object.body, { headers });
}
