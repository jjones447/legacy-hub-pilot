function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let currentEventId = null;
let currentEventTitle = '';
let currentSearchOffset = 0;
const searchLimit = 10;
let totalSearchResults = 0;

function searchPrev() {
  if (currentSearchOffset > 0) {
    searchCaregivers(Math.max(0, currentSearchOffset - searchLimit));
  }
}

function searchNext() {
  if (currentSearchOffset + searchLimit < totalSearchResults) {
    searchCaregivers(currentSearchOffset + searchLimit);
  }
}

async function searchCaregivers(offset = 0) {
  currentSearchOffset = offset;
  const q = document.getElementById('caregiverSearchQuery')?.value?.trim() || '';
  const segment = document.getElementById('caregiverSearchSegment')?.value?.trim() || '';
  const status = document.getElementById('caregiverSearchStatus')?.value?.trim() || '';

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (segment) params.set('segment', segment);
  if (status) params.set('status', status);
  params.set('limit', String(searchLimit));
  params.set('offset', String(offset));

  try {
    const res = await fetch(`/api/staff/caregivers?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to search caregivers');

    const body = document.getElementById('caregiverSearchResultsBody');
    const pagingInfo = document.getElementById('caregiverSearchPagingInfo');
    const prevBtn = document.getElementById('caregiverSearchPrevBtn');
    const nextBtn = document.getElementById('caregiverSearchNextBtn');

    totalSearchResults = data.total || 0;

    if (!data.caregivers || data.caregivers.length === 0) {
      if (body) body.innerHTML = '<tr><td colspan="4" class="text-center muted small">No caregivers found matching criteria.</td></tr>';
      if (pagingInfo) pagingInfo.textContent = '0 caregivers';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    if (body) {
      body.innerHTML = data.caregivers.map(cg => {
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
    }

    const start = totalSearchResults > 0 ? offset + 1 : 0;
    const end = Math.min(offset + data.caregivers.length, totalSearchResults);
    if (pagingInfo) {
      pagingInfo.textContent = `Showing ${start}-${end} of ${totalSearchResults} caregiver(s)`;
    }
    if (prevBtn) prevBtn.disabled = offset <= 0;
    if (nextBtn) nextBtn.disabled = offset + searchLimit >= totalSearchResults;
  } catch (e) {
    console.error(e);
  }
}

async function loadStaffConsole() {
  await Promise.all([loadFollowups(), loadEvents(), loadGrants(), searchCaregivers(0)]);
  if (currentEventId) {
    await loadRegistrations(currentEventId, currentEventTitle);
  }
}

async function loadGrants() {
  const statusFilter = document.getElementById('grantsStatusFilter')?.value || '';
  const url = statusFilter ? `/api/grants?status=${encodeURIComponent(statusFilter)}` : '/api/grants';
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to fetch grants');

    const body = document.getElementById('grantsTableBody');
    if (!body) return;
    if (!data.grants || data.grants.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="text-center muted small">No grant applications found.</td></tr>';
      return;
    }

    body.innerHTML = data.grants.map(g => {
      const first = (g.caregiver_first_name || '').trim();
      const last = (g.caregiver_last_name || '').trim();
      const rawName = `${first} ${last}`.trim() || 'Anonymous';
      const caregiverName = escapeHtml(rawName);

      let gBadge = 'badge-plum';
      if (g.status === 'in_review') gBadge = 'badge-amber';
      if (g.status === 'awarded') gBadge = 'badge-green';
      if (g.status === 'course_complete') gBadge = 'badge-green';
      if (g.status === 'closed') gBadge = 'badge-outline';
      if (g.status === 'declined') gBadge = 'badge-outline';
      const label = g.status === 'course_complete' ? 'Course complete' : g.status;

      let awardText = 'None';
      if (g.award_amount) {
        awardText = escapeHtml(g.award_amount);
        if (g.award_care_package) awardText += ` (${escapeHtml(g.award_care_package)})`;
      }

      return `
        <tr class="cursor-pointer" data-action="view-caregiver" data-caregiver-id="${escapeHtml(g.caregiver_id)}">
          <td><strong>${caregiverName}</strong></td>
          <td>${escapeHtml(g.requested_for || 'General')}</td>
          <td><span class="badge ${gBadge}">${escapeHtml(label)}</span></td>
          <td><span class="small">${awardText}</span></td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
  }
}

async function handleGrantReview(grantId, target) {
  const notes = window.prompt('Enter review notes:');
  if (notes === null) return;
  try {
    const res = await fetch(`/api/grants/${grantId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_notes: notes })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showGrantError(target, data.error || 'Failed to update review');
      return;
    }
    const panel = document.getElementById('caregiverRecordPanel');
    if (panel && panel.dataset.caregiverId) {
      await viewCaregiver(panel.dataset.caregiverId);
    }
    await loadGrants();
  } catch (e) {
    showGrantError(target, e.message);
  }
}

async function handleGrantAward(grantId, target) {
  const amount = window.prompt('Award amount (e.g. $500):', '$500');
  if (amount === null) return;
  const carePackage = window.prompt('Care package description:', 'Respite support');
  if (carePackage === null) return;
  try {
    const res = await fetch(`/api/grants/${grantId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'awarded', amount, care_package: carePackage })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showGrantError(target, data.error || 'Failed to award grant');
      return;
    }
    const panel = document.getElementById('caregiverRecordPanel');
    if (panel && panel.dataset.caregiverId) {
      await viewCaregiver(panel.dataset.caregiverId);
    }
    await loadGrants();
  } catch (e) {
    showGrantError(target, e.message);
  }
}

