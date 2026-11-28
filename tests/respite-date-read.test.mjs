import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {readAvailableRespiteDates} from '../functions/_lib/respite-date-read.mjs';
function setup(){
 const raw=new DatabaseSync(':memory:');raw.exec(readFileSync(new URL('../schema/0001_init.sql',import.meta.url),'utf8'));
 raw.exec("ALTER TABLE event ADD COLUMN respite_review_required INTEGER DEFAULT 0; INSERT INTO caregiver(id,first_name,last_name,status) VALUES('owner','Fictional','Owner','active');");
 const state={afterRead:null};
 const db={prepare(sql){return {bind(...args){return {async first(){return raw.prepare(sql).get(...args)||null;}};},async all(){const results=raw.prepare(sql).all();state.afterRead?.();return {results};}};}};
 const add=(id,patch={})=>{const e={title:'Fictional session',starts_at:'2999-01-01',capacity:1,publish_state:'published',respite_review_required:1,...patch};raw.prepare('INSERT INTO event(id,title,type,starts_at,capacity,publish_state,respite_review_required) VALUES(?,?,\'memory_social\',?,?,?,?)').run(id,e.title,e.starts_at,e.capacity,e.publish_state,e.respite_review_required);};
 return {raw,db,state,add};
}
async function check(fn){const x=setup();try{await fn(x);}finally{x.raw.close();}}
test('date list excludes past, unmarked, unpublished and unknown/zero capacity sessions',()=>check(async({add,db})=>{
 add('valid');for(const [id,patch] of [['past',{starts_at:'2000-01-01'}],['bad-date',{starts_at:'invalid'}],['unmarked',{respite_review_required:0}],['draft',{publish_state:'draft'}],['zero',{capacity:0}],['unknown',{capacity:null}]])add(id,patch);
 assert.deepEqual((await readAvailableRespiteDates(db,'owner')).dates.map(x=>x.id),['valid']);
}));
test('registered and attended consume capacity; cancelled does not; pending requests reserve nothing',()=>check(async({add,db,raw})=>{
 for(const id of ['reserved','attended','cancelled','pending'])add(id);
 for(const [id,status] of [['reserved','registered'],['attended','attended'],['cancelled','cancelled']])raw.prepare('INSERT INTO registration(caregiver_id,event_id,status,source) VALUES(\'owner\',?,?,\'synthetic\')').run(id,status);
 raw.exec("CREATE TABLE respite_request(id TEXT,event_id TEXT,status TEXT); INSERT INTO respite_request VALUES('synthetic','pending','pending');");
 const result=await readAvailableRespiteDates(db,'owner');assert.deepEqual(result.dates.map(x=>x.id),['cancelled','pending']);
 assert.deepEqual(Object.keys(result.dates[0]),['id','title','starts_at','ends_at','location']);
}));
test('owner is rechecked after read and missing/archived identities receive no list',()=>check(async({add,db,raw,state})=>{
 add('valid');assert.equal((await readAvailableRespiteDates(db,'foreign')).error,'unauthorized');
 state.afterRead=()=>raw.exec("UPDATE caregiver SET status='archived'");assert.deepEqual(await readAvailableRespiteDates(db,'owner'),{ok:false,error:'unauthorized'});
}));
test('bounded chronological list has stable tie ordering and no writes',()=>check(async({add,db,raw})=>{
 for(let i=59;i>=0;i--)add('date_'+String(i).padStart(2,'0'));
 const before=raw.prepare('SELECT total_changes() n').get().n;const result=await readAvailableRespiteDates(db,'owner');
 assert.equal(result.dates.length,50);assert.equal(result.dates[0].id,'date_00');assert.equal(result.dates[49].id,'date_49');assert.equal(raw.prepare('SELECT total_changes() n').get().n,before);
}));
