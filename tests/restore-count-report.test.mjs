// [pc2-codex-13] Execute only the two reporting expressions from source.
// No restore module import, CLI, subprocess, provider or database access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/restore-from-backup.mjs', import.meta.url), 'utf8');

function reportLine(marker, auditLogCount = 0) {
  const lines = source.split(/\r?\n/).filter(line => line.includes(marker));
  assert.equal(lines.length, 1, 'one reporting expression for ' + marker);
  const expression = lines[0].trim();
  assert.match(expression, /^console\.log\(`/, 'only a console reporting expression');
  assert.match(expression, /`\);$/, 'one complete reporting expression');
  const output = [];
  vm.runInNewContext(expression, {
    console: { log: value => output.push(value) },
    spotChecks: { auditLogCount },
    targetDatabase: 'legacy-hub-report-synthetic'
  }, { timeout: 1000 });
  assert.equal(output.length, 1);
  return output[0];
}

for (const count of [0, 1, 500]) {
  test('audit count ' + count + ' is not reported as original-record preservation', () => {
    const output = reportLine('  - Audit Log:', count);
    assert.ok(output.includes(count + ' entry(ies) present'));
    assert.match(output, /count only; original records not verified/);
    assert.doesNotMatch(output, /preserved/i);
  });
}

test('success footer names count verification and disclaims original-audit verification', () => {
  const output = reportLine('[RESTORE ');
  assert.match(output, /\[RESTORE ROW COUNT VERIFICATION SUCCESS\]/);
  assert.ok(output.includes("Database 'legacy-hub-report-synthetic'"));
  assert.match(output, /row counts match the backup manifest/);
  assert.match(output, /original audit records are not verified by this check/);
  assert.doesNotMatch(output, /successfully restored and verified/i);
});
