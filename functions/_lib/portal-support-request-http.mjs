// Transport-only candidate. Authentication stays in the existing portal dispatcher.
// Separate from ct5's contract/store; no runtime flag is enabled by this source.
export const SUPPORT_REQUEST_PATH = '/api/portal/support-requests';
export function supportRequestBoundary(request, env) {
  const url = new URL(request.url);
  if (env.PORTAL_SUPPORT_REQUEST_ENABLED !== '1' || url.pathname !== SUPPORT_REQUEST_PATH || url.search) return { status:404, error:'not_found' };
  if (!['GET','POST'].includes(request.method)) return { status:405, error:'method_not_allowed' };
  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return { status:403, error:'forbidden' };
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return { status:415, error:'invalid_content_type' };
  }
  return null;
}
export async function readSupportRequestBody(request, maxBytes = 8192) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks=[]; let size=0;
  try {
    while (true) {
      const {value,done}=await reader.read(); if(done) break;
      size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();return null;}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } catch {return null;} finally {reader.releaseLock();}
}
export function supportRequestStatus(result) {
  if(result.ok) return result.replayed ? 200 : 201;
  return ({invalid_request:400,unauthorized:401,idempotency_conflict:409,contact_details_required:422,unavailable:503})[result.error] ?? 503;
}