async function handleGrantDecline(grantId, target) {
  if (!window.confirm('Are you sure you want to decline this application?')) return;
  try {
    const res = await fetch(`/api/grants/${grantId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'declined' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showGrantError(target, data.error || 'Failed to decline grant');
      return;
    }
    const panel = document.getElementById('caregiverRecordPanel');
    if (panel && panel.dataset.caregiverId) {
      await viewCaregiver(panel.dataset.caregiverId);
    }
    await loadGrants();
  } catch (e) {
    showGrantError(target, e.message);
  }
}

async function handleGrantCourseComplete(grantId, target) {
  try {
    const res = await fetch(`/api/grants/${grantId}/course_complete`, {
      method: 'POST'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showGrantError(target, data.error || 'Failed to mark course complete');
      return;
    }
    const panel = document.getElementById('caregiverRecordPanel');
    if (panel && panel.dataset.caregiverId) {
      await viewCaregiver(panel.dataset.caregiverId);
    }
    await loadGrants();
  } catch (e) {
    showGrantError(target, e.message);
  }
}

async function handleGrantClose(grantId, target) {
  const outcome = window.prompt('Outcome notes for closing grant:');
  if (outcome === null) return;
  try {
    const res = await fetch(`/api/grants/${grantId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showGrantError(target, data.error || 'Failed to close grant');
      return;
    }
    const panel = document.getElementById('caregiverRecordPanel');
    if (panel && panel.dataset.caregiverId) {
      await viewCaregiver(panel.dataset.caregiverId);
    }
    await loadGrants();
  } catch (e) {
    showGrantError(target, e.message);
  }
}

function showGrantError(target, msg) {
  const banner = target?.closest('.grant-row')?.querySelector('.grant-error-banner');
  if (banner) {
    banner.textContent = msg;
    banner.style.display = 'block';
  } else {
    alert(msg);
  }
}

async function submitEditCaregiver(form) {
  const panel = document.getElementById('caregiverRecordPanel');
  const caregiverId = panel?.dataset?.caregiverId;
  if (!caregiverId) return;

  const errBox = form.querySelector('.form-error-msg');
  if (errBox) errBox.style.display = 'none';

  const rawTags = form.querySelector('[name="segment_tags"]')?.value || '';
  const parsedTags = rawTags.split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    first_name: form.querySelector('[name="first_name"]')?.value?.trim() || '',
    last_name: form.querySelector('[name="last_name"]')?.value?.trim() || '',
    email: form.querySelector('[name="email"]')?.value?.trim() || '',
    phone: form.querySelector('[name="phone"]')?.value?.trim() || '',
    preferred_contact: form.querySelector('[name="preferred_contact"]')?.value || 'email',
    caring_for: form.querySelector('[name="caring_for"]')?.value?.trim() || '',
    relationship: form.querySelector('[name="relationship"]')?.value?.trim() || '',
    segment_tags: parsedTags,
    status: form.querySelector('[name="status"]')?.value || 'active',
    outcome_status: form.querySelector('[name="outcome_status"]')?.value || null,
    outcome_notes: form.querySelector('[name="outcome_notes"]')?.value?.trim() || ''
  };

  try {
    const res = await fetch(`/api/staff/caregiver/${caregiverId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (errBox) {
        errBox.textContent = data.error || 'Failed to update caregiver';
        errBox.style.display = 'block';
      } else {
        alert(data.error || 'Failed to update caregiver');
      }
      return;
    }
    await viewCaregiver(caregiverId);
    await searchCaregivers(currentSearchOffset);
  } catch (e) {
    if (errBox) {
      errBox.textContent = e.message;
      errBox.style.display = 'block';
    } else {
      alert(e.message);
    }
  }
}

async function submitAddContact(form) {
  const panel = document.getElementById('caregiverRecordPanel');
  const caregiverId = panel?.dataset?.caregiverId;
  if (!caregiverId) return;

  const errBox = form.querySelector('.form-error-msg');
  if (errBox) errBox.style.display = 'none';

  let occurredAt = form.querySelector('[name="occurred_at"]')?.value;
  if (occurredAt) {
    occurredAt = new Date(occurredAt).toISOString();
  } else {
    occurredAt = new Date().toISOString();
  }

  const payload = {
    occurred_at: occurredAt,
    channel: form.querySelector('[name="channel"]')?.value || 'phone',
    direction: form.querySelector('[name="direction"]')?.value || 'outbound',
    summary: form.querySelector('[name="summary"]')?.value?.trim() || ''
  };

  try {
    const res = await fetch(`/api/staff/caregiver/${caregiverId}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (errBox) {
        errBox.textContent = data.error || 'Failed to record contact';
        errBox.style.display = 'block';
      } else {
        alert(data.error || 'Failed to record contact');
      }
      return;
    }
    await viewCaregiver(caregiverId);
  } catch (e) {
    if (errBox) {
      errBox.textContent = e.message;
      errBox.style.display = 'block';
    } else {
      alert(e.message);
    }
  }
}


