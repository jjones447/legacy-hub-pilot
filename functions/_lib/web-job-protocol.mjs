// [pc2-codex-42] Exact R36 counterpart. No I/O, clock, replay store or authority in this codec.
const E = new TextEncoder();
export const PREFIX = 'LEGACY_WEB_JOB_V1 ';
export const PERIMETER = ['origin','workspace_id','channel_id','app_id','seat_id'];
const PAYLOAD = ['protocol','purpose',...PERIMETER,'job_id','input_digest','nonce','issued_at','expires_at'];
export const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const exact = (v, keys) => plain(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
export const hex = v => [...new Uint8Array(v)].map(b => b.toString(16).padStart(2,'0')).join('');
export const canonical = v => JSON.stringify(order(v));
export function unicodeScalarString(v) {
  if(typeof v!=='string')return false;
  for(let i=0;i<v.length;i++){
    const c=v.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff){const next=v.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(c>=0xdc00&&c<=0xdfff)return false;
  }
  return true;
}
function order(v) {
  if(typeof v==='string'&&!unicodeScalarString(v))throw Error('web_job_protocol_refused');
  return Array.isArray(v) ? v.map(order) : plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k => {if(!unicodeScalarString(k))throw Error('web_job_protocol_refused');return [k,order(v[k])];})) : v;
}
export const sha = async v => hex(await crypto.subtle.digest('SHA-256', typeof v === 'string' ? E.encode(v) : v));
export const random128 = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const fail = () => { throw new Error('web_job_protocol_refused'); };
export function rawKey(value) { if(typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(); return Uint8Array.from(value.match(/../g),v=>parseInt(v,16)); }
async function key(k, usage) { if(!(k instanceof Uint8Array) || k.length !== 32) fail(); return crypto.subtle.importKey('raw',k,{name:'HMAC',hash:'SHA-256'},false,[usage]); }
export async function hmac(k, value) { return hex(await crypto.subtle.sign('HMAC',await key(k,'sign'),E.encode(value))); }
export async function hmacVerify(k, sig, value) { if(typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig)) return false; return crypto.subtle.verify('HMAC',await key(k,'verify'),rawKey(sig),E.encode(value)); }
function perimeter(p) {
  if(!exact(p,PERIMETER) || typeof p.origin !== 'string' || p.origin.length > 261 || !p.origin.startsWith('https://')) fail();
  const host=p.origin.slice(8),labels=host.split('.');
  if(host.length > 253 || labels.length<2 || !labels.every(x=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x)) || !/^[a-z]{2,63}$/.test(labels.at(-1))) fail();
  if(!['workspace_id','channel_id','app_id','seat_id'].every(k=>typeof p[k]==='string') || !/^T[A-Z0-9]{8,32}$/.test(p.workspace_id) || !/^[CG][A-Z0-9]{8,32}$/.test(p.channel_id) || !/^A[A-Z0-9]{8,32}$/.test(p.app_id) || p.seat_id.length>63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.seat_id)) fail();
}
export const assertPerimeter = value => perimeter(value);
function payload(p, expected, now) {
  if(!exact(p,PAYLOAD) || p.protocol !== 'legacy_web_job_v1' || p.purpose !== 'slack_pointer') fail();
  perimeter(Object.fromEntries(PERIMETER.map(k=>[k,p[k]])));perimeter(expected);
  if(PERIMETER.some(k=>p[k]!==expected[k]) || !['job_id','nonce','input_digest'].every(k=>typeof p[k]==='string') || !/^[a-f0-9]{32}$/.test(p.job_id) || !/^[a-f0-9]{32}$/.test(p.nonce) || !/^[a-f0-9]{64}$/.test(p.input_digest)) fail();
  if(![now,p.issued_at,p.expires_at].every(x=>Number.isSafeInteger(x)&&x>=0) || p.expires_at-p.issued_at<1 || p.expires_at-p.issued_at>60 || p.issued_at>now+5 || now>=p.expires_at) fail();
}
export async function signPointer(p,k,expected,now) {
  payload(p,expected,now);
  const signature=await hmac(k,'legacy-web-job/v1/slack-pointer\0'+canonical(p));
  const wire=PREFIX+canonical({...p,signature});if(wire.length>2048) fail();return wire;
}
export async function verifyPointer(wire,k,expected,now) {
  if(typeof wire !== 'string' || wire.length>2048 || /[^\x00-\x7f]/.test(wire) || !wire.startsWith(PREFIX)) fail();
  let signed;try{signed=JSON.parse(wire.slice(PREFIX.length));}catch{fail();}
  // This exact reserialization also rejects duplicate keys, escaped aliases and number spellings.
  if(!exact(signed,[...PAYLOAD,'signature']) || wire!==PREFIX+canonical(signed)) fail();
  const {signature,...p}=signed;payload(p,expected,now);
  if(!await hmacVerify(k,signature,'legacy-web-job/v1/slack-pointer\0'+canonical(p))) fail();
  return {metadata:Object.freeze(p),job_claim_key:await sha('legacy-web-job/v1/job-identity\0'+canonical(Object.fromEntries([...PERIMETER,'job_id'].map(n=>[n,p[n]])))),replay_fingerprint:await sha('legacy-web-job/v1/replay-fingerprint\0'+canonical(p))};
}
export async function machineSigningInput(method,path,timestamp,nonce,raw) {
  if(method!=='POST' || !['/api/assistant-web-jobs/claim','/api/assistant-web-jobs/result'].includes(path) || !/^(0|[1-9][0-9]{0,15})$/.test(timestamp) || !/^[a-f0-9]{32}$/.test(nonce)) fail();
  return 'legacy-web-job/v1/machine-request\0'+[method,path,timestamp,nonce,await sha(raw)].join('\n');
}
export async function boundedBody(request,max=16384) {
  const r=request.body?.getReader();if(!r) fail();const chunks=[];let n=0;
  try{for(;;){const {done,value}=await r.read();if(done)break;n+=value.byteLength;if(n>max){await r.cancel();fail();}chunks.push(value);}}finally{r.releaseLock();}
  const bytes=new Uint8Array(n);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
