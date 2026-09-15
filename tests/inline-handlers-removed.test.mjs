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
  const scriptFiles = ['app.js', 'staff.js']
    .map(f => path.join(rootDir, f))
    .filter(f => fs.existsSync(f));

  const scriptContents = scriptFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

  const unwiredActions = [];
  for (const action of declaredActions) {
    // Match the exact handler form (action === '<name>')
    const handlerPattern = new RegExp(`action\\s*===\\s*['"]${action}['"]`);
    if (!handlerPattern.test(scriptContents)) {
      unwiredActions.push(action);
    }
  }

  assert.equal(
    unwiredActions.length,
    0,
    `Found unwired data-action attributes: ${unwiredActions.join(', ')}`,
  );
});

test('single dispatch: each action is handled by exactly one listener branch across scripts loaded by staff.html', () => {
  const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
  const staffJs = fs.readFileSync(path.join(rootDir, 'staff.js'), 'utf8');
  const combined = appJs + '\n' + staffJs;

  const actionMatchRegex = /action\s*===\s*['"]([^'"]+)['"]/g;
  const actionCounts = new Map();
  let match;
  while ((match = actionMatchRegex.exec(combined)) !== null) {
    const action = match[1];
    actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
  }

  const duplicates = [];
  for (const [action, count] of actionCounts.entries()) {
    if (count > 1) {
      duplicates.push(`${action} (handled ${count} times)`);
    }
  }

  assert.equal(
    duplicates.length,
    0,
    `Found duplicate action dispatches across app.js and staff.js:\n  ${duplicates.join('\n  ')}`,
  );
});

test('exact call wiring: every action branch calls its expected function and excludes others', () => {
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

  const actionCallMap = {
    'submit-support': 'submitSupport(e)',
    'submit-membership': 'submitMembership(e)',
    'submit-grant-apply': 'submitGrantApply(e)',
    'submit-coaching-interest': 'submitCoachingInterest(e)',
    'submit-register': 'submitRegister(e)',
    'open-membership': 'openMembership()',
    'close-membership': 'closeMembership()',
    'open-grant-apply': 'openGrantApply()',
    'close-grant-apply': 'closeGrantApply()',
    'open-coaching-interest': 'openCoachingInterest()',
    'close-coaching-interest': 'closeCoachingInterest()',
    'open-register': 'openRegister(title, eventId)',
    'close-register': 'closeRegister()',
    'toggle-nav': "classList.toggle('open')",
    'demo-resource-link': 'resourceLinkPending(target)',
    'demo-grant-status': "alert('Your application status is tracked on your caregiver record. Staff and you see the same journey.')",
    'submit-portal-login': 'submitPortalLogin(e)',
    'demo-portal-login': 'submitPortalLogin(e)',
    'portal-logout': 'portalLogout()',
    'demo-view-application': "alert('Your application status, review notes and award details, all from your caregiver record.')",
    'agent-confirm': 'agentConfirm(target)',
    'agent-cancel': 'agentCancel(target)',
    'agent-send': 'agentSend()',
    'resolve-followup': 'resolveFollowup(id, e)',
    'update-attendance': 'updateAttendance(id, status, e)',
    'view-caregiver': 'viewCaregiver(id)',
    'select-event': 'selectEvent(id, title)',
  };

  // Assert every data-action value in markup has a map entry
  const unmappedActions = [];
  for (const action of declaredActions) {
    if (!Object.prototype.hasOwnProperty.call(actionCallMap, action)) {
      unmappedActions.push(action);
    }
  }
  assert.equal(
    unmappedActions.length,
    0,
    `Found data-action values in markup missing from actionCallMap: ${unmappedActions.join(', ')}`,
  );

  function extractBranchBody(content, action) {
    const pattern = new RegExp(`action\\s*===\\s*['"]${action}['"][^{]*\\{`);
    const match = pattern.exec(content);
    if (!match) return null;
    const start = match.index + match[0].length;
    const endPattern = /(\}\s*else\s*if|\}\s*\n\s*\}\);)/g;
    endPattern.lastIndex = start;
    const endMatch = endPattern.exec(content);
    if (!endMatch) return null;
    return content.slice(start, endMatch.index).trim();
  }

  const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
  const staffJs = fs.readFileSync(path.join(rootDir, 'staff.js'), 'utf8');

  for (const [action, expectedCall] of Object.entries(actionCallMap)) {
    let body = extractBranchBody(appJs, action);
    let scriptName = 'app.js';
    if (!body) {
      body = extractBranchBody(staffJs, action);
      scriptName = 'staff.js';
    }

    assert.ok(
      body,
      `Missing action branch for action === '${action}' in app.js and staff.js`,
    );

    assert.ok(
      body.includes(expectedCall),
      `Branch for '${action}' in ${scriptName} does not contain expected call '${expectedCall}'.\nBody:\n${body}`,
    );

    for (const [otherAction, otherCall] of Object.entries(actionCallMap)) {
      if (otherCall !== expectedCall) {
        assert.ok(
          !body.includes(otherCall),
          `Branch for '${action}' in ${scriptName} unexpectedly contains call '${otherCall}' from '${otherAction}'.\nBody:\n${body}`,
        );
      }
    }
  }
});
test('staff console script isolation: staff.html has zero inline script blocks with body and loads staff.js after app.js', () => {
  const staffHtml = fs.readFileSync(path.join(rootDir, 'staff.html'), 'utf8');

  const scriptTagRegex = /<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi;
  const inlineScriptsWithBody = [];
  let match;
  while ((match = scriptTagRegex.exec(staffHtml)) !== null) {
    const scriptBody = match[1].trim();
    if (scriptBody.length > 0) {
      inlineScriptsWithBody.push(scriptBody.slice(0, 80));
    }
  }

  assert.equal(
    inlineScriptsWithBody.length,
    0,
    `Found inline script blocks with a body in staff.html:\n  ${inlineScriptsWithBody.join('\n  ')}`,
  );

  const appJsIdx = staffHtml.indexOf('<script src="app.js"></script>');
  const staffJsIdx = staffHtml.indexOf('<script src="staff.js"></script>');

  assert.ok(appJsIdx !== -1, 'staff.html must include <script src="app.js"></script>');
  assert.ok(staffJsIdx !== -1, 'staff.html must include <script src="staff.js"></script>');
  assert.ok(
    staffJsIdx > appJsIdx,
    'staff.html must load staff.js after app.js',
  );
});
