import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestPost as generic} from '../functions/api/followups.js';
import {onRequestPost as staff} from '../functions/api/staff/[[path]].js';
for (const status of ['open','done','dismissed']) {
 test(`generic followup cannot replace dedicated Support status with ${status}`,async()=>{
  let writes=0;
  const env={LEGACY_DB:{prepare(){return {bind(){return {first:async()=>({status:'open',source:'portal_owner_support_request'}),run:async()=>{writes++;}};}};},batch:async()=>{writes++;}}};
  const response=await generic({env,request:new Request('https://test.invalid/api/followups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:1,status})})});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'use_support_status');assert.equal(writes,0);
 });
}
for(const status of ['done','dismissed']){
 test(`Staff Reviewed cannot change dedicated Support followup to ${status}`,async()=>{
  let writes=0;
  const env={LEGACY_DB:{prepare(){return {bind(){return {first:async()=>({status:'open',source:'portal_owner_support_request'})};}};},batch:async()=>{writes++;}}};
  const response=await staff({env,data:{},request:new Request('https://test.invalid/api/staff/followup/1/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})})});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'use_support_status');assert.equal(writes,0);
 });
}
