// Separate local build test: requires locked esbuild; not a native runtime claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildHostedProfile } from './build-profile-hosted.mjs';
const request = () => new Request('https://profile-fixture-unit.legacy-hub-5qo.pages.dev/api/portal/profile');
test('private advanced-mode bundle has exact allowlist, no external imports, and compiled wrong-origin refusal', async () => {
  const result = await buildHostedProfile();
  assert.equal(statSync(result.scratch).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(result.assets).sort(), result.receipt.files.map(f => f.name));
  for (const f of result.receipt.files) assert.equal(statSync(join(result.assets, f.name)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(join(result.assets, '_routes.json'))), { version: 1, include: ['/*'], exclude: [] });
  const source = readFileSync(join(result.assets, '_worker.js'), 'utf8');
  const compiled = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  assert.equal((await compiled.default.fetch(request(), {})).status, 403);
  assert.equal(result.receipt.externalImports, 0);
});

test('fault/race bundle is inert before any environment, DB, or asset capability access',async()=>{
  const result=await buildHostedProfile('fault');
  const source=readFileSync(join(result.assets,'_worker.js'),'utf8');
  const compiled=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const env=new Proxy({}, {get(){throw Error('unexpected capability access');}});
  for(const path of ['/','/api/portal/profile','/api/portal/login','/fault','/recover']){
    const res=await compiled.default.fetch(new Request('https://profile-fixture-381.legacy-hub-5qo.pages.dev'+path),env);
    assert.equal(res.status,403);assert.deepEqual(await res.json(),{ok:false,error:'fixture_unavailable'});
  }
  assert.equal(result.receipt.kind,'fault');assert.equal(result.receipt.externalImports,0);
});
