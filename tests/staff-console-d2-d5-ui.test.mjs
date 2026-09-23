// Tests for Parts 2, 3, 4 of LEGACY-STAFF-CONSOLE-D2-D5-UI-R1 (Issue #99)
// Verifies DOM-level rendering for Caregiver Search (D2), Record Panel additions (D2),
// and Grant Workflow actions by status (D5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const STAFF_HTML = readFileSync(new URL('../staff.html', import.meta.url), 'utf8');
const STAFF_JS = readFileSync(new URL('../staff.js', import.meta.url), 'utf8');

test('staff.html contains Caregiver Search controls and table markup', () => {
  assert.ok(STAFF_HTML.includes('id="caregiverSearchPanel"'));
  assert.ok(STAFF_HTML.includes('id="caregiverSearchQuery"'));
  assert.ok(STAFF_HTML.includes('id="caregiverSearchSegment"'));
  assert.ok(STAFF_HTML.includes('id="caregiverSearchStatus"'));
  assert.ok(STAFF_HTML.includes('data-action="search-caregivers"'));
  assert.ok(STAFF_HTML.includes('id="caregiverSearchResultsBody"'));
  assert.ok(STAFF_HTML.includes('data-action="search-prev"'));
  assert.ok(STAFF_HTML.includes('data-action="search-next"'));
  assert.ok(STAFF_HTML.includes('id="caregiverSearchPagingInfo"'));
});

test('staff.html contains Wellness Grants panel and status filter', () => {
  assert.ok(STAFF_HTML.includes('id="grantsPanel"'));
  assert.ok(STAFF_HTML.includes('id="grantsStatusFilter"'));
  assert.ok(STAFF_HTML.includes('id="grantsTableBody"'));
});

