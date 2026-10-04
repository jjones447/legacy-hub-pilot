// [pc2-codex-13] Pure identity tests: no files, subprocesses, restore or providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTECTED_DATABASE_ID, checkTargetDatabase, resolveRestoreTarget, restoreDatabase
} from '../scripts/restore-from-backup.mjs';

const scratchId = '17be929b-64e8-43e0-9e0e-702775f7073a';
const changedLiveId = '22222222-3333-4444-5555-666666666666';
const scratch = { name: 'legacy-hub-restore-synthetic', uuid: scratchId };
function metadata(records) {
  return (command) => {
    assert.equal(command, 'npx wrangler d1 list --json');
    return JSON.stringify(records);
  };
}
function forbiddenCommand() {
  assert.fail('No identity lookup or execution should occur');
}

test('live name and configured UUID are refused with case and whitespace variations', () => {
  for (const target of ['legacy-hub-db', ' LEGACY-HUB-DB ', PROTECTED_DATABASE_ID,
    ` ${PROTECTED_DATABASE_ID.toUpperCase()} `]) {
    assert.throws(() => checkTargetDatabase(target), /REFUSAL/);
    assert.throws(() => resolveRestoreTarget({ targetDatabase: target, execFn: forbiddenCommand }), /REFUSAL/);
  }
});

test('explicit live UUID override is refused before metadata lookup', () => {
  assert.throws(() => resolveRestoreTarget({
    targetDatabase: scratch.name, databaseId: PROTECTED_DATABASE_ID, execFn: forbiddenCommand
  }), /live database UUID/);
});

test('resolved production name is refused even with a changed production UUID', () => {
  assert.throws(() => resolveRestoreTarget({
    targetDatabase: changedLiveId,
    execFn: metadata([{ name: 'legacy-hub-db', uuid: changedLiveId }])
  }), /live database 'legacy-hub-db'/);
});

test('scratch-looking alias to configured production UUID is refused', () => {
  assert.throws(() => resolveRestoreTarget({
    targetDatabase: scratch.name,
    execFn: metadata([{ name: scratch.name, uuid: PROTECTED_DATABASE_ID }])
  }), /live database UUID/);
});

test('duplicate metadata identity alias to live is refused', () => {
  assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name,
    execFn: metadata([scratch, { name: 'legacy-hub-db', uuid: scratchId }])
  }), /aliases the live database/);
});

test('scratch name and UUID both resolve only via verified metadata', () => {
  for (const target of [scratch.name, scratchId.toUpperCase()]) {
    assert.deepEqual(resolveRestoreTarget({ targetDatabase: target,
      execFn: metadata([scratch]) }), { name: scratch.name, uuid: scratchId });
  }
});

test('explicit safe ID must match resolved identity', () => {
  assert.deepEqual(resolveRestoreTarget({ targetDatabase: scratch.name,
    databaseId: scratchId.toUpperCase(), execFn: metadata([scratch]) }), scratch);
  assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name,
    databaseId: changedLiveId, execFn: metadata([scratch]) }), /does not match/);
});

test('custom config override is refused without reading it or running commands', () => {
  assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name,
    configPath: './unread-untrusted-config.toml', execFn: forbiddenCommand }), /Custom restore configuration/);
});

test('missing, ambiguous, malformed and failed identity lookup fail closed', () => {
  for (const records of [[], [scratch, scratch], {},
    [{ name: scratch.name, uuid: 'not-a-uuid' }], [{ name: 'unsafe name', uuid: scratchId }]]) {
    assert.throws(() => resolveRestoreTarget({ targetDatabase: scratchId,
      execFn: metadata(records) }));
  }
  for (const execFn of [() => '{invalid', () => { throw new Error('offline'); }]) {
    assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name, execFn }), /Cannot verify/);
  }
});

test('invalid CLI target or explicit ID cannot reach lookup', () => {
  for (const targetDatabase of ['scratch" --remote', 'scratch;rm', 'scratch\nname', '--remote']) {
    assert.throws(() => resolveRestoreTarget({ targetDatabase, execFn: forbiddenCommand }), /Invalid restore target/);
  }
  assert.throws(() => resolveRestoreTarget({ targetDatabase: scratch.name,
    databaseId: 'placeholder-id', execFn: forbiddenCommand }), /Invalid explicit database ID/);
});

test('restore entry refuses unsafe identity before accessing dump or SQL', async () => {
  for (const options of [
    { targetDatabase: PROTECTED_DATABASE_ID },
    { targetDatabase: scratch.name, databaseId: PROTECTED_DATABASE_ID },
    { targetDatabase: scratch.name, configPath: './unread.toml' },
    { targetDatabase: changedLiveId, execFn: metadata([{ name: 'legacy-hub-db', uuid: changedLiveId }]) }
  ]) {
    await assert.rejects(restoreDatabase({ ...options,
      execFn: options.execFn ?? forbiddenCommand, dumpDir: undefined }), /REFUSAL/);
  }
});

test('direct synthetic fixtures reject CLI overrides without accessing db', async () => {
  for (const override of [{ databaseId: scratchId }, { configPath: './unread.toml' }]) {
    await assert.rejects(restoreDatabase({ targetDatabase: scratch.name, db: {},
      ...override, dumpDir: undefined, execFn: forbiddenCommand }), /fixtures cannot carry/);
  }
});
