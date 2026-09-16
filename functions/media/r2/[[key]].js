// R2 media serving endpoint per ADR 0007 section 3.
// Streams objects from the MEDIA R2 bucket with Cache-Control: public, max-age=3600
// and ETag from object.httpEtag.

const MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  json: 'application/json',
};

function getMimeType(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export async function onRequestGet(context) {
  const { request, env, params } = context;

  if (!env || !env.MEDIA || typeof env.MEDIA.get !== 'function') {
    return new Response('Not Found', { status: 404 });
  }

  let key = '';
  if (params && params.key) {
    key = Array.isArray(params.key) ? params.key.join('/') : String(params.key);
  }
  if (!key && request && request.url) {
    const url = new URL(request.url);
    const decoded = decodeURIComponent(url.pathname);
    const m = decoded.match(/^\/media\/r2\/(.+)$/);
    if (m) key = m[1];
  }

  if (!key) {
    return new Response('Not Found', { status: 404 });
  }

  try {
    const object = await env.MEDIA.get(key);
    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    if (typeof object.writeHttpMetadata === 'function') {
      object.writeHttpMetadata(headers);
    } else if (object.httpMetadata && object.httpMetadata.contentType) {
      headers.set('content-type', object.httpMetadata.contentType);
    }

    if (!headers.has('content-type')) {
      headers.set('content-type', getMimeType(key));
    }

    headers.set('cache-control', 'public, max-age=3600');
    if (object.httpEtag) {
      headers.set('etag', object.httpEtag);
    }

    return new Response(object.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    return new Response('Internal Server Error', { status: 500 });
  }
}

export const onRequest = onRequestGet;
