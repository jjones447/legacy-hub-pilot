// Builds ONLY a private local artifact. No network, credentials, deploy or migration.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../..', import.meta.url));
export async function buildHostedProfile(kind = 'owner') {
  assert.ok(['owner', 'fault'].includes(kind));
  assert.equal(JSON.parse(readFileSync(join(root, 'node_modules/esbuild/package.json'))).version, '0.28.1');
  const scratch = mkdtempSync('/tmp/profile-hosted-build-'); chmodSync(scratch, 0o700);
  const assets = join(scratch, 'assets'); mkdirSync(assets, { mode: 0o700 });
  const bundled = await build({ absWorkingDir: root, entryPoints: [kind === 'fault' ? 'tests/runtime/profile-hosted-fault-worker.mjs' : 'tests/runtime/profile-hosted-worker.mjs'],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true,
    sourcemap: false, legalComments: 'none', logLevel: 'silent' });
  assert.equal(bundled.outputFiles.length, 1);
  assert.ok(Object.keys(bundled.metafile.inputs).every(path => path.startsWith('functions/') || path.startsWith('tests/runtime/profile-hosted-')));
  assert.ok(Object.values(bundled.metafile.outputs).every(output => output.imports.length === 0));
  writeFileSync(join(assets, '_worker.js'), bundled.outputFiles[0].contents, { mode: 0o600 });
  for (const name of ['caregiver-profile.js', 'styles.css']) writeFileSync(join(assets, name), readFileSync(join(root, name)), { mode: 0o600 });
  writeFileSync(join(assets, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional Profile persistence fixture</title><link rel="stylesheet" href="/styles.css"><main><h1>Fictional Profile persistence fixture</h1><div id="profile"></div></main><script src="/caregiver-profile.js"></script><script src="/fixture-start.js"></script></html>', { mode: 0o600 });
  writeFileSync(join(assets, 'fixture-start.js'), "const editor = createCaregiverProfileEditor(document.getElementById('profile'), { epoch: () => 1 }); editor.load();\n", { mode: 0o600 });
  // Advanced-mode worker must intercept EVERY route; no fall-through static bypass.
  writeFileSync(join(assets, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: [] }), { mode: 0o600 });
  const names = readdirSync(assets).sort();
  assert.deepEqual(names, ['_routes.json', '_worker.js', 'caregiver-profile.js', 'fixture-start.js', 'index.html', 'styles.css']);
  const receipt = { kind, files: names.map(name => ({ name, sha256: createHash('sha256').update(readFileSync(join(assets, name))).digest('hex') })),
    inputs: Object.keys(bundled.metafile.inputs).sort(), externalImports: 0, mode: 'source-pinned-manifest-requires-exact-review' };
  writeFileSync(join(scratch, 'bundle-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  return { scratch, assets, receipt };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildHostedProfile();
  console.log(JSON.stringify({ assets: result.assets, files: result.receipt.files, externalImports: 0 }));
}
