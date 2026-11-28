import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRespiteEligibility as project} from '../functions/_lib/respite-eligibility.mjs';
const base=()=>({profileFields:{},supportRequests:[],staffEnabled:false});
test('five approved triggers project exact persisted Profile/Support values independently',()=>{
 for(const [patch,reason] of [
  [{profileFields:{respite_interest:'Yes'}},'profile_interest_yes'],
  [{profileFields:{respite_interest:'Maybe'}},'profile_interest_maybe'],
  [{profileFields:{support_needs:['Respite care']}},'profile_support_need'],
  [{supportRequests:[{needs:['resources','break']}]},'support_break'],
  [{staffEnabled:true},'staff_enabled']])
  assert.deepEqual(project({...base(),...patch}),{ok:true,visible:true,reasons:[reason]});
});
test('negative choices, unrelated requests and lowercase fixture values cannot enable real projection',()=>{
 assert.deepEqual(project({...base(),profileFields:{respite_interest:'No',support_needs:['Emotional support or caregiver support groups']},supportRequests:[{needs:['care']}] }),{ok:true,visible:false,reasons:[]});
 assert.equal(project({...base(),profileFields:{respite_interest:'yes'}}).visible,false);
 assert.equal(project({...base(),profileFields:{respite_interest:'Prefer not to answer'}}).visible,false);
});
test('missing or malformed trusted inputs fail closed rather than treating unknown reads as negative',()=>{
 for(const patch of [{profileFields:null},{profileFields:[]},{supportRequests:null},{staffEnabled:'true'},{profileFields:{support_needs:'Respite care'}},{supportRequests:[{needs:'break'}]},{profileFields:{respite_interest:true}}])
  assert.deepEqual(project({...base(),...patch}),{ok:false,error:'unavailable'});
});
test('projection returns only reason labels and does not mutate or disclose Profile answers',()=>{
 const x={...base(),profileFields:{respite_interest:'Yes',support_needs:['Respite care'],first_name:'Fictional'},supportRequests:[{needs:['break'],message:'Private synthetic message'}],staffEnabled:true};
 const before=JSON.stringify(x);const result=project(x);assert.equal(result.reasons.length,4);assert.doesNotMatch(JSON.stringify(result),/Fictional|Private/);assert.equal(JSON.stringify(x),before);
});
