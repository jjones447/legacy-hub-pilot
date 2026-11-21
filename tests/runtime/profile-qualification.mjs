// Explicit local-only harness; NOT included in unit CI or a Pages deployment.
// Run only after retained review: PROFILE_RUNTIME_LOCAL=1 PROFILE_BROWSER_MODULE=<locked playwright index.mjs> node this-file
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../..', import.meta.url));
assert.equal(process.env.PROFILE_RUNTIME_LOCAL, '1', 'Explicit local runtime opt-in required');
const browserModule = process.env.PROFILE_BROWSER_MODULE;
assert.ok(browserModule && browserModule.startsWith('/'), 'Provide the separately installed locked browser module');
assert.equal(JSON.parse(readFileSync(join(dirname(browserModule), 'package.json'))).version, '1.65.1', 'Reviewed browser-tool version only');
const browserApi = await import(pathToFileURL(browserModule));
const browserExecutable = browserApi.chromium.executablePath();
const browserLibraryPath = process.env.PROFILE_BROWSER_LIBRARY_PATH || '';
assert.ok(!browserLibraryPath || browserLibraryPath.split(':').every(path => path.startsWith('/workspace/profile-browser-tools/lib/')), 'Only isolated browser-tool library paths allowed');
const toolDir = join(root, 'node_modules/wrangler');
assert.equal(JSON.parse(readFileSync(join(toolDir, 'package.json'))).version, '4.139.0');
const { unstable_dev } = await import(pathToFileURL(join(toolDir, 'wrangler-dist/cli.js')));
const cli = join(toolDir, 'bin/wrangler.js');
// All config/state is freshly owned and private. No env-file loading, provider
// credentials, existing secret reads, remote D1 IDs or inherited cloud settings.
const scratch = mkdtempSync('/tmp/profile-local-'); chmodSync(scratch, 0o700);
const assets = join(scratch, 'assets'); mkdirSync(assets, { mode: 0o700 });
const secret = randomBytes(32).toString('hex');
const config = join(scratch, 'wrangler.json');
writeFileSync(config, JSON.stringify({ name: 'profile-local-fixture', compatibility_date: '2026-07-01',
  workers_dev: false, vars: { PROFILE_LOCAL_FIXTURE: '1', ENVIRONMENT: 'profile_local_fixture',
    PORTAL_PROFILE_ENABLED: '1', PORTAL_TOKEN_SECRET: secret },
  d1_databases: [{ binding: 'LEGACY_DB', database_name: 'profile-local-fixture', database_id: '00000000-0000-4000-8000-000000000013' }],
}), { mode: 0o600 });
const cleanEnv = { PATH: process.env.PATH, HOME: scratch, WRANGLER_SEND_METRICS: 'false', CI: '1' };
function localSql(sql) {
  const path = join(scratch, 'fixture.sql'); writeFileSync(path, sql, { mode: 0o600 });
  // Literal --local is mandatory, never parameterized by caller or response.
  try { execFileSync(process.execPath, [cli, 'd1', 'execute', 'profile-local-fixture', '--local', '--config', config,
    '--persist-to', scratch, '--file', path, '--yes'], { cwd: scratch, env: cleanEnv, stdio: 'pipe', timeout: 60000 }); }
  catch { throw Error('Local fixture SQL failed; private scratch retained'); }
}
let sql = ['0001_init.sql', '0011_staff_member.sql', 'candidates/0022_caregiver_profile.sql']
  .map(name => readFileSync(join(root, 'schema', name), 'utf8') + '\n;').join('\n');
