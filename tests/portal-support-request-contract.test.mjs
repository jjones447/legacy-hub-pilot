import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSupportRequest,projectSupportStatus,canAdvanceSupportStatus} from '../functions/_lib/portal-support-request-contract.mjs';
const valid=()=>({request_id:'synthetic_request_0001',needs:['resources','break'],preferred_contact:'text',message:' A fictional request. '});
test('keeps distinct choices and Text preference, canonicalizes retries without mutating caller',()=>{
 const input=valid(), result=validateSupportRequest(input);
 assert.deepEqual(result.needs,['break','resources']);assert.equal(result.preferred_contact,'text');
 assert.deepEqual(input.needs,['resources','break']);assert.equal(result.message,'A fictional request.');
 assert.equal(JSON.stringify(result),JSON.stringify(validateSupportRequest({...input,needs:['break','resources']})));
 assert.ok(Object.isFrozen(result.needs));
});
test('rejects client identity, actor, status and contact-address injection',()=>{
 for(const key of ['caregiver_id','owner','email','phone','actor','status','revision','__proto__']) {
  const input=valid();Object.defineProperty(input,key,{value:'foreign',enumerable:true});assert.equal(validateSupportRequest(input),null,key);
 }
});
test('rejects malformed, sparse, duplicate, unknown and accessor-backed choices',()=>{
 const sparse=Array(2);sparse[1]='break';
 const accessor=['break'];Object.defineProperty(accessor,0,{get(){throw Error('must not invoke');}});
 const symbol=['break'];symbol[Symbol.iterator]=()=>{throw Error('must not invoke');};
 for(const needs of [[],['break','break'],['grant'],['text'],sparse,accessor,symbol,{},'break',[null]]) assert.equal(validateSupportRequest({...valid(),needs}),null);
 const input=valid();Object.defineProperty(input,'message',{get(){throw Error('must not invoke');}});assert.equal(validateSupportRequest(input),null);
});
test('bounds values and refuses coercion or inherited body fields',()=>{
 for(const patch of [{request_id:'short'},{request_id:2},{preferred_contact:'sms'},{preferred_contact:[]},{message:'x'.repeat(2001)},{message:null},{message:'a\u0000b'}]) assert.equal(validateSupportRequest({...valid(),...patch}),null);
 assert.equal(validateSupportRequest(Object.create(valid())),null);
 assert.equal(validateSupportRequest(null),null);
 assert.ok(validateSupportRequest({...valid(),message:'x'.repeat(2000)}));
});
test('never manufactures owner status from legacy followup states or prototype properties',()=>{
 for(const s of ['open','done','dismissed','constructor','__proto__',null,{}]) assert.equal(projectSupportStatus(s),null);
 assert.deepEqual(projectSupportStatus('received'),{code:'received',label:'Received'});
 assert.equal(canAdvanceSupportStatus('received','closed'),false);
 assert.equal(canAdvanceSupportStatus('in_review','followed_up'),true);
 assert.equal(canAdvanceSupportStatus('closed','received'),false);
 assert.equal(canAdvanceSupportStatus('constructor','received'),false);
});
