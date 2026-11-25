// Ephemeral TEST delivery transport. No token is stored here or exposed publicly.
import {confirmationActor} from './agent-confirmation.mjs';
export const TEST_INBOX_ORIGIN='https://customer-test.legacy-hub-5qo.pages.dev';
const capabilities=new WeakMap();
const QA=`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(c.segment_tags) AND json_type(c.segment_tags)='array' THEN c.segment_tags ELSE '[]' END) WHERE value='qa_test') AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(c.segment_tags) AND json_type(c.segment_tags)='array' THEN c.segment_tags ELSE '[]' END) WHERE value='exclude_reporting')`;
const ELIGIBLE=`FROM caregiver c JOIN staff_member s ON s.email=? AND s.role='admin' AND s.status='active' WHERE c.id=? AND LOWER(TRIM(c.email))=? AND c.status!='archived' AND ${QA} AND (SELECT COUNT(*) FROM caregiver other WHERE LOWER(TRIM(other.email))=LOWER(TRIM(c.email)) AND other.status!='archived')=1`;
export function testInboxEnabled(request,env){
 return env.ENVIRONMENT==='preview' && env.PORTAL_TEST_INBOX_ENABLED==='1' && new URL(request.url).origin===TEST_INBOX_ORIGIN
  && typeof env.PORTAL_TEST_INBOX_CAREGIVER_ID==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(env.PORTAL_TEST_INBOX_CAREGIVER_ID)
  && typeof env.PORTAL_TEST_INBOX_EMAIL==='string' && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(env.PORTAL_TEST_INBOX_EMAIL)
  && env.PORTAL_TEST_INBOX_EMAIL.length<=254;
}
export async function openTestInboxCapture(request,env,data){
 if(!testInboxEnabled(request,env))return null;
 const actor=confirmationActor(data);if(!actor)return null;
 const cap={env,actor,id:env.PORTAL_TEST_INBOX_CAREGIVER_ID,email:env.PORTAL_TEST_INBOX_EMAIL.toLowerCase().trim(),message:null};
 if(!await eligible(cap))return null;
 const context={};capabilities.set(context,cap);return {context,cap};
}
export function testInboxCapture(data,request,env){
 const cap=data && capabilities.get(data);
 return cap && cap.env===env && testInboxEnabled(request,env) && cap.id===env.PORTAL_TEST_INBOX_CAREGIVER_ID && cap.email===env.PORTAL_TEST_INBOX_EMAIL.toLowerCase().trim()?cap:null;
}
async function eligible(cap){return cap.env.LEGACY_DB.prepare(`SELECT c.id ${ELIGIBLE}`).bind(cap.actor,cap.id,cap.email).first();}
export async function insertCapturedToken(cap,hash,expiry){
 const r=await cap.env.LEGACY_DB.prepare(`INSERT INTO portal_token(token_hash,caregiver_id,expires_at,used) SELECT ?,c.id,?,0 ${ELIGIBLE}`).bind(hash,expiry,cap.actor,cap.id,cap.email).run();
 if(r?.success!==true || r?.meta?.changes!==1)throw Error('capture_unavailable');
}
export async function deliverCapturedToken(cap,link,hash,expiresAt){
 if(!await eligible(cap))throw Error('capture_unavailable');
 await cap.env.LEGACY_DB.prepare("INSERT INTO audit_log(actor,action,entity,entity_id,after_json) VALUES(?,'portal.test_capture','caregiver',?,?)").bind(cap.actor,cap.id,JSON.stringify({transport:'controlled_test_capture',ttl_seconds:300})).run();
 if(!await eligible(cap))throw Error('capture_unavailable');
 cap.message={link,token_hash:hash,expires_at:new Date(expiresAt).toISOString()};
}
export async function cleanupCapturedToken(cap,hash){
 const r=await cap.env.LEGACY_DB.prepare(`UPDATE portal_token SET used=1 WHERE token_hash=? AND caregiver_id=? AND EXISTS(SELECT c.id ${ELIGIBLE})`).bind(hash,cap.id,cap.actor,cap.id,cap.email).run();
 if(r?.success!==true || !Number.isInteger(r?.meta?.changes))throw Error('cleanup_unavailable');
 return r.meta.changes;
}
