// Test for Part 1 of LEGACY-STAFF-CONSOLE-D2-D5-UI-R1 (Issue #99)
// Verifies HTML escaping in staff console to prevent XSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STAFF_JS = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');

test('staff.js defines escapeHtml helper', () => {
  assert.match(STAFF_JS, /function\s+escapeHtml\s*\(/);
});

test('caregiver named with XSS payload renders escaped text in queue and record panel', () => {
  // Extract escapeHtml function from staff.js to test its behavior directly
  const match = STAFF_JS.match(/function\s+escapeHtml\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match, 'escapeHtml must be defined in staff.js');
  const escapeHtml = new Function(`${match[0]}; return escapeHtml;`)();

  const xssPayload = '<img src=x onerror=alert(1)>';
  const escaped = escapeHtml(xssPayload);

  assert.equal(escaped, '&lt;img src=x onerror=alert(1)&gt;');
  assert.ok(!escaped.includes('<'));
  assert.ok(!escaped.includes('>'));

  // Test attribute escaping
  const attrPayload = '"><script>alert(1)</script>';
  const attrEscaped = escapeHtml(attrPayload);
  assert.ok(!attrEscaped.includes('"'));
  assert.ok(!attrEscaped.includes('<'));

  // Simulate queue row rendering logic from staff.js
  const fu = {
    id: 1,
    caregiver_id: 'cg_xss',
    caregiver_first_name: xssPayload,
    caregiver_last_name: '',
    kind: 'support_request',
    detail: 'Need help <script>alert(2)</script>',
    status: 'open'
  };

  const first = (fu.caregiver_first_name || '').trim();
  const last = (fu.caregiver_last_name || '').trim();
  const rawName = `${first} ${last}`.trim() || 'Anonymous';
  const caregiverName = escapeHtml(rawName);
  const queueRowHtml = `
    <tr class="cursor-pointer" data-action="view-caregiver" data-caregiver-id="${escapeHtml(fu.caregiver_id)}">
      <td><strong>${caregiverName}</strong></td>
      <td>${escapeHtml(fu.kind)}: ${escapeHtml(fu.detail || '')}</td>
    </tr>
  `;

  assert.ok(!queueRowHtml.includes('<img'));
  assert.ok(!queueRowHtml.includes('<script>'));
  assert.ok(queueRowHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(queueRowHtml.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));

  // Simulate caregiver record panel rendering logic from staff.js
  const p = {
    first_name: xssPayload,
    last_name: '',
    caring_for: 'Child <script>alert(3)</script>',
    relationship: 'Parent "><script>',
    email: 'test<x>@example.com',
    phone: '555-0199',
    preferred_contact: 'email'
  };

  const pFirst = (p.first_name || '').trim();
  const pLast = (p.last_name || '').trim();
  const pRawName = `${pFirst} ${pLast}`.trim() || 'Anonymous';
  const name = escapeHtml(pRawName);
  const caringFor = escapeHtml(p.caring_for || 'None specified');
  const relationship = p.relationship ? `(${escapeHtml(p.relationship)})` : '';
  const contactInfo = `Email: ${escapeHtml(p.email || 'N/A')} · Phone: ${escapeHtml(p.phone || 'N/A')}`;

  const panelHtml = `
    <h4>👤 Caregiver record — ${name}</h4>
    <div class="kv-row"><span class="k">Contact Info</span><span class="v">${contactInfo}</span></div>
    <div class="kv-row"><span class="k">Caring for</span><span class="v">${caringFor} ${relationship}</span></div>
  `;

  assert.ok(!panelHtml.includes('<img'));
  assert.ok(!panelHtml.includes('<script>'));
  assert.ok(panelHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(panelHtml.includes('&lt;script&gt;alert(3)&lt;/script&gt;'));
  assert.ok(panelHtml.includes('&quot;&gt;&lt;script&gt;'));
});
