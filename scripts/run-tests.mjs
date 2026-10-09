// Extend the existing Node test workflow without importing runtime test modules.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const RUNTIME_TEST = 'edge-rewrite-roundtrip-workerd.test.mjs';
export const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function testPlan(mode, names) {
  if (!['unit', 'runtime'].includes(mode)) throw new Error('Choose unit or runtime explicitly.');
  if (!names.includes(RUNTIME_TEST)) throw new Error('Required runtime test is missing.');
  const tests = names.filter((name) => name.endsWith('.test.mjs')).sort();
  for (const name of tests) {
    if (name !== RUNTIME_TEST && /(?:workerd|runtime)/i.test(name)) {
      throw new Error(`Unclassified runtime test: ${name}`);
    }
    if (/[\\/]/.test(name)) throw new Error(`Expected a top-level test filename: ${name}`);
  }
  const selected = mode === 'runtime' ? [RUNTIME_TEST] : tests.filter((name) => name !== RUNTIME_TEST);
  if (!selected.length) throw new Error('Refusing an empty test selection.');
  return {
    files: selected.map((name) => `tests/${name}`),
    message: mode === 'unit'
      ? 'UNIT ONLY: real workerd runtime NOT RUN; this is not release/runtime acceptance.'
      : 'REQUIRED RUNTIME: missing tooling, startup failure and assertion failure must FAIL, never SKIP.',
  };
}

export function runTests(mode, { names, launch = spawnSync, report = console.log, env = process.env } = {}) {
  const plan = testPlan(mode, names ?? readdirSync(resolve(ROOT, 'tests')));
  report(plan.message);
  const child = launch(process.execPath, ['--test', ...plan.files], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: { ...env, LEGACY_RUN_WORKERD: mode === 'runtime' ? '1' : '0' },
  });
  if (child.error) throw child.error;
  if (child.signal || !Number.isInteger(child.status)) throw new Error('Test child did not settle normally.');
  return child.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/run-tests.mjs <unit|runtime>');
  process.exitCode = runTests(process.argv[2]);
}
