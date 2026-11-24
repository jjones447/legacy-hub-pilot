import test from 'node:test';import assert from 'node:assert/strict';
import {onRequestGet,onRequestPost} from '../functions/api/staff/[[path]].js';
import {setVerifiedAccessStaffActor} from '../functions/_lib/agent-confirmation.mjs';
async function call({method='GET',path='/api/staff/support-requests',flag='1',proof=true,active=true,origin='https://test.invalid',body={id:'x',revision:1,status:'in_review'}}={}){
 let reads=0;const data={};if(proof)setVerifiedAccessStaffActor(data,'staff@example.invalid');
 const env={PORTAL_SUPPORT_REQUEST_ENABLED:flag,LEGACY_DB:{
 prepare(){reads++;return {bind(){return {async first(){return active?{email:'staff@example.invalid'}:null;}};}};}
 }};
 const request=new Request('https://test.invalid'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 const response=await(method==='GET'?onRequestGet:onRequestPost)({request,env,data});assert.equal(response.headers.get('Cache-Control'),'no-store');return{response,reads};
}
test('Staff Support flag/path/query guards refuse before storage',async()=>{for(const options of [{flag:'0'},{path:'/api/staff/support-requests?owner=x'},{path:'/api/staff/support-requests/extra'}]){const {response,reads}=await call(options);assert.equal(response.status,404);assert.equal(reads,0);}});
test('Staff Support requires real verified proof and current active role',async()=>{assert.equal((await call({proof:false})).response.status,403);assert.equal((await call({active:false})).response.status,403);});
test('Staff status requires same origin and rejects caller authority fields',async()=>{assert.equal((await call({method:'POST',path:'/api/staff/support-requests/status',origin:'https://evil.invalid'})).response.status,403);assert.equal((await call({method:'POST',path:'/api/staff/support-requests/status',body:{id:'x',revision:1,status:'in_review',actor:'admin'}})).response.status,400);});

test('actual Staff dispatcher status write uses verified actor and preserves CAS/audit',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync}=await import('node:fs');
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 raw.exec(readFileSync(new URL('../schema/0001_init.sql',import.meta.url),'utf8'));
 raw.exec("CREATE TABLE staff_member(email TEXT PRIMARY KEY,status TEXT,role TEXT);INSERT INTO staff_member VALUES('staff@example.invalid','active','staff');INSERT INTO caregiver(id,first_name,status)VALUES('owner','Fictional','active');INSERT INTO followup(id,caregiver_id,kind)VALUES(1,'owner','support_request');");
 raw.exec(readFileSync(new URL('../schema/candidates/portal_support_request.sql',import.meta.url),'utf8'));
 raw.prepare('INSERT INTO portal_support_request(id,caregiver_id,request_key,payload_digest,needs_json,preferred_contact,followup_id)VALUES(?,?,?,?,?,?,?)').run('req','owner','synthetic_request_123','a'.repeat(64),'["break"]','email',1);
 const db={prepare(sql){return{bind(...args){return{sql,args,async first(){return raw.prepare(sql).get(...args)||null;}};}};},async batch(rows){raw.exec('BEGIN');try{const results=rows.map(r=>({meta:raw.prepare(r.sql).run(...r.args)}));raw.exec('COMMIT');return results;}catch(e){raw.exec('ROLLBACK');throw e;}}};
 const data={};setVerifiedAccessStaffActor(data,'staff@example.invalid');const env={LEGACY_DB:db,PORTAL_SUPPORT_REQUEST_ENABLED:'1'};
 const send=()=>onRequestPost({env,data,request:new Request('https://test.invalid/api/staff/support-requests/status',{method:'POST',headers:{Origin:'https://test.invalid','Content-Type':'application/json'},body:JSON.stringify({id:'req',revision:1,status:'in_review'})})});
 assert.equal((await send()).status,200);assert.equal((await send()).status,409);
 assert.equal(raw.prepare('SELECT revision FROM portal_support_request').get().revision,2);
 assert.equal(raw.prepare('SELECT count(*) n FROM audit_log').get().n,1);
});
