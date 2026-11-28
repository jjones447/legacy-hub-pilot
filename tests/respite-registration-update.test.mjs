import { insertFixturePending, respiteFixture } from './helpers/respite-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
function setup(){
 const {raw:db}=respiteFixture();
 insertFixturePending(db);
 db.exec(`UPDATE respite_request SET status='confirmed',needs_review=0,reviewed_by='staff@example.invalid',
     reviewed_at=datetime('now'),revision=2,reviewed_revision=2;
   INSERT INTO registration(id,caregiver_id,event_id,status,source,external_ref)
     VALUES(1,'owner','session','registered','respite_owner_v1','request');
   UPDATE respite_request SET registration_id=1,revision=3,reviewed_revision=3;`);
 return db;
}
function check(fn){const db=setup();try{fn(db);}finally{db.close();}}
test('reviewed reserved attendance after session date is allowed without adding seats',()=>check(db=>{db.exec("UPDATE event SET starts_at='2000-01-01';UPDATE staff_member SET status='deactivated';UPDATE registration SET status='attended' WHERE id=1");assert.equal(db.prepare('SELECT status FROM registration').get().status,'attended');assert.equal(db.prepare('SELECT count(*) n FROM registration').get().n,1);}));
test('cancellation remains possible but generic revival cannot reuse historical review',()=>check(db=>{db.exec("UPDATE registration SET status='cancelled' WHERE id=1");assert.throws(()=>db.exec("UPDATE registration SET status='registered' WHERE id=1"),/reconfirmation/);assert.throws(()=>db.exec("UPDATE registration SET status='attended' WHERE id=1"),/reconfirmation/);assert.equal(db.prepare('SELECT status FROM registration').get().status,'cancelled');}));
test('source/reference cannot be relabeled to escape a linked respite receipt',()=>{for(const set of ["source='staff'","external_ref='another'","id=2"])check(db=>{assert.throws(()=>db.exec('UPDATE registration SET '+set),/identity locked/);assert.equal(db.prepare('SELECT id,source,external_ref FROM registration').get().external_ref,'request');});});
test('fresh-review invalidation after cancellation prevents later generic attended status',()=>check(db=>{db.exec("UPDATE registration SET status='cancelled';UPDATE respite_request SET status='pending',needs_review=1,reviewed_by=NULL,reviewed_at=NULL,reviewed_revision=NULL,revision=4");assert.throws(()=>db.exec("UPDATE registration SET status='attended'"));assert.equal(db.prepare('SELECT status FROM registration').get().status,'cancelled');}));
