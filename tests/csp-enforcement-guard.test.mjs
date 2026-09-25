import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequest } from '../functions/_middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

function getFunctionFiles(dir = path.join(rootDir, 'functions')) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getFunctionFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      results.push(fullPath);
    }
  }
  return results;
}

test('zero inline style attributes across all served HTML, templates, staff.js, app.js, and functions markup', () => {
  const htmlFiles = fs.readdirSync(rootDir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(rootDir, f));

  const templatesDir = path.join(rootDir, 'templates');
  const templateFiles = fs.existsSync(templatesDir)
    ? fs.readdirSync(templatesDir)
        .filter(f => f.endsWith('.j2'))
        .map(f => path.join(templatesDir, f))
    : [];

  const scriptFiles = ['staff.js', 'app.js']
    .map(f => path.join(rootDir, f))
    .filter(f => fs.existsSync(f));

  const functionFiles = getFunctionFiles();

  const allFiles = [...htmlFiles, ...templateFiles, ...scriptFiles, ...functionFiles];
  // Match style="..." in markup (ignoring element.style.x script assignments)
  const inlineStyleRegex = /style\s*=\s*["'][^"']*["']/gi;
  const violations = [];

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = content.match(inlineStyleRegex);
    if (matches && matches.length > 0) {
      violations.push({
        file: path.relative(rootDir, file),
        count: matches.length,
        samples: matches.slice(0, 5),
      });
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found inline styles in ${violations.length} file(s):\n` +
      violations.map(v => `  ${v.file}: ${v.count} occurrence(s) (sample: ${v.samples.join(', ')})`).join('\n'),
  );
});

test('zero inline on*= event handlers across all served HTML, templates, staff.js, app.js, and functions', () => {
  const htmlFiles = fs.readdirSync(rootDir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(rootDir, f));

  const templatesDir = path.join(rootDir, 'templates');
  const templateFiles = fs.existsSync(templatesDir)
    ? fs.readdirSync(templatesDir)
        .filter(f => f.endsWith('.j2'))
        .map(f => path.join(templatesDir, f))
    : [];

  const scriptFiles = ['staff.js', 'app.js']
    .map(f => path.join(rootDir, f))
    .filter(f => fs.existsSync(f));

  const functionFiles = getFunctionFiles();

  const allFiles = [...htmlFiles, ...templateFiles, ...scriptFiles, ...functionFiles];
  // Look for markup inline handlers on<event>=
  const inlineHandlerRegex = /\son[a-z]+\s*=\s*["'][^"']*["']/gi;
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
    `Found inline event handlers in ${violations.length} file(s):\n` +
      violations.map(v => `  ${v.file}: ${v.count} handler(s) (${v.matches.join(', ')})`).join('\n'),
  );
});

test('zero inline script blocks across all served HTML, templates, and functions', () => {
  const htmlFiles = fs.readdirSync(rootDir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(rootDir, f));

  const templatesDir = path.join(rootDir, 'templates');
  const templateFiles = fs.existsSync(templatesDir)
    ? fs.readdirSync(templatesDir)
        .filter(f => f.endsWith('.j2'))
        .map(f => path.join(templatesDir, f))
    : [];

  const functionFiles = getFunctionFiles();

  const allFiles = [...htmlFiles, ...templateFiles, ...functionFiles];
  // Match any script element that has inline content or lacks a src attribute
  const scriptTagRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const violations = [];

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = scriptTagRegex.exec(content)) !== null) {
      const attrs = match[1];
      const scriptBody = match[2].trim();
      if (!/\bsrc\s*=/i.test(attrs) || scriptBody.length > 0) {
        violations.push({
          file: path.relative(rootDir, file),
          sample: match[0].slice(0, 80),
        });
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found inline script blocks in ${violations.length} file(s):\n` +
      violations.map(v => `  ${v.file}: ${v.sample}`).join('\n'),
  );
});

test('zero <style> elements across all served HTML, templates, and functions', () => {
  const htmlFiles = fs.readdirSync(rootDir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(rootDir, f));

  const templatesDir = path.join(rootDir, 'templates');
  const templateFiles = fs.existsSync(templatesDir)
    ? fs.readdirSync(templatesDir)
        .filter(f => f.endsWith('.j2'))
        .map(f => path.join(templatesDir, f))
    : [];

  const functionFiles = getFunctionFiles();

  const allFiles = [...htmlFiles, ...templateFiles, ...functionFiles];
  const styleTagRegex = /<style(?:\s+[^>]*)?>([\s\S]*?)<\/style>/gi;
  const violations = [];

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = styleTagRegex.exec(content)) !== null) {
      violations.push({
        file: path.relative(rootDir, file),
        sample: match[0].slice(0, 80),
      });
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found <style> elements in ${violations.length} file(s):\n` +
      violations.map(v => `  ${v.file}: ${v.sample}`).join('\n'),
  );
});

test('middleware enforces Content-Security-Policy header and removes Report-Only', async () => {
  const request = new Request('https://legacy-hub.pages.dev/index.html');
  const next = async () => new Response('ok', { status: 200 });
  const resp = await onRequest({ request, next, env: {} });

  assert.equal(resp.headers.get('Content-Security-Policy'), EXPECTED_CSP);
  assert.equal(resp.headers.get('Content-Security-Policy-Report-Only'), null);
});

