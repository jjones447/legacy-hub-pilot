import { insertFixturePending, respiteFixture } from './helpers/respite-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
function setup(){return respiteFixture({initialEligibility:false}).raw;}
const pending = insertFixturePending;
function profile(db, owner, fields) {
 db.prepare('INSERT INTO caregiver_profile(caregiver_id,revision,fields_json) VALUES(?,1,?)').run(owner,JSON.stringify(fields));
}
function support(db, owner) {
 db.prepare("INSERT INTO followup(caregiver_id,kind) VALUES(?,'support_request')").run(owner);
 db.prepare(`INSERT INTO portal_support_request(id,caregiver_id,request_key,payload_digest,needs_json,preferred_contact,followup_id)
  VALUES('support',?,'synthetic_support_request',?,'["break"]','phone',last_insert_rowid())`).run(owner, 'a'.repeat(64));
}
function grant(db, owner) {
 db.prepare("INSERT INTO respite_staff_eligibility(caregiver_id,enabled,revision,updated_by) VALUES(?,1,1,'staff@example.invalid')").run(owner);
}
function check(fn){const db=setup();try{fn(db);}finally{db.close();}}
test('five independent same-owner signals authorize pending rows without reserving seats', () => {
 for (const seed of [db=>profile(db,'owner',{respite_interest:'Yes'}),
    db=>profile(db,'owner',{respite_interest:'Maybe'}), db=>profile(db,'owner',{support_needs:['Respite care']}),
    db=>support(db,'owner'), db=>grant(db,'owner')]) check(db=> {
  seed(db);pending(db);assert.equal(db.prepare('SELECT count(*) n FROM registration').get().n,0);
 });
});
test('missing, negative and other-owner signals cannot grant eligibility', () => {
 for(const seed of [()=>{},db=>profile(db,'owner',{respite_interest:'No'}),
    db=>support(db,'foreign'),db=>grant(db,'foreign'),db=>profile(db,'foreign',{respite_interest:'Yes'})]) {
  check(db=>{seed(db);assert.throws(()=>pending(db),/eligibility unavailable/);});
 }
});
test('Staff revoke prevents pending creation unless an independent same-owner signal remains',()=>check(db=>{
 grant(db,'owner');
 db.exec("UPDATE respite_staff_eligibility SET enabled=0, revision=2");
 assert.throws(()=>pending(db),/eligibility unavailable/);
 support(db,'owner');pending(db);
 assert.equal(db.prepare('SELECT status FROM respite_request').get().status,'pending');
}));
test('Profile and Support removal invalidates eligibility before INSERT',()=> {
 check(db=>{profile(db,'owner',{respite_interest:'Yes'});db.exec("UPDATE caregiver_profile SET fields_json='{}'");assert.throws(()=>pending(db),/eligibility unavailable/);});
 check(db=>{support(db,'owner');db.exec("DELETE FROM portal_support_request");assert.throws(()=>pending(db),/eligibility unavailable/);});
});
test('absent prerequisite table fails closed without creating a request',()=>check(db=>{
 db.exec('DROP TABLE caregiver_profile');
 assert.throws(()=>pending(db),/no such table/);
 assert.equal(db.prepare('SELECT count(*) n FROM respite_request').get().n,0);
}));
