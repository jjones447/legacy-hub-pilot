// Tests for LEGACY-STAGING-OWN-DB-R1: preview deployments use a separate D1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..');

function readWranglerConfig() {
  const content = readFileSync(resolve(ROOT_DIR, 'wrangler.toml'), 'utf8');
  return content;
}

test('wrangler.toml binds separate and different D1 databases for production and preview', () => {
  const toml = readWranglerConfig();

  // Parse production D1 binding
  const prodMatch = toml.match(/\[\[d1_databases\]\][\s\S]*?binding\s*=\s*"([^"]+)"[\s\S]*?database_name\s*=\s*"([^"]+)"[\s\S]*?database_id\s*=\s*"([^"]+)"/);
  assert.ok(prodMatch, 'Production [[d1_databases]] block must exist in wrangler.toml');
  const [, prodBinding, prodDbName, prodDbId] = prodMatch;

  assert.equal(prodBinding, 'LEGACY_DB', 'Production D1 binding name must be LEGACY_DB');
  assert.equal(prodDbName, 'legacy-hub-db', 'Production database name must be legacy-hub-db');
  assert.equal(prodDbId, '3c06c3cb-e1a6-426c-ad85-0b8c94616ed2', 'Production database id must match live production D1');

  // Parse preview D1 binding
  const previewMatch = toml.match(/\[\[env\.preview\.d1_databases\]\][\s\S]*?binding\s*=\s*"([^"]+)"[\s\S]*?database_name\s*=\s*"([^"]+)"[\s\S]*?database_id\s*=\s*"([^"]+)"/);
  assert.ok(previewMatch, 'Preview [[env.preview.d1_databases]] block must exist in wrangler.toml');
  const [, previewBinding, previewDbName, previewDbId] = previewMatch;

  assert.equal(previewBinding, 'LEGACY_DB', 'Preview D1 binding name must be LEGACY_DB');
  assert.equal(previewDbName, 'legacy-hub-db-staging', 'Preview database name must be legacy-hub-db-staging');
  assert.equal(previewDbId, '42be536c-e354-44c7-b246-2dcac18d8ac6', 'Preview database id must match staging D1 id');

  // Assert database ids are strictly distinct
  assert.notEqual(prodDbId, previewDbId, 'Production and preview MUST bind different database IDs');
  assert.notEqual(prodDbName, previewDbName, 'Production and preview MUST bind different database names');

  // Assert comment specifies database usage per environment
  assert.match(
    toml,
    /#.*Production.*legacy-hub-db.*preview.*legacy-hub-db-staging/i,
    'wrangler.toml must include a comment stating which database each environment uses'
  );
});

test('scripts/seed-page-sections.mjs supports --staging shortcut flag', () => {
  const scriptContent = readFileSync(resolve(ROOT_DIR, 'scripts', 'seed-page-sections.mjs'), 'utf8');
  assert.match(
    scriptContent,
    /args\[i\] === '--staging'/,
    'seed-page-sections.mjs must recognize --staging flag'
  );
  assert.match(
    scriptContent,
    /databaseName = 'legacy-hub-db-staging'/,
    'seed-page-sections.mjs --staging must target legacy-hub-db-staging'
  );
});

test('scripts/agent-model-compare.mjs defaults to staging URL and warns on production', () => {
  const scriptContent = readFileSync(resolve(ROOT_DIR, 'scripts', 'agent-model-compare.mjs'), 'utf8');
  assert.match(
    scriptContent,
    /https:\/\/staging\.legacy-hub\.pages\.dev/,
    'agent-model-compare.mjs must default to staging URL'
  );
  assert.match(
    scriptContent,
    /WARNING.*production/i,
    'agent-model-compare.mjs must warn when running against production'
  );
});

test('docs/runbook-staging.md documents staging seed shortcut', () => {
  const runbook = readFileSync(resolve(ROOT_DIR, 'docs', 'runbook-staging.md'), 'utf8');
  assert.match(
    runbook,
    /seed-page-sections\.mjs\s+--staging\s+--remote/,
    'runbook-staging.md must document seed-page-sections.mjs --staging --remote'
  );
});

test('staging runbook leads with current identity qualification and labels August procedures historical', () => {
  const runbook = readFileSync(resolve(ROOT_DIR, 'docs', 'runbook-staging.md'), 'utf8');
  assert.match(runbook, /Current-use guard.*October 5, 2026/);
  assert.match(runbook, /September 29.*account move.*already recorded/);
  assert.match(runbook, /staging\.caregiversanctuary\.org.*production alias/);
  assert.match(runbook, /not proof of an isolated preview/);
  assert.match(runbook, /exact account, project, source revision, deployment, environment and D1 name plus UUID/);
  assert.match(runbook, /Legacy_Delivery_Tracker\.md/);
  assert.match(runbook, /legacy-account-setup-record\.md/);
  assert.match(runbook, /before any write, deployment or practice/);
  assert.match(runbook, /All command samples below are historical, non-executable examples for this correction scope/);
  assert.match(runbook, /no recreation or repointing is authorized by this history/);
});

test('staging runbook preserves current runtime STOP and distinct acceptance gates', () => {
  const runbook = readFileSync(resolve(ROOT_DIR, 'docs', 'runbook-staging.md'), 'utf8');
  assert.match(runbook, /Branch pushes and merges are not deployment evidence/);
  assert.match(runbook, /no additional Lead publishing approval is required/);
  assert.match(runbook, /no customer, production or shared-staging writes and no production restore/);
  assert.match(runbook, /runtime preparation remains STOP: no bypass, alternate retry or installation/);
  assert.match(runbook, /Missing or skipped real-workerd evidence is UNVERIFIED, not accepted/);
  assert.match(runbook, /source, review, CI, runtime, deployed and client-accepted states separately/);
  assert.match(runbook, /Coming Soon and reminders.*Shanelle's go through Jacob/);
  assert.match(runbook, /Do not run the historical seed, restore, installation, workerd-download or broad test commands/);
});
