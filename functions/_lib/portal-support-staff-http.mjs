import {matchesSupportSession} from './support-session-proof.mjs';
import {confirmationActor} from './agent-confirmation.mjs';
import * as store from './portal-support-request-staff.mjs';
import {readSupportRequestBody} from './portal-support-request-http.mjs';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function staffSupportRequest({request,env,data}) {
 try {
  const url=new URL(request.url);
  if(env.PORTAL_SUPPORT_REQUEST_ENABLED!=='1'||url.search||!['/api/staff/support-requests','/api/staff/support-requests/status'].includes(url.pathname))return reply({ok:false,error:'not_found'},404);
  const write=url.pathname.endsWith('/status');
  if(request.method!==(write?'POST':'GET'))return reply({ok:false,error:'method_not_allowed'},405);
  if(write&&request.headers.get('Origin')!==url.origin)return reply({ok:false,error:'forbidden'},403);
  if(write&&request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({ok:false,error:'invalid_content_type'},415);
  const actor=confirmationActor(data);
  if(!actor)return reply({ok:false,error:'forbidden'},403);
  if(!await matchesSupportSession(request,'staff',actor))return reply({ok:false,error:'session_changed'},403);
  const staff=await env.LEGACY_DB.prepare("SELECT email FROM staff_member WHERE email=? AND status='active' AND role IN ('staff','admin')").bind(actor).first();
  if(!staff)return reply({ok:false,error:'forbidden'},403);
  let result;
  if(write){
   const body=await readSupportRequestBody(request);
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!=='id,revision,status')return reply({ok:false,error:'invalid_request'},400);
   result=await store.updateSupportStatus(env.LEGACY_DB,actor,body);
  }else{
   // Ct5 owns the dedicated projection; never substitute owner-history results.
   if(typeof store.readStaffSupportRequests!=='function')return reply({ok:false,error:'projection_unavailable'},503);
   result=await store.readStaffSupportRequests(env.LEGACY_DB,actor);
  }
  return reply(result,result.ok?200:({forbidden:403,conflict:409,invalid_request:400,invalid_transition:409,outcome_unknown:503}[result.error]||503));
 }catch{return reply({ok:false,error:'unavailable'},503);}
}