sql += "\nINSERT INTO caregiver(id,first_name,email) VALUES ('profile_fixture_a','Fictional A','a@example.invalid'),('profile_fixture_b','Fictional B','b@example.invalid'),('profile_fixture_archived','Archived','archived@example.invalid');\nUPDATE caregiver SET status='archived' WHERE id='profile_fixture_archived';";
localSql(sql);
copyFileSync(join(root, 'caregiver-profile.js'), join(assets, 'caregiver-profile.js'));
copyFileSync(join(root, 'styles.css'), join(assets, 'styles.css'));
writeFileSync(join(assets, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional Profile persistence fixture</title><link rel="stylesheet" href="/styles.css"><main><h1>Fictional Profile persistence fixture</h1><div id="profile"></div></main><script src="/caregiver-profile.js"></script><script>window.editor=createCaregiverProfileEditor(document.getElementById("profile"),{epoch:()=>1});editor.load();</script></html>', { mode: 0o600 });
function cookie(id, expires = Date.now() + 300000) {
  const payload = id + ':' + expires;
  return encodeURIComponent(payload + ':' + createHmac('sha256', secret).update('session:' + payload).digest('hex'));
}
// No sessions, secret, HTTP headers, raw browser traces or answers are logged.
let worker, browser; const checks = [];
try {
  // Remove inherited provider credentials before the local dev API creates children.
  // This affects this dedicated harness process only, never the calling shell.
  for (const key of Object.keys(process.env)) if (!['PATH', 'LANG', 'LC_ALL', 'TMPDIR'].includes(key)) delete process.env[key];
  process.env.HOME = scratch; process.env.WRANGLER_SEND_METRICS = 'false';
  worker = await unstable_dev(join(root, 'tests/runtime/profile-worker.mjs'), {
    config, local: true, envFiles: [], persistTo: scratch, ip: '127.0.0.1', logLevel: 'none',
    experimental: { watch: false, liveReload: false, showInteractiveDevSession: false,
      disableDevRegistry: true, disableExperimentalWarning: true,
      enablePagesAssetsServiceBinding: { directory: assets } },
  });
  const origin = 'http://127.0.0.1:' + worker.port;
  const cookies = { a: cookie('profile_fixture_a'), b: cookie('profile_fixture_b') };
  async function call(value, fields, revision = 0, extra = {}) {
    return fetch(origin + '/api/portal/profile', { method: fields ? 'POST' : 'GET', redirect: 'error',
      headers: { Cookie: 'portal_session=' + value, Origin: origin, 'Content-Type': 'application/json', ...extra },
      ...(fields ? { body: JSON.stringify({ revision, fields }) } : {}), signal: AbortSignal.timeout(15000) });
  }
  for (const value of ['invalid', cookie('profile_fixture_a', Date.now() - 1000), cookie('profile_fixture_archived')]) assert.equal((await call(value)).status, 401);
  checks.push('tampered_expired_archived_refused');
  assert.equal((await fetch(origin + '/api/portal/login', { method: 'POST' })).status, 404);
  assert.equal((await fetch(origin + '/mint')).status, 404);
  assert.equal((await call(cookies.a, { zip: '53202' }, 0, { Origin: 'https://other.invalid' })).status, 403);
  checks.push('no_login_mint_cross_origin');
  browser = await browserApi.chromium.launch({ headless: true, executablePath: browserExecutable, env: { ...cleanEnv, LD_LIBRARY_PATH: browserLibraryPath } });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addCookies([{ name: 'portal_session', value: cookies.a, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage(); await page.goto(origin);
  await page.getByLabel('ZIP Code', { exact: false }).fill('53202');
  await page.getByRole('button', { name: 'Save my profile', exact: true }).click();
  await page.getByText('Your profile is saved. You can return and continue later.', { exact: true }).waitFor();
  await page.reload(); assert.equal(await page.getByLabel('ZIP Code', { exact: false }).inputValue(), '53202');
  checks.push('chromium_partial_save_reload');
  const a = await (await call(cookies.a)).json(), b = await (await call(cookies.b)).json();
  assert.equal(a.profile.revision, 1); assert.equal(b.profile.fields.zip, undefined);
  assert.equal((await call(cookies.b, { caregiver_id: 'profile_fixture_a' })).status, 400);
  const races = await Promise.all([call(cookies.a, { city: 'Fictional City' }, 1), call(cookies.a, { city: 'Other Fictional City' }, 1)]);
  assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
  checks.push('owner_isolation_revision_conflict');
  // Discard a known successful HTTP result, then GET: reconciliation, not an
  // injected transport-loss claim. The original revision is not replayed.
  await call(cookies.a, { contact_requested: 'Yes' }, 2);
  assert.equal((await (await call(cookies.a)).json()).profile.revision, 3);
  assert.equal((await call(cookies.a, { contact_requested: 'No' }, 3)).status, 200);
  checks.push('readback_reconciliation_contact_transition');
  await context.clearCookies(); await context.addCookies([{ name: 'portal_session', value: cookies.b, url: origin, httpOnly: true, sameSite: 'Strict' }]);
  await page.reload(); assert.equal(await page.getByLabel('ZIP Code', { exact: false }).inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  checks.push('second_owner_browser_resume_no_storage_mobile_width');
  await context.close();
  const evidence = { scope: 'LOCAL workerd/D1 and Chromium fixture only', source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    browser: browser.version(), checks, shared_preview_changed: false, real_mail: false, production_sessions: false,
    provider_deployment: false, actual_login_qualified: false, retained_private_scratch: scratch };
  writeFileSync(join(scratch, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(evidence));
} finally {
  if (browser) await browser.close();
  // Only this owned runtime is stopped; scratch and synthetic evidence retained.
  if (worker) await worker.stop();
}