async function loadFollowups() {
  try {
    const res = await fetch('/api/staff/queue');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to fetch queue');
    
    const body = document.getElementById('needsAttentionBody');
    if (!body) return;
    if (!data.queue || data.queue.length === 0) {
      body.innerHTML = '<tr><td colspan="3" class="text-center muted small">No follow-ups in queue.</td></tr>';
      return;
    }
    
    body.innerHTML = data.queue.map(fu => {
      const first = (fu.caregiver_first_name || '').trim();
      const last = (fu.caregiver_last_name || '').trim();
      const rawName = `${first} ${last}`.trim() || 'Anonymous';
      const caregiverName = escapeHtml(rawName);
      const badgeClass = fu.status === 'open' ? 'badge-plum' : 'badge-green';
      const statusText = fu.status === 'open' ? 'Queued' : 'Resolved';
      
      let actionHtml = '';
      if (fu.status === 'open') {
        actionHtml = `<button class="btn btn-sm btn-coral btn-compact-ml" data-action="resolve-followup" data-followup-id="${escapeHtml(fu.id)}">Resolve</button>`;
      }
      
      return `
        <tr class="cursor-pointer" data-action="view-caregiver" data-caregiver-id="${escapeHtml(fu.caregiver_id)}">
          <td><strong>${caregiverName}</strong></td>
          <td>${escapeHtml(fu.kind)}: ${escapeHtml(fu.detail || '')}</td>
          <td>
            <span class="badge ${badgeClass}">${statusText}</span>
            ${actionHtml}
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
  }
}

async function resolveFollowup(id, event) {
  if (event) event.stopPropagation();
  try {
    const res = await fetch(`/api/staff/followup/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' })
    });
    if (res.ok) {
      await loadFollowups();
      const panel = document.getElementById('caregiverRecordPanel');
      if (panel && panel.dataset.caregiverId) {
        await viewCaregiver(panel.dataset.caregiverId);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

async function viewCaregiver(id) {
  try {
    const res = await fetch(`/api/staff/caregiver/${id}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to fetch caregiver record');

    const panel = document.getElementById('caregiverRecordPanel');
    if (!panel) return;

    panel.dataset.caregiverId = id;

    const p = data.profile;
    const first = (p.first_name || '').trim();
    const last = (p.last_name || '').trim();
    const rawName = `${first} ${last}`.trim() || 'Anonymous';
    const name = escapeHtml(rawName);
    
    const memberBadge = p.sanctuary_member === 1 
      ? `<span class="badge badge-green">Sanctuary Member</span>` 
      : `<span class="badge badge-outline">Non-member</span>`;

    const statusBadge = `<span class="badge ${p.status === 'active' ? 'badge-green' : 'badge-outline'}">${escapeHtml(p.status || 'active')}</span>`;

    const caringFor = escapeHtml(p.caring_for || 'None specified');
    const relationship = p.relationship ? `(${escapeHtml(p.relationship)})` : '';
    const memberSince = p.member_since ? escapeHtml(p.member_since.split(' ')[0]) : 'N/A';

    const programList = data.registrations.map(r => r.event_title).filter(Boolean);
    const uniquePrograms = Array.from(new Set(programList)).map(t => escapeHtml(t)).join(' · ') || 'None';

    // Segment tags
    let segmentTagsList = [];
    if (p.segment_tags) {
      try {
        const parsed = JSON.parse(p.segment_tags);
        if (Array.isArray(parsed)) segmentTagsList = parsed;
      } catch (e) {
        segmentTagsList = [p.segment_tags];
      }
    }
    const segmentTagsDisplay = segmentTagsList.map(s => escapeHtml(s)).join(', ') || 'None';
    const segmentTagsFormVal = segmentTagsList.join(', ');

    // Grants and workflow actions
    let grantsHtml = '<div class="small muted">None</div>';
    if (data.grants && data.grants.length > 0) {
      grantsHtml = data.grants.map(g => {
        let gBadge = 'badge-plum';
        if (g.status === 'in_review') gBadge = 'badge-amber';
        if (g.status === 'awarded') gBadge = 'badge-green';
        if (g.status === 'course_complete') gBadge = 'badge-green';
        if (g.status === 'closed') gBadge = 'badge-outline';
        if (g.status === 'declined') gBadge = 'badge-outline';
        const label = g.status === 'course_complete' ? 'Course complete' : g.status;
        let awardInfo = g.award_amount ? ` — Award: ${escapeHtml(g.award_amount)}` : '';
        if (g.award_care_package) awardInfo += ` (${escapeHtml(g.award_care_package)})`;

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

        return `
          <div class="grant-row" data-grant-id="${escapeHtml(g.id)}" style="padding: 10px; border: 1px solid #efdfd3; border-radius: 8px; margin-bottom: 8px; background: #fff;">
            <div>
              <strong>${escapeHtml(g.requested_for || 'Wellness grant')}</strong>
              <span class="badge ${gBadge}">${escapeHtml(label)}</span>${awardInfo}
            </div>
            ${g.review_notes ? `<div class="small muted mt-4">Review notes: ${escapeHtml(g.review_notes)}</div>` : ''}
            ${actionButtons ? `<div class="grant-actions" style="margin-top: 6px;">${actionButtons}</div>` : ''}
            <div class="grant-error-banner alert-inline-banner" style="display:none; color: #a84a32; background: #f9efdc; margin-top: 6px; padding: 6px; border-radius: 4px; font-size: 12.5px;"></div>
          </div>
        `;
      }).join('');
    }

    const attendedEvents = data.registrations.filter(r => r.status === 'attended');
    const lastAttended = attendedEvents.length > 0 
      ? `${escapeHtml(attendedEvents[0].event_title)} · ${escapeHtml(attendedEvents[0].event_starts_at.split(' ')[0])}`
      : 'N/A';

    const socialsCount = data.registrations.filter(r => r.status === 'attended').length;

    const notesHtml = data.notes.map(n => `<div><strong>${escapeHtml(n.author)}:</strong> ${escapeHtml(n.body)} <span class="small muted">(${escapeHtml(n.created_at.split(' ')[0])})</span></div>`).join('<br>') || 'None';

    const contactInfo = `Email: ${escapeHtml(p.email || 'N/A')} · Phone: ${escapeHtml(p.phone || 'N/A')} (Prefers: ${escapeHtml(p.preferred_contact || 'email')})`;

    // Outcome status & notes
    const outcomeStatusText = p.outcome_status ? escapeHtml(p.outcome_status) : 'None';
    const outcomeNotesText = p.outcome_notes ? escapeHtml(p.outcome_notes) : 'None';
    const outcomeUpdated = p.outcome_updated_at ? ` <span class="small muted">(${escapeHtml(p.outcome_updated_at.split(' ')[0])})</span>` : '';

    // Contact history table
    let contactHistoryHtml = '<p class="small muted">No contact history recorded.</p>';
    if (data.contact_history && data.contact_history.length > 0) {
      contactHistoryHtml = `
        <table class="data" style="margin-top: 8px;">
          <thead>
            <tr>
              <th>When</th>
              <th>Channel</th>
              <th>Direction</th>
              <th>Summary</th>
              <th>Staff</th>
            </tr>
          </thead>
          <tbody>
            ${data.contact_history.map(ch => {
              const when = ch.occurred_at ? escapeHtml(ch.occurred_at.replace('T', ' ').slice(0, 16)) : 'N/A';
              const dirBadge = ch.direction === 'inbound' ? 'badge-blue' : 'badge-green';
              return `
                <tr>
                  <td><span class="small">${when}</span></td>
                  <td><span class="small">${escapeHtml(ch.channel)}</span></td>
                  <td><span class="badge ${dirBadge}">${escapeHtml(ch.direction)}</span></td>
                  <td>${escapeHtml(ch.summary)}</td>
                  <td><span class="small muted">${escapeHtml(ch.recorded_by || '')}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    const nowLocal = new Date().toISOString().slice(0, 16);

    panel.innerHTML = `
      <h4>👤 Caregiver record — ${name} ${memberBadge} ${statusBadge}</h4>
      <div class="kv-row"><span class="k">Contact Info</span><span class="v">${contactInfo}</span></div>
      <div class="kv-row"><span class="k">Sanctuary member since</span><span class="v">${memberSince}</span></div>
      <div class="kv-row"><span class="k">Caring for</span><span class="v">${caringFor} ${relationship}</span></div>
      <div class="kv-row"><span class="k">Segments</span><span class="v">${segmentTagsDisplay}</span></div>
      <div class="kv-row"><span class="k">Outcome status</span><span class="v">${outcomeStatusText}${outcomeUpdated}</span></div>
      <div class="kv-row"><span class="k">Outcome notes</span><span class="v">${outcomeNotesText}</span></div>
      <div class="kv-row"><span class="k">Registered Events</span><span class="v">${uniquePrograms}</span></div>
      <div class="kv-row"><span class="k">Last attended</span><span class="v">${lastAttended}</span></div>
      <div class="kv-row"><span class="k">Total attended</span><span class="v">${socialsCount} event(s)</span></div>
      <div class="kv-row"><span class="k">Staff Notes</span><span class="v">${notesHtml}</span></div>
      <div style="margin-top: 14px;">
        <span class="k" style="font-weight: 700; color: var(--plum-dark);">Grants &amp; Workflow:</span>
        <div style="margin-top: 8px;">${grantsHtml}</div>
      </div>

      <details style="margin-top: 16px;" open>
        <summary class="cursor-pointer" style="font-weight: 600; color: var(--plum-dark);"><strong>📜 Contact History</strong> (${data.contact_history ? data.contact_history.length : 0})</summary>
        ${contactHistoryHtml}
      </details>

      <details style="margin-top: 16px;">
        <summary class="cursor-pointer" style="font-weight: 600; color: var(--plum-dark);"><strong>📞 Add Contact Entry</strong></summary>
        <form data-action="submit-add-contact" style="margin-top: 12px; padding: 12px; border: 1px solid #efdfd3; border-radius: 8px; background: #faf6f1;">
          <div class="field" style="margin-bottom: 8px;">
            <label style="font-size: 12px; font-weight: 600;">When (occurred at):</label>
            <input type="datetime-local" name="occurred_at" value="${nowLocal}" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;" required>
          </div>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Channel:</label>
              <select name="channel" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
                <option value="phone">phone</option>
                <option value="email">email</option>
                <option value="in_person">in_person</option>
                <option value="event">event</option>
                <option value="other">other</option>
              </select>
            </div>
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Direction:</label>
              <select name="direction" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
                <option value="outbound">outbound</option>
                <option value="inbound">inbound</option>
              </select>
            </div>
          </div>
          <div class="field" style="margin-bottom: 8px;">
            <label style="font-size: 12px; font-weight: 600;">Summary:</label>
            <textarea name="summary" rows="2" style="padding: 6px 10px; border-radius: 6px; font-size: 13px; width: 100%; box-sizing: border-box;" placeholder="Call notes, follow-up conversation, etc." required></textarea>
          </div>
          <div class="form-error-msg alert-inline-banner" style="display:none; color: #a84a32; background: #f9efdc; margin-bottom: 8px; padding: 6px; border-radius: 4px; font-size: 12.5px;"></div>
          <button type="submit" class="btn btn-sm btn-plum">Save Contact</button>
        </form>
      </details>

      <details style="margin-top: 16px;">
        <summary class="cursor-pointer" style="font-weight: 600; color: var(--plum-dark);"><strong>✏️ Edit Caregiver Details</strong></summary>
        <form data-action="submit-edit-caregiver" style="margin-top: 12px; padding: 12px; border: 1px solid #efdfd3; border-radius: 8px; background: #faf6f1;">
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">First name:</label>
              <input type="text" name="first_name" value="${escapeHtml(p.first_name || '')}" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
            </div>
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Last name:</label>
              <input type="text" name="last_name" value="${escapeHtml(p.last_name || '')}" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Email:</label>
              <input type="email" name="email" value="${escapeHtml(p.email || '')}" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
            </div>
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Phone:</label>
              <input type="text" name="phone" value="${escapeHtml(p.phone || '')}" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Preferred contact:</label>
              <select name="preferred_contact" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
                <option value="email" ${p.preferred_contact === 'email' ? 'selected' : ''}>email</option>
                <option value="phone" ${p.preferred_contact === 'phone' ? 'selected' : ''}>phone</option>
                <option value="text" ${p.preferred_contact === 'text' ? 'selected' : ''}>text</option>
              </select>
            </div>
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Status:</label>
              <select name="status" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
                <option value="active" ${p.status === 'active' ? 'selected' : ''}>active</option>
                <option value="inactive" ${p.status === 'inactive' ? 'selected' : ''}>inactive</option>
                <option value="archived" ${p.status === 'archived' ? 'selected' : ''}>archived</option>
              </select>
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Caring for:</label>
              <input type="text" name="caring_for" value="${escapeHtml(p.caring_for || '')}" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
            </div>
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Relationship:</label>
              <input type="text" name="relationship" value="${escapeHtml(p.relationship || '')}" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
            </div>
          </div>
          <div class="field" style="margin-bottom: 8px;">
            <label style="font-size: 12px; font-weight: 600;">Segments (comma-separated):</label>
            <input type="text" name="segment_tags" value="${escapeHtml(segmentTagsFormVal)}" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;" placeholder="e.g. dementia, elder_care">
          </div>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <div class="field" style="flex: 1; margin-bottom: 0;">
              <label style="font-size: 12px; font-weight: 600;">Outcome status:</label>
              <select name="outcome_status" style="padding: 6px 10px; border-radius: 6px; font-size: 13px;">
                <option value="" ${!p.outcome_status ? 'selected' : ''}>None</option>
                <option value="improving" ${p.outcome_status === 'improving' ? 'selected' : ''}>improving</option>
                <option value="stable" ${p.outcome_status === 'stable' ? 'selected' : ''}>stable</option>
                <option value="needs_support" ${p.outcome_status === 'needs_support' ? 'selected' : ''}>needs_support</option>
                <option value="disengaged" ${p.outcome_status === 'disengaged' ? 'selected' : ''}>disengaged</option>
              </select>
            </div>
          </div>
          <div class="field" style="margin-bottom: 8px;">
            <label style="font-size: 12px; font-weight: 600;">Outcome notes:</label>
            <textarea name="outcome_notes" rows="2" style="padding: 6px 10px; border-radius: 6px; font-size: 13px; width: 100%; box-sizing: border-box;">${escapeHtml(p.outcome_notes || '')}</textarea>
          </div>
          <div class="form-error-msg alert-inline-banner" style="display:none; color: #a84a32; background: #f9efdc; margin-bottom: 8px; padding: 6px; border-radius: 4px; font-size: 12.5px;"></div>
          <button type="submit" class="btn btn-sm btn-plum">Save Changes</button>
        </form>
      </details>
    `;
  } catch (e) {
    console.error(e);
  }
}

async function loadEvents() {
  try {
    const res = await fetch('/api/events');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to fetch events');
    
    const body = document.getElementById('upcomingEventsBody');
    if (!body) return;
    if (data.events.length === 0) {
      body.innerHTML = '<tr><td colspan="3" class="text-center muted small">No events found.</td></tr>';
      return;
    }
    
    body.innerHTML = data.events.map(ev => {
      const regText = ev.capacity ? `${escapeHtml(ev.registered_count)} / ${escapeHtml(ev.capacity)} capacity` : `${escapeHtml(ev.registered_count)}`;
      const isSelected = ev.id === currentEventId ? ' row-selected' : '';
      const dateText = ev.starts_at ? escapeHtml(ev.starts_at.split(' ')[0]) : '';
      
      return `
        <tr class="cursor-pointer${isSelected}" data-action="select-event" data-event-id="${escapeHtml(ev.id)}" data-event-title="${escapeHtml(ev.title)}">
          <td><strong>${escapeHtml(ev.title)}</strong></td>
          <td>${dateText}</td>
          <td>${regText}</td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
  }
}

async function selectEvent(eventId, eventTitle) {
  currentEventId = eventId;
  currentEventTitle = eventTitle;
  await loadEvents();
  await loadRegistrations(eventId, eventTitle);
}

async function loadRegistrations(eventId, eventTitle) {
  try {
    const res = await fetch(`/api/registrations?event_id=${eventId}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to fetch registrations');
    
    const panel = document.getElementById('attendancePanel');
    const content = document.getElementById('attendanceContent');
    if (!panel || !content) return;
    
    panel.style.display = 'block';
    
    if (data.registrations.length === 0) {
      content.innerHTML = '<p class="small muted text-center">No caregivers registered for this event yet.</p>';
      return;
    }
    
    content.innerHTML = `
      <table class="data">
        <thead>
          <tr>
            <th>Caregiver</th>
            <th>Email</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.registrations.map(reg => {
            const first = (reg.first_name || '').trim();
            const last = (reg.last_name || '').trim();
            const rawName = `${first} ${last}`.trim() || 'Anonymous';
            const caregiverName = escapeHtml(rawName);
            let badgeClass = 'badge-blue';
            if (reg.status === 'attended') badgeClass = 'badge-green';
            if (reg.status === 'no_show') badgeClass = 'badge-amber';
            if (reg.status === 'cancelled') badgeClass = 'badge-plum';
            
            return `
              <tr class="cursor-pointer" data-action="view-caregiver" data-caregiver-id="${escapeHtml(reg.caregiver_id)}">
                <td><strong>${caregiverName}</strong></td>
                <td>${escapeHtml(reg.email || '')}</td>
                <td><span class="badge ${badgeClass}">${escapeHtml(reg.status)}</span></td>
                <td>
                  <button class="btn btn-sm btn-plum btn-compact-mr" data-action="update-attendance" data-registration-id="${escapeHtml(reg.id)}" data-status="attended">Attended</button>
                  <button class="btn btn-sm btn-outline btn-compact-mr" data-action="update-attendance" data-registration-id="${escapeHtml(reg.id)}" data-status="no_show">No Show</button>
                  <button class="btn btn-sm btn-outline btn-compact" data-action="update-attendance" data-registration-id="${escapeHtml(reg.id)}" data-status="cancelled">Cancel</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error(e);
  }
}

async function updateAttendance(id, status, event) {
  if (event) event.stopPropagation();
  try {
    const res = await fetch('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    });
    if (res.ok) {
      await loadStaffConsole();
      const panel = document.getElementById('caregiverRecordPanel');
      if (panel && panel.dataset.caregiverId) {
        await viewCaregiver(panel.dataset.caregiverId);
      }
    }
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  loadStaffConsole();
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        agentSend();
      }
    });
  }
  const searchInput = document.getElementById('caregiverSearchQuery');
  if (searchInput) {
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        searchCaregivers(0);
      }
    });
  }
  const segmentSelect = document.getElementById('caregiverSearchSegment');
  if (segmentSelect) {
    segmentSelect.addEventListener('change', function () {
      searchCaregivers(0);
    });
  }
  const statusSelect = document.getElementById('caregiverSearchStatus');
  if (statusSelect) {
    statusSelect.addEventListener('change', function () {
      searchCaregivers(0);
    });
  }
  const grantFilter = document.getElementById('grantsStatusFilter');
  if (grantFilter) {
    grantFilter.addEventListener('change', function () {
      loadGrants();
    });
  }
});

document.addEventListener('submit', function (e) {
  const form = e.target;
  if (!form) return;
  const formAction = form.getAttribute('data-action');
  if (formAction === 'submit-edit-caregiver') {
    e.preventDefault();
    submitEditCaregiver(form);
  } else if (formAction === 'submit-add-contact') {
    e.preventDefault();
    submitAddContact(form);
  }
});

document.addEventListener('click', function (e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');
  if (action === 'resolve-followup') {
    e.stopPropagation();
    const id = Number(target.getAttribute('data-followup-id'));
    resolveFollowup(id, e);
  } else if (action === 'update-attendance') {
    e.stopPropagation();
    const id = Number(target.getAttribute('data-registration-id'));
    const status = target.getAttribute('data-status');
    updateAttendance(id, status, e);
  } else if (action === 'view-caregiver') {
    const id = target.getAttribute('data-caregiver-id');
    viewCaregiver(id);
  } else if (action === 'select-event') {
    const id = target.getAttribute('data-event-id');
    const title = target.getAttribute('data-event-title');
    selectEvent(id, title);
  } else if (action === 'search-caregivers') {
    searchCaregivers(0);
  } else if (action === 'search-prev') {
    searchPrev();
  } else if (action === 'search-next') {
    searchNext();
  } else if (action === 'grant-review') {
    e.stopPropagation();
    const id = target.getAttribute('data-grant-id');
    handleGrantReview(id, target);
  } else if (action === 'grant-award') {
    e.stopPropagation();
    const id = target.getAttribute('data-grant-id');
    handleGrantAward(id, target);
  } else if (action === 'grant-decline') {
    e.stopPropagation();
    const id = target.getAttribute('data-grant-id');
    handleGrantDecline(id, target);
  } else if (action === 'grant-course-complete') {
    e.stopPropagation();
    const id = target.getAttribute('data-grant-id');
    handleGrantCourseComplete(id, target);
  } else if (action === 'grant-close') {
    e.stopPropagation();
    const id = target.getAttribute('data-grant-id');
    handleGrantClose(id, target);
  }
});