test('caregiver search results render caregiver details and wire to view-caregiver', () => {
  // Extract escapeHtml
  const match = STAFF_JS.match(/function\s+escapeHtml\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(match);
  const escapeHtml = new Function(`${match[0]}; return escapeHtml;`)();

  const caregivers = [
    {
      id: 'cg_101',
      first_name: 'Elena',
      last_name: 'Rostova',
      email: 'elena@example.com',
      phone: '555-0144',
      status: 'active',
      segment_tags: '["dementia", "respite"]'
    },
    {
      id: 'cg_102',
      first_name: 'Marcus',
      last_name: 'Vance',
      email: null,
      phone: '555-0188',
      status: 'inactive',
      segment_tags: null
    }
  ];

  const rowsHtml = caregivers.map(cg => {
    const first = (cg.first_name || '').trim();
    const last = (cg.last_name || '').trim();
    const rawName = `${first} ${last}`.trim() || 'Anonymous';
    const name = escapeHtml(rawName);

    let segmentsStr = '';
    if (cg.segment_tags) {
      try {
        const parsed = JSON.parse(cg.segment_tags);
        if (Array.isArray(parsed)) {
          segmentsStr = parsed.map(s => escapeHtml(s)).join(', ');
        }
      } catch (e) {
        segmentsStr = escapeHtml(cg.segment_tags);
      }
    }

    const contact = [cg.email, cg.phone].filter(Boolean).map(escapeHtml).join(' · ') || 'None';
    const statusBadge = cg.status === 'active' ? 'badge-green' : 'badge-outline';

    return `
      <tr class="cursor-pointer" data-action="view-caregiver" data-caregiver-id="${escapeHtml(cg.id)}">
        <td><strong>${name}</strong></td>
        <td><span class="small">${contact}</span></td>
        <td><span class="badge ${statusBadge}">${escapeHtml(cg.status || 'unknown')}</span></td>
        <td><span class="small muted">${segmentsStr || 'None'}</span></td>
      </tr>
    `;
  }).join('');

  assert.ok(rowsHtml.includes('Elena Rostova'));
  assert.ok(rowsHtml.includes('data-caregiver-id="cg_101"'));
  assert.ok(rowsHtml.includes('elena@example.com · 555-0144'));
  assert.ok(rowsHtml.includes('dementia, respite'));
  assert.ok(rowsHtml.includes('badge-green'));

  assert.ok(rowsHtml.includes('Marcus Vance'));
  assert.ok(rowsHtml.includes('data-caregiver-id="cg_102"'));
  assert.ok(rowsHtml.includes('555-0188'));
  assert.ok(rowsHtml.includes('badge-outline'));
});

test('grant action buttons match grant status rules exactly', () => {
  const match = STAFF_JS.match(/function\s+escapeHtml\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  const escapeHtml = new Function(`${match[0]}; return escapeHtml;`)();

  function renderGrantRow(g) {
    let actionButtons = '';
    if (g.status === 'submitted' || g.status === 'in_review') {
      actionButtons += `<button class="btn btn-sm btn-plum btn-compact-mr" data-action="grant-review" data-grant-id="${escapeHtml(g.id)}">${g.status === 'in_review' ? 'Update Review Notes' : 'Start Review'}</button>`;
    }
    if (g.status === 'in_review') {
      actionButtons += `<button class="btn btn-sm btn-coral btn-compact-mr" data-action="grant-award" data-grant-id="${escapeHtml(g.id)}">Award</button>`;
      actionButtons += `<button class="btn btn-sm btn-outline btn-compact-mr" data-action="grant-decline" data-grant-id="${escapeHtml(g.id)}">Decline</button>`;
    }
    if (g.status === 'awarded') {
      actionButtons += `<button class="btn btn-sm btn-coral btn-compact-mr" data-action="grant-course-complete" data-grant-id="${escapeHtml(g.id)}">Mark Course Complete</button>`;
    }
    if (g.status === 'course_complete' || g.status === 'declined') {
      actionButtons += `<button class="btn btn-sm btn-outline btn-compact-mr" data-action="grant-close" data-grant-id="${escapeHtml(g.id)}">Close</button>`;
    }
    return actionButtons;
  }

  // 1. submitted: Start Review only
  const submittedHtml = renderGrantRow({ id: 1, status: 'submitted' });
  assert.ok(submittedHtml.includes('data-action="grant-review"'));
  assert.ok(submittedHtml.includes('Start Review'));
  assert.ok(!submittedHtml.includes('data-action="grant-award"'));
  assert.ok(!submittedHtml.includes('data-action="grant-decline"'));
  assert.ok(!submittedHtml.includes('data-action="grant-course-complete"'));
  assert.ok(!submittedHtml.includes('data-action="grant-close"'));

  // 2. in_review: Update Review Notes, Award, Decline
  const inReviewHtml = renderGrantRow({ id: 2, status: 'in_review' });
  assert.ok(inReviewHtml.includes('data-action="grant-review"'));
  assert.ok(inReviewHtml.includes('Update Review Notes'));
  assert.ok(inReviewHtml.includes('data-action="grant-award"'));
  assert.ok(inReviewHtml.includes('Award'));
  assert.ok(inReviewHtml.includes('data-action="grant-decline"'));
  assert.ok(inReviewHtml.includes('Decline'));
  assert.ok(!inReviewHtml.includes('data-action="grant-course-complete"'));
  assert.ok(!inReviewHtml.includes('data-action="grant-close"'));

  // 3. awarded: Mark Course Complete
  const awardedHtml = renderGrantRow({ id: 3, status: 'awarded' });
  assert.ok(awardedHtml.includes('data-action="grant-course-complete"'));
  assert.ok(awardedHtml.includes('Mark Course Complete'));
  assert.ok(!awardedHtml.includes('data-action="grant-review"'));
  assert.ok(!awardedHtml.includes('data-action="grant-award"'));
  assert.ok(!awardedHtml.includes('data-action="grant-decline"'));
  assert.ok(!awardedHtml.includes('data-action="grant-close"'));

  // 4. course_complete: Close
  const courseCompleteHtml = renderGrantRow({ id: 4, status: 'course_complete' });
  assert.ok(courseCompleteHtml.includes('data-action="grant-close"'));
  assert.ok(courseCompleteHtml.includes('Close'));
  assert.ok(!courseCompleteHtml.includes('data-action="grant-review"'));
  assert.ok(!courseCompleteHtml.includes('data-action="grant-award"'));
  assert.ok(!courseCompleteHtml.includes('data-action="grant-course-complete"'));

  // 5. declined: Close
  const declinedHtml = renderGrantRow({ id: 5, status: 'declined' });
  assert.ok(declinedHtml.includes('data-action="grant-close"'));
  assert.ok(!declinedHtml.includes('data-action="grant-award"'));
  assert.ok(!declinedHtml.includes('data-action="grant-course-complete"'));

  // 6. closed: No actions
  const closedHtml = renderGrantRow({ id: 6, status: 'closed' });
  assert.equal(closedHtml, '');
});

test('caregiver record panel template includes outcome, contact history, and forms', () => {
  // Verify staff.js includes outcome status and outcome notes rendering
  assert.match(STAFF_JS, /Outcome status/);
  assert.match(STAFF_JS, /Outcome notes/);
  assert.match(STAFF_JS, /outcome_status/);
  assert.match(STAFF_JS, /outcome_notes/);

  // Verify staff.js includes contact history rendering
  assert.match(STAFF_JS, /Contact History/);
  assert.match(STAFF_JS, /contact_history/);

  // Verify staff.js includes Edit Caregiver form with PATCH allow-list fields
  assert.match(STAFF_JS, /data-action="submit-edit-caregiver"/);
  assert.match(STAFF_JS, /name="first_name"/);
  assert.match(STAFF_JS, /name="last_name"/);
  assert.match(STAFF_JS, /name="email"/);
  assert.match(STAFF_JS, /name="phone"/);
  assert.match(STAFF_JS, /name="preferred_contact"/);
  assert.match(STAFF_JS, /name="caring_for"/);
  assert.match(STAFF_JS, /name="relationship"/);
  assert.match(STAFF_JS, /name="segment_tags"/);
  assert.match(STAFF_JS, /name="status"/);

  // Verify staff.js includes Add Contact form
  assert.match(STAFF_JS, /data-action="submit-add-contact"/);
  assert.match(STAFF_JS, /name="occurred_at"/);
  assert.match(STAFF_JS, /name="channel"/);
  assert.match(STAFF_JS, /name="direction"/);
  assert.match(STAFF_JS, /name="summary"/);
});
