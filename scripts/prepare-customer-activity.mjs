// Existing release assembly only. No GitHub fetch, token, deployment or database.
import { readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { projectCustomerActivity } from '../functions/_lib/customer-activity.mjs';

const sourceRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
export function prepareCustomerActivity({ inputPath, reviewedSha256, packageRoot }) {
  if (!/^[a-f0-9]{64}$/.test(reviewedSha256 || '')) throw new Error('exact reviewed snapshot digest required');
  const bytes = readFileSync(inputPath);
  if (bytes.length > 100000) throw new Error('snapshot exceeds limit');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== reviewedSha256) throw new Error('snapshot does not match reviewed digest');
  const projected = projectCustomerActivity(JSON.parse(bytes.toString('utf8')));
  const root = realpathSync(packageRoot);
  if (root === sourceRoot || root.startsWith(sourceRoot + sep)) throw new Error('use a separate isolated package, not this source checkout');
  for (let parent = root; ; parent = dirname(parent)) {
    if (existsSync(join(parent, '.git'))) throw new Error('package must be outside Git worktrees');
    if (dirname(parent) === parent) break;
  }
  if (!existsSync(join(root, 'functions/api/staff/[[path]].js'))) throw new Error('existing Functions package required');
  const target = join(root, 'functions/_lib/customer-activity-snapshot.mjs');
  // Require the existing package copy and reject symlink escapes before writing.
  const actual = realpathSync(target);
  if (actual !== target || !actual.startsWith(root + sep)) throw new Error('invalid package snapshot target');
  const packaged = {format:'customer_activity_projection_v1', reviewed_sha256:sha256, data:projected};
  const content = '// Reviewed customer-safe projection; private provenance excluded.\nexport default ' + JSON.stringify(packaged) + ';\n';
  writeFileSync(target, content, 'utf8');
  if (readFileSync(target, 'utf8') !== content) throw new Error('package projection readback failed');
  return { entries: projected.entries.length, reviewed_sha256: sha256,
    projection_sha256: createHash('sha256').update(content).digest('hex') };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [inputPath, reviewedSha256, packageRoot, ...extra] = process.argv.slice(2);
    if (!inputPath || !packageRoot || extra.length) throw new Error('expected private snapshot, reviewed SHA256, isolated package root');
    console.log(JSON.stringify(prepareCustomerActivity({inputPath, reviewedSha256, packageRoot})));
  } catch { console.error('Customer activity preparation refused; verify review digest, schema and isolated package.'); process.exitCode = 1; }
}
