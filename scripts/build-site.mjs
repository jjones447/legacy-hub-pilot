#!/usr/bin/env node
// Build the deployable site into dist/ (LEGACY-DEPLOY-ALLOWLIST-R1).
// Cloudflare Pages serves every file in its output directory. The repository root also
// holds docs, scripts, schema, tests and config that are not part of the site, so deploys
// use dist/, filled from the allowlist below. A new top-level file or folder is not
// deployed until it is added here.
// Functions are unaffected: Wrangler compiles ./functions from the project root.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Root-level files that browsers load: pages, their scripts and styles, and images.
const ROOT_FILE = /\.(html|css|js|png|jpe?g|gif|svg|webp|ico|webmanifest)$/i;
// Pages control files, deployed when present.
const ROOT_CONTROL_FILES = new Set(['_redirects', '_headers']);
// Folders served whole.
const SITE_DIRECTORIES = ['media'];

// Paths that must never be served. Checked after every build, independently of the
// allowlist, so widening the allowlist cannot silently ship any of these.
const FORBIDDEN_PREFIXES = [
  '.github/', 'content/', 'docs/', 'functions/', 'node_modules/', 'schema/', 'scripts/',
  'templates/', 'tests/', 'workers/',
];
const FORBIDDEN_FILE = /(^|\/)([^/]+\.md|wrangler\.toml|package(-lock)?\.json|[^/]+\.py|\.gitignore|\.dev\.vars)$/i;

function walk(dir, base) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

/** Relative (posix) paths under `root` that belong in the deployed site. */
export function selectSiteFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (ROOT_FILE.test(entry.name) || ROOT_CONTROL_FILES.has(entry.name))) {
      files.push(entry.name);
    }
  }
  for (const dir of SITE_DIRECTORIES) {
    const abs = join(root, dir);
    if (existsSync(abs) && statSync(abs).isDirectory()) files.push(...walk(abs, dir));
  }
  return files.sort();
}

/** Paths from `files` that must never be deployed. */
export function findForbidden(files) {
  return files.filter(
    (file) => FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix)) || FORBIDDEN_FILE.test(file),
  );
}

/** Rebuild `outDir` from `root`. Throws, leaving nothing deployable, if a forbidden path is selected. */
export function buildSite(root, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  const files = selectSiteFiles(root);
  const forbidden = findForbidden(files);
  if (forbidden.length) {
    throw new Error(`refusing to build: forbidden paths selected: ${forbidden.join(', ')}`);
  }
  for (const file of files) {
    const target = join(outDir, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target);
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = buildSite(root, join(root, 'dist'));
  console.log(`dist/: ${files.length} files`);
}
