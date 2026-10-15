// [pc2-codex-42] Pure public R36 fake vectors. No key custody/provider/runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,sha,rawKey,signPointer,verifyPointer,hmac,hmacVerify,machineSigningInput,PREFIX} from '../functions/_lib/web-job-protocol.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/web-job-r36-vectors.json',import.meta.url),'utf8'));
const key=rawKey(fixture.fake_key_hex);
const perimeter=p=>Object.fromEntries(['origin','workspace_id','channel_id','app_id','seat_id'].map(k=>[k,p[k]]));
for(const vector of fixture.vectors){
  test(`R36 Python/WebCrypto exact ${vector.name}`,async()=>{
    assert.equal(canonical(vector.payload),vector.canonical_payload_ascii);
    const wire=await signPointer(vector.payload,key,perimeter(vector.payload),vector.now);
    assert.equal(wire,vector.wire);
    const verified=await verifyPointer(wire,key,perimeter(vector.payload),vector.now);
    assert.equal(verified.job_claim_key,vector.job_claim_key);assert.equal(verified.replay_fingerprint,vector.replay_fingerprint);
    assert.deepEqual(verified.metadata,vector.payload);
    assert.equal(JSON.parse(wire.slice(PREFIX.length)).signature,vector.signature_hex);
  });
}
test('strict key, scalar, safe integer, purpose/perimeter, expiry and canonical/duplicate rejection',async()=>{
  const v=fixture.vectors[0],expected=perimeter(v.payload);
  for(const delta of [{protocol:'other'},{purpose:'result'},{job_id:'A'.repeat(32)},{nonce:['a'.repeat(32)]},{issued_at:true},{issued_at:1.1},{expires_at:1700000061},{workspace_id:['T00000001']},{actor:'private@example.invalid'},{origin:'https://example.invalid/path'}]){
    await assert.rejects(()=>signPointer({...v.payload,...delta},key,expected,v.now));
  }
  for(const wire of [v.wire+'\n',v.wire.replace('{','{ '),v.wire.replace('"job_id":','"job_id":"'+v.payload.job_id+'","job_id":'),v.wire.replace(v.signature_hex,'0'.repeat(64))])await assert.rejects(()=>verifyPointer(wire,key,expected,v.now));
  await assert.rejects(()=>verifyPointer(v.wire,key,expected,1700000060));
  await assert.rejects(()=>verifyPointer(v.wire,key,{...expected,app_id:'A00000002'},v.now));
  assert.throws(()=>rawKey('AA'.repeat(32)));assert.throws(()=>rawKey('0'.repeat(32)));
  await assert.rejects(()=>signPointer(v.payload,new Uint8Array(64),expected,v.now));
});
test('machine-request domain and route bind raw body, nonce and timestamp, not pointer authority',async()=>{
  const args=['POST','/api/assistant-web-jobs/claim','1700000000','f'.repeat(32),'{}'];
  const input=await machineSigningInput(...args),signature=await hmac(key,input);
  assert.equal(input,'legacy-web-job/v1/machine-request\0POST\n/api/assistant-web-jobs/claim\n1700000000\n'+'f'.repeat(32)+'\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  assert.equal(await hmacVerify(key,signature,input),true);
  assert.equal(await hmacVerify(key,signature,await machineSigningInput('POST','/api/assistant-web-jobs/result',...args.slice(2))),false);
  assert.equal(await hmacVerify(key,signature,input.replace('{}','other')+'x'),false);
});
test('shared accent/emoji result vector is unescaped UTF8; malformed surrogate scalars refuse',async()=>{
  const v=JSON.parse(readFileSync(new URL('./fixtures/web-job-result-unicode.json',import.meta.url),'utf8'));
  assert.equal(canonical(v.unsigned),v.canonical_utf8_json);
  assert.equal(Buffer.from(canonical(v.unsigned),'utf8').toString('hex'),v.canonical_utf8_hex);
  assert.equal(await sha(canonical(v.unsigned)),v.result_digest);
  for(const text of ['\ud800','\udfff','x\ud800end','\udc00\ud800'])assert.throws(()=>canonical({text}));
  assert.equal(canonical({text:'Café 🌿'}),'{"text":"Café 🌿"}');
});
