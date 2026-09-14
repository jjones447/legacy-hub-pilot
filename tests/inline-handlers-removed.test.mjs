import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('zero inline on*= handlers across all *.html, templates/*.j2, and app.js', () => {
  const htmlFiles = fs.readdirSync(rootDir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(rootDir, f));

  const templatesDir = path.join(rootDir, 'templates');
  const templateFiles = fs.readdirSync(templatesDir)
    .filter(f => f.endsWith('.j2'))
    .map(f => path.join(templatesDir, f));

  const allFiles = [...htmlFiles, ...templateFiles, path.join(rootDir, 'app.js')];
  const inlineHandlerRegex = /\son[a-z]+=/gi;
  const violations = [];

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(inlineHandlerRegex);
    if (matches && matches.length > 0) {
      violations.push({
        file: path.relative(rootDir, file),
        count: matches.length,
        matches,
      });
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found inline handlers in ${violations.length} files:\n` +
      violations.map(v => `  ${v.file}: ${v.count} handler(s) (${v.matches.join(', ')})`).join('\n'),
  );
});

test('static wiring: every data-action has matching listener in scripts', () => {
  const htmlFiles = fs.readdirSync(rootDir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(rootDir, f));

  const templatesDir = path.join(rootDir, 'templates');
  const templateFiles = fs.readdirSync(templatesDir)
    .filter(f => f.endsWith('.j2'))
    .map(f => path.join(templatesDir, f));

  const allMarkupFiles = [...htmlFiles, ...templateFiles];
  const dataActionRegex = /data-action=["']([^"']+)["']/g;
  const declaredActions = new Set();

  for (const file of allMarkupFiles) {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = dataActionRegex.exec(content)) !== null) {
      declaredActions.add(match[1]);
    }
  }

  // Load scripts where actions can be wired
  const scriptFiles = ['app.js', 'staff.html'] // staff.html has inline script block
    .map(f => path.join(rootDir, f))
    .filter(f => fs.existsSync(f));

  const scriptContents = scriptFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

  const unwiredActions = [];
  for (const action of declaredActions) {
    // Check if the action string appears in script handling (e.g. action === '...' or case '...' or [data-action="..."])
    if (!scriptContents.includes(action)) {
      unwiredActions.push(action);
    }
  }

  assert.equal(
    unwiredActions.length,
    0,
    `Found unwired data-action attributes: ${unwiredActions.join(', ')}`,
  );
});
