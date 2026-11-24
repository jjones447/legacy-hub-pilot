// Protected by the existing /api/staff/ Access middleware AND current admin proof.
import {onRequestPost as portalLogin} from '../portal/[[path]].js';
import {testInboxEnabled,openTestInboxCapture,cleanupCapturedToken,TEST_INBOX_ORIGIN} from '../../_lib/portal-test-inbox.mjs';
import {readSupportRequestBody} from '../../_lib/portal-support-request-http.mjs';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store, private','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function onRequest({request,env,data}){
 try{
  const url=new URL(request.url);
  if(!testInboxEnabled(request,env)||url.pathname!=='/api/staff/test-inbox'||url.search)return reply({ok:false,error:'not_found'},404);
  if(request.method!=='POST')return reply({ok:false,error:'method_not_allowed'},405);
  if(request.headers.get('Origin')!==TEST_INBOX_ORIGIN)return reply({ok:false,error:'forbidden'},403);
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({ok:false,error:'invalid_content_type'},415);
  const capture=await openTestInboxCapture(request,env,data);
  if(!capture)return reply({ok:false,error:'forbidden'},403);
  const body=await readSupportRequestBody(request);
  if(!body||typeof body!=='object'||Array.isArray(body))return reply({ok:false,error:'invalid_request'},400);
  if(body.action==='cleanup'&&Object.keys(body).sort().join(',')==='action,token_hash'&&/^[a-f0-9]{64}$/.test(body.token_hash)){
   await cleanupCapturedToken(capture.cap,body.token_hash);return reply({ok:true});
  }
  if(body.action!=='request'||Object.keys(body).join(',')!=='action')return reply({ok:false,error:'invalid_request'},400);
  const headers=new Headers({'Origin':TEST_INBOX_ORIGIN,'Content-Type':'application/json'});
  const ip=request.headers.get('CF-Connecting-IP');if(ip)headers.set('CF-Connecting-IP',ip);
  const result=await portalLogin({request:new Request(TEST_INBOX_ORIGIN+'/api/portal/login',{method:'POST',headers,body:JSON.stringify({email:capture.cap.email})}),env,data:capture.context});
  if(result.status!==200||!capture.cap.message)return reply({ok:false,error:'capture_unavailable'},503);
  // This one response is the admin-only inbox. No localStorage, logs, audit body,
  // public login response, persistent plaintext table or page receives the link.
  const message=capture.cap.message;capture.cap.message=null;
  return reply({ok:true,delivery:'controlled_test_capture',...message});
 }catch{return reply({ok:false,error:'capture_unavailable'},503);}
}
