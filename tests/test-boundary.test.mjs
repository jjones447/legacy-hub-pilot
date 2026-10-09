// Pure/source and injected-launch tests only. Never import the workerd harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { testPlan, runTests, RUNTIME_TEST, ROOT } from '../scripts/run-tests.mjs';
import { isAllowedHref, sanitizeInlineHtml } from '../functions/_content.mjs';

const names = ['z.test.mjs', RUNTIME_TEST, 'helper.mjs', 'a.test.mjs'];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('unit selection is deterministic and explicitly reports runtime NOT RUN', () => {
  const plan = testPlan('unit', names);
  assert.deepEqual(plan.files, ['tests/a.test.mjs', 'tests/z.test.mjs']);
  assert.match(plan.message, /runtime NOT RUN/);
  assert.match(plan.message, /not release\/runtime acceptance/);
});

test('runtime selection includes exactly the required harness', () => {
  assert.deepEqual(testPlan('runtime', names).files, [`tests/${RUNTIME_TEST}`]);
  assert.match(testPlan('runtime', names).message, /must FAIL, never SKIP/);
});

test('unknown modes, missing runtime, empty units and unclassified runtime tests refuse', () => {
  assert.throws(() => testPlan('all', names), /Choose unit or runtime/);
  assert.throws(() => testPlan('unit', ['a.test.mjs']), /Required runtime test is missing/);
  assert.throws(() => testPlan('unit', [RUNTIME_TEST]), /empty test selection/);
  assert.throws(() => testPlan('unit', [...names, 'new-runtime.test.mjs']), /Unclassified runtime/);
  assert.throws(() => testPlan('unit', [...names, '../elsewhere.test.mjs']), /top-level/);
});

test('real repository inventory excludes the runtime harness without importing any test', () => {
  const inventory = readdirSync(new URL('.', import.meta.url));
  const units = testPlan('unit', inventory).files;
  assert.ok(units.includes('tests/test-boundary.test.mjs'));
  assert.ok(!units.includes(`tests/${RUNTIME_TEST}`));
  assert.equal(units.length + 1, inventory.filter((name) => name.endsWith('.test.mjs')).length);
});

test('unit launch uses literal argv, disables inherited runtime opt-in and propagates failure', () => {
  let calls = 0;
  const reports = [];
  const status = runTests('unit', {
    names, env: { LEGACY_RUN_WORKERD: '1' }, report: (value) => reports.push(value),
    launch(executable, args, options) {
      calls++;
      assert.equal(executable, process.execPath);
      assert.deepEqual(args, ['--test', 'tests/a.test.mjs', 'tests/z.test.mjs']);
      assert.equal(options.shell, false);
      assert.equal(options.cwd, ROOT);
      assert.equal(options.env.LEGACY_RUN_WORKERD, '0');
      return { status: 7 };
    },
  });
  assert.equal(status, 7);
  assert.equal(calls, 1);
  assert.equal(reports.length, 1);
});

test('runtime dispatcher is verified with an inert launch, never a runtime process', () => {
  assert.equal(runTests('runtime', {
    names, env: {}, report() {}, launch(_executable, args, options) {
      assert.deepEqual(args, ['--test', `tests/${RUNTIME_TEST}`]);
      assert.equal(options.env.LEGACY_RUN_WORKERD, '1');
      return { status: 0 };
    },
  }), 0);
});

test('child errors, signals and unknown exit status fail closed without another launch', () => {
  for (const result of [{ error: new Error('spawn refused') }, { signal: 'SIGTERM', status: null }, {}]) {
    let calls = 0;
    assert.throws(() => runTests('unit', {
      names, report() {}, launch() { calls++; return result; },
    }));
    assert.equal(calls, 1);
  }
});

test('package and CI choose units; runtime has its own explicit command', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs unit');
  assert.equal(pkg.scripts['test:unit'], pkg.scripts.test);
  assert.equal(pkg.scripts['test:runtime'], 'node scripts/run-tests.mjs runtime');
  assert.equal(pkg.devDependencies.wrangler, '4.139.0');
  const workflow = read('.github/workflows/tests.yml');
  assert.match(workflow, /run: npm run test:unit/);
  assert.match(workflow, /runtime NOT RUN/);
  assert.doesNotMatch(workflow, /tests\/\*|npm (?:install|ci)|run:.*test:runtime/);
});

test('runtime harness has no skip, cache discovery, implicit installer or process-wide cleanup', () => {
  const harness = read(`tests/${RUNTIME_TEST}`);
  assert.doesNotMatch(harness, /t\.skip|_getActiveHandles|npm-cache|npx|execSync|rmSync/);
  assert.match(harness, /Installed Wrangler must match the approved source pin/);
  assert.match(harness, /node_modules', 'wrangler'/);
  assert.match(harness, /execFileSync\(process\.execPath, \[cli, \.\.\.args\]/);
});

test('runtime opt-in precedes tooling and cleanup registration precedes startup', () => {
  const harness = read(`tests/${RUNTIME_TEST}`);
  assert.ok(harness.indexOf("assert.equal(process.env.LEGACY_RUN_WORKERD") < harness.indexOf('const wrangler = await getWrangler()'));
  assert.ok(harness.indexOf('t.after(') < harness.indexOf('setupDatabase(tempDir, wrangler.cli'));
  assert.match(harness, /if \(owned\) await owned\.stop\(\)/);
  assert.ok(harness.indexOf('worker = null; // A failed stop') < harness.indexOf('await owned.stop()'));
  assert.match(harness, /t\.after\(stopWorker\)/);
  assert.match(harness, /scratch retained/);
});

test('runtime source uses a separate local fixture config and allowlisted site assets', () => {
  const harness = read(`tests/${RUNTIME_TEST}`);
  assert.match(harness, /'legacy-runtime-fixture', '--local', '--config', config/);
  assert.match(harness, /local: true/);
  assert.match(harness, /00000000-0000-4000-8000-000000000001/);
  assert.match(harness, /buildSite\(rootDir, join\(tempDir, 'assets'\)\)/);
  assert.doesNotMatch(harness, /directory: rootDir|--remote|dab02f78|3c06c3cb|42be536c/);
  assert.match(harness, /assert.equal\(sqliteFiles.length, 1/);
  assert.match(harness, /assert.equal\(Number\(result.changes\), 1/);
});

test('the real-runtime security assertion remains required, not weakened to make CI green', () => {
  const harness = read(`tests/${RUNTIME_TEST}`);
  assert.ok(harness.includes("assert.ok(html.includes('<strong>every part</strong>')"));
  assert.ok(harness.includes("assert.ok(!html.includes('<a href=\"javascript')"));
  assert.ok(harness.includes("assert.ok(html.includes('&lt;a href=&quot;javascript&colon;alert(1)&quot;&gt;inert link</a>')"));
});

test('encoded-link fixture is rejected and escaped by the pure sanitizer, not a workerd result', () => {
  assert.equal(isAllowedHref('javascript&colon;alert(1)'), false);
  assert.equal(
    sanitizeInlineHtml('<strong>every part</strong> <a href="javascript&colon;alert(1)">inert link</a>'),
    '<strong>every part</strong> &lt;a href=&quot;javascript&colon;alert(1)&quot;&gt;inert link</a>',
  );
});
