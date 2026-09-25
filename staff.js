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
let staffEvents = [];
let currentCaregiverId = null;
let currentGrantId = null;
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
  await Promise.all([
    loadFollowups(),
    loadEvents(),
    loadGrants(),
    searchCaregivers(0),
    loadSiteContent(),
    loadRecentChanges()
  ]);
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

async function submitAddNote(form) {
  const panel = document.getElementById('caregiverRecordPanel');
  const caregiverId = panel?.dataset?.caregiverId;
  if (!caregiverId) return;

  const errBox = form.querySelector('.form-error-msg');
  if (errBox) {
    errBox.textContent = '';
    errBox.classList.add('d-none');
  }

  const bodyInput = form.querySelector('[name="body"]');
  const noteBody = bodyInput ? bodyInput.value.trim() : '';
  if (!noteBody) {
    if (errBox) {
      errBox.textContent = 'Note body is required and must not be empty';
      errBox.classList.remove('d-none');
    } else {
      alert('Note body is required and must not be empty');
    }
    return;
  }

  if (noteBody.length > 2000) {
    if (errBox) {
      errBox.textContent = 'Note exceeds maximum length of 2000 characters';
      errBox.classList.remove('d-none');
    } else {
      alert('Note exceeds maximum length of 2000 characters');
    }
    return;
  }

  try {
    const res = await fetch(`/api/staff/caregiver/${caregiverId}/note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: noteBody })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const errMsg = data.error || 'Failed to add note';
      if (errBox) {
        errBox.textContent = errMsg;
        errBox.classList.remove('d-none');
      } else {
        alert(errMsg);
      }
      return;
    }
    await viewCaregiver(caregiverId);
  } catch (e) {
    if (errBox) {
      errBox.textContent = e.message;
      errBox.classList.remove('d-none');
    } else {
      alert(e.message);
    }
  }
}

async function archiveNote(id, target) {
  if (!id) return;
  const panel = document.getElementById('caregiverRecordPanel');
  const caregiverId = panel?.dataset?.caregiverId;

  const errBox = panel ? panel.querySelector('.note-error-msg') : null;
  if (errBox) {
    errBox.textContent = '';
    errBox.classList.add('d-none');
  }

  try {
    const res = await fetch(`/api/staff/note/${id}/archive`, {
      method: 'POST'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const errMsg = data.error || 'Failed to archive note';
      if (errBox) {
        errBox.textContent = errMsg;
        errBox.classList.remove('d-none');
      } else {
        alert(errMsg);
      }
      return;
    }
    if (caregiverId) {
      await viewCaregiver(caregiverId);
    }
  } catch (e) {
    if (errBox) {
      errBox.textContent = e.message;
      errBox.classList.remove('d-none');
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
    currentCaregiverId = id;
    if (data.grants && data.grants.length > 0) {
      currentGrantId = data.grants[0].id;
    } else {
      currentGrantId = null;
    }

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
          <div class="grant-row" data-grant-id="${escapeHtml(g.id)}">
            <div>
              <strong>${escapeHtml(g.requested_for || 'Wellness grant')}</strong>
              <span class="badge ${gBadge}">${escapeHtml(label)}</span>${awardInfo}
            </div>
            ${g.review_notes ? `<div class="small muted mt-4">Review notes: ${escapeHtml(g.review_notes)}</div>` : ''}
            ${actionButtons ? `<div class="grant-actions">${actionButtons}</div>` : ''}
            <div class="grant-error-banner alert-inline-banner"></div>
          </div>
        `;
      }).join('');
    }

    const attendedEvents = data.registrations.filter(r => r.status === 'attended');
    const lastAttended = attendedEvents.length > 0 
      ? `${escapeHtml(attendedEvents[0].event_title)} · ${escapeHtml(attendedEvents[0].event_starts_at.split(' ')[0])}`
      : 'N/A';

    const socialsCount = data.registrations.filter(r => r.status === 'attended').length;

    let notesHtml = '<div class="small muted">None</div>';
    if (data.notes && data.notes.length > 0) {
      notesHtml = `<div class="note-list">${data.notes.map(n => `
        <div class="note-row" data-note-id="${escapeHtml(n.id)}">
          <div class="note-content">
            <strong>${escapeHtml(n.author)}:</strong> ${escapeHtml(n.body)} <span class="small muted">(${escapeHtml(n.created_at.split(' ')[0])})</span>
          </div>
          <button type="button" class="btn btn-sm btn-outline btn-compact-ml" data-action="archive-note" data-note-id="${escapeHtml(n.id)}">Archive</button>
        </div>
      `).join('')}</div>`;
    }

    const contactInfo = `Email: ${escapeHtml(p.email || 'N/A')} · Phone: ${escapeHtml(p.phone || 'N/A')} (Prefers: ${escapeHtml(p.preferred_contact || 'email')})`;

    // Outcome status & notes
    const outcomeStatusText = p.outcome_status ? escapeHtml(p.outcome_status) : 'None';
    const outcomeNotesText = p.outcome_notes ? escapeHtml(p.outcome_notes) : 'None';
    const outcomeUpdated = p.outcome_updated_at ? ` <span class="small muted">(${escapeHtml(p.outcome_updated_at.split(' ')[0])})</span>` : '';

    // Contact history table
    let contactHistoryHtml = '<p class="small muted">No contact history recorded.</p>';
    if (data.contact_history && data.contact_history.length > 0) {
      contactHistoryHtml = `
        <table class="data mt-8">
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
      <div class="kv-row"><span class="k">Staff Notes</span><span class="v"><div class="note-error-msg alert-inline-banner form-error-banner d-none"></div>${notesHtml}</span></div>
      <div class="mt-14">
        <span class="k staff-section-title">Grants &amp; Workflow:</span>
        <div class="mt-8">${grantsHtml}</div>
      </div>

      <details class="mt-16" open>
        <summary class="cursor-pointer note-section-summary"><strong>📜 Contact History</strong> (${data.contact_history ? data.contact_history.length : 0})</summary>
        ${contactHistoryHtml}
      </details>

      <details class="mt-16">
        <summary class="cursor-pointer note-section-summary"><strong>📞 Add Contact Entry</strong></summary>
        <form data-action="submit-add-contact" class="record-form-panel">
          <div class="field mb-8">
            <label class="form-label-small">When (occurred at):</label>
            <input type="datetime-local" name="occurred_at" value="${nowLocal}" class="form-input-compact" required>
          </div>
          <div class="form-row-compact">
            <div class="field form-col-flex">
              <label class="form-label-small">Channel:</label>
              <select name="channel" class="form-input-compact">
                <option value="phone">phone</option>
                <option value="email">email</option>
                <option value="in_person">in_person</option>
                <option value="event">event</option>
                <option value="other">other</option>
              </select>
            </div>
            <div class="field form-col-flex">
              <label class="form-label-small">Direction:</label>
              <select name="direction" class="form-input-compact">
                <option value="outbound">outbound</option>
                <option value="inbound">inbound</option>
              </select>
            </div>
          </div>
          <div class="field mb-8">
            <label class="form-label-small">Summary:</label>
            <textarea name="summary" rows="2" class="form-textarea-compact" placeholder="Call notes, follow-up conversation, etc." required></textarea>
          </div>
          <div class="form-error-msg alert-inline-banner form-error-banner d-none"></div>
          <button type="submit" class="btn btn-sm btn-plum">Save Contact</button>
        </form>
      </details>

      <details class="mt-16-util">
        <summary class="cursor-pointer note-section-summary"><strong>Add Note</strong></summary>
        <form data-action="submit-add-note" class="record-form-panel">
          <div class="field mb-8">
            <label class="form-label-small">Note text:</label>
            <textarea name="body" rows="3" class="form-textarea-full" placeholder="Add a staff note about this caregiver..." maxlength="2000" required></textarea>
          </div>
          <div class="form-error-msg alert-inline-banner form-error-banner d-none"></div>
          <button type="submit" class="btn btn-sm btn-plum">Save Note</button>
        </form>
      </details>

      <details class="mt-16">
        <summary class="cursor-pointer note-section-summary"><strong>✏️ Edit Caregiver Details</strong></summary>
        <form data-action="submit-edit-caregiver" class="record-form-panel">
          <div class="form-row-compact">
            <div class="field form-col-flex">
              <label class="form-label-small">First name:</label>
              <input type="text" name="first_name" value="${escapeHtml(p.first_name || '')}" class="form-input-compact">
            </div>
            <div class="field form-col-flex">
              <label class="form-label-small">Last name:</label>
              <input type="text" name="last_name" value="${escapeHtml(p.last_name || '')}" class="form-input-compact">
            </div>
          </div>
          <div class="form-row-compact">
            <div class="field form-col-flex">
              <label class="form-label-small">Email:</label>
              <input type="email" name="email" value="${escapeHtml(p.email || '')}" class="form-input-compact">
            </div>
            <div class="field form-col-flex">
              <label class="form-label-small">Phone:</label>
              <input type="text" name="phone" value="${escapeHtml(p.phone || '')}" class="form-input-compact">
            </div>
          </div>
          <div class="form-row-compact">
            <div class="field form-col-flex">
              <label class="form-label-small">Preferred contact:</label>
              <select name="preferred_contact" class="form-input-compact">
                <option value="email" ${p.preferred_contact === 'email' ? 'selected' : ''}>email</option>
                <option value="phone" ${p.preferred_contact === 'phone' ? 'selected' : ''}>phone</option>
                <option value="text" ${p.preferred_contact === 'text' ? 'selected' : ''}>text</option>
              </select>
            </div>
            <div class="field form-col-flex">
              <label class="form-label-small">Status:</label>
              <select name="status" class="form-input-compact">
                <option value="active" ${p.status === 'active' ? 'selected' : ''}>active</option>
                <option value="inactive" ${p.status === 'inactive' ? 'selected' : ''}>inactive</option>
                <option value="archived" ${p.status === 'archived' ? 'selected' : ''}>archived</option>
              </select>
            </div>
          </div>
          <div class="form-row-compact">
            <div class="field form-col-flex">
              <label class="form-label-small">Caring for:</label>
              <input type="text" name="caring_for" value="${escapeHtml(p.caring_for || '')}" class="form-input-compact">
            </div>
            <div class="field form-col-flex">
              <label class="form-label-small">Relationship:</label>
              <input type="text" name="relationship" value="${escapeHtml(p.relationship || '')}" class="form-input-compact">
            </div>
          </div>
          <div class="field mb-8">
            <label class="form-label-small">Segments (comma-separated):</label>
            <input type="text" name="segment_tags" value="${escapeHtml(segmentTagsFormVal)}" class="form-input-compact" placeholder="e.g. dementia, elder_care">
          </div>
          <div class="form-row-compact">
            <div class="field form-col-flex">
              <label class="form-label-small">Outcome status:</label>
              <select name="outcome_status" class="form-input-compact">
                <option value="" ${!p.outcome_status ? 'selected' : ''}>None</option>
                <option value="improving" ${p.outcome_status === 'improving' ? 'selected' : ''}>improving</option>
                <option value="stable" ${p.outcome_status === 'stable' ? 'selected' : ''}>stable</option>
                <option value="needs_support" ${p.outcome_status === 'needs_support' ? 'selected' : ''}>needs_support</option>
                <option value="disengaged" ${p.outcome_status === 'disengaged' ? 'selected' : ''}>disengaged</option>
              </select>
            </div>
          </div>
          <div class="field mb-8">
            <label class="form-label-small">Outcome notes:</label>
            <textarea name="outcome_notes" rows="2" class="form-textarea-compact">${escapeHtml(p.outcome_notes || '')}</textarea>
          </div>
          <div class="form-error-msg alert-inline-banner form-error-banner d-none"></div>
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
    let res = await fetch('/api/staff/events');
    let data;
    if (res.ok) {
      data = await res.json();
    } else {
      res = await fetch('/api/events');
      data = await res.json();
    }
    if (!data || !data.ok) throw new Error(data?.error || 'Failed to fetch events');

    staffEvents = data.events || [];
    const body = document.getElementById('upcomingEventsBody');
    if (!body) return;
    if (staffEvents.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="text-center muted small">No events found.</td></tr>';
      return;
    }

    body.innerHTML = staffEvents.map(ev => {
      const regCount = ev.registered_count != null ? ev.registered_count : 0;
      const regText = ev.capacity ? `${escapeHtml(regCount)} / ${escapeHtml(ev.capacity)}` : `${escapeHtml(regCount)}`;
      const isSelected = ev.id === currentEventId ? ' row-selected' : '';
      const dateText = ev.starts_at ? escapeHtml(ev.starts_at.replace('T', ' ').split(' ')[0]) : '';
      const state = ev.publish_state || 'published';
      const stateBadge = `<span class="badge badge-${escapeHtml(state)}">${escapeHtml(state)}</span>`;

      const actions = [];
      if (state === 'draft') {
        actions.push(`<button type="button" class="btn btn-sm btn-plum btn-compact" data-action="publish-event" data-event-id="${escapeHtml(ev.id)}">Publish</button>`);
      }
      if (state !== 'archived') {
        actions.push(`<button type="button" class="btn btn-sm btn-outline btn-compact" data-action="archive-event" data-event-id="${escapeHtml(ev.id)}">Archive</button>`);
      }
      actions.push(`<button type="button" class="btn btn-sm btn-outline btn-compact" data-action="edit-event" data-event-id="${escapeHtml(ev.id)}">Edit</button>`);

      return `
        <tr class="cursor-pointer${isSelected}" data-action="select-event" data-event-id="${escapeHtml(ev.id)}" data-event-title="${escapeHtml(ev.title)}">
          <td><strong>${escapeHtml(ev.title)}</strong></td>
          <td>${dateText}</td>
          <td>${stateBadge}</td>
          <td>${regText}</td>
          <td>
            <div class="event-actions">
              ${actions.join('')}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
  }
}

function renderNewEventForm() {
  const container = document.getElementById('newEventContainer');
  if (!container) return;
  container.innerHTML = `
    <form id="newEventForm" data-action="submit-create-event" class="record-form-panel">
      <div class="field mb-8">
        <label class="form-label-small" for="newEventTitle">Title *</label>
        <input type="text" id="newEventTitle" name="title" class="editor-input" required placeholder="Event title">
      </div>
      <div class="field-row mb-8">
        <div class="field-col">
          <label class="form-label-small" for="newEventType">Type *</label>
          <select id="newEventType" name="type" class="editor-input" required>
            <option value="support_group">Support Group</option>
            <option value="memory_social">Memory Social</option>
            <option value="caregiver_event">Caregiver Event</option>
            <option value="wellness">Wellness</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="field-col">
          <label class="form-label-small" for="newEventCapacity">Capacity</label>
          <input type="number" id="newEventCapacity" name="capacity" class="editor-input" min="1" placeholder="e.g. 20">
        </div>
      </div>
      <div class="field-row mb-8">
        <div class="field-col">
          <label class="form-label-small" for="newEventStartsAt">Starts at *</label>
          <input type="datetime-local" id="newEventStartsAt" name="starts_at" class="editor-input" required>
        </div>
        <div class="field-col">
          <label class="form-label-small" for="newEventEndsAt">Ends at</label>
          <input type="datetime-local" id="newEventEndsAt" name="ends_at" class="editor-input">
        </div>
      </div>
      <div class="field mb-8">
        <label class="form-label-small" for="newEventLocation">Location</label>
        <input type="text" id="newEventLocation" name="location" class="editor-input" placeholder="e.g. Community Room">
      </div>
      <div class="editor-checkbox-row mb-12">
        <input type="checkbox" id="newEventRecurring" name="recurring">
        <label for="newEventRecurring">Recurring event</label>
      </div>
      <div id="newEventError" class="form-error-banner d-none"></div>
      <div class="editor-actions">
        <button type="submit" class="btn btn-sm btn-plum">Create Draft Event</button>
        <button type="button" class="btn btn-sm btn-outline" data-action="cancel-new-event">Cancel</button>
      </div>
    </form>
  `;
}

function toggleNewEventForm() {
  const container = document.getElementById('newEventContainer');
  if (!container) return;
  if (!document.getElementById('newEventForm')) {
    renderNewEventForm();
  }
  const errBox = document.getElementById('newEventError');
  if (container.classList.contains('d-none')) {
    container.classList.remove('d-none');
    if (errBox) {
      errBox.classList.add('d-none');
      errBox.textContent = '';
    }
  } else {
    container.classList.add('d-none');
  }
}

function cancelNewEventForm() {
  const container = document.getElementById('newEventContainer');
  const form = document.getElementById('newEventForm');
  const errBox = document.getElementById('newEventError');
  if (container) container.classList.add('d-none');
  if (form) form.reset();
  if (errBox) {
    errBox.classList.add('d-none');
    errBox.textContent = '';
  }
}

async function submitCreateEvent(form) {
  const errBox = document.getElementById('newEventError');
  if (errBox) {
    errBox.classList.add('d-none');
    errBox.textContent = '';
  }

  const payload = {
    title: form.title.value.trim(),
    type: form.type.value,
    starts_at: form.starts_at.value ? form.starts_at.value.replace('T', ' ') : '',
    ends_at: form.ends_at.value ? form.ends_at.value.replace('T', ' ') : null,
    location: form.location.value.trim() || null,
    capacity: form.capacity.value ? parseInt(form.capacity.value, 10) : null,
    recurring: form.recurring ? form.recurring.checked : false
  };

  try {
    const res = await fetch('/api/staff/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (errBox) {
        errBox.textContent = data.error || 'Failed to create event';
        errBox.classList.remove('d-none');
      }
      return;
    }

    form.reset();
    const container = document.getElementById('newEventContainer');
    if (container) container.classList.add('d-none');
    await loadEvents();
    await loadRecentChanges();
  } catch (e) {
    if (errBox) {
      errBox.textContent = e.message || 'Error creating event';
      errBox.classList.remove('d-none');
    }
  }
}

function openEditEvent(eventId) {
  const ev = staffEvents.find(e => e.id === eventId);
  const container = document.getElementById('editEventContainer');
  if (!ev || !container) return;

  const startsVal = ev.starts_at ? ev.starts_at.replace(' ', 'T').slice(0, 16) : '';
  const endsVal = ev.ends_at ? ev.ends_at.replace(' ', 'T').slice(0, 16) : '';

  const types = [
    { value: 'support_group', label: 'Support Group' },
    { value: 'memory_social', label: 'Memory Social' },
    { value: 'caregiver_event', label: 'Caregiver Event' },
    { value: 'wellness', label: 'Wellness' },
    { value: 'other', label: 'Other' }
  ];

  const typeOptions = types.map(t =>
    `<option value="${t.value}"${ev.type === t.value ? ' selected' : ''}>${escapeHtml(t.label)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="editor-box">
      <div class="editor-header">
        <strong>Edit Event: ${escapeHtml(ev.title)} (${escapeHtml(ev.id)})</strong>
        <button type="button" class="btn btn-sm btn-outline btn-compact" data-action="cancel-edit-event">Cancel</button>
      </div>
      <div id="editEventError" class="form-error-banner d-none"></div>
      <form data-action="submit-edit-event" data-event-id="${escapeHtml(ev.id)}">
        <div class="editor-field">
          <label class="editor-label" for="editEventTitle">Title *</label>
          <input type="text" id="editEventTitle" name="title" class="editor-input" value="${escapeHtml(ev.title || '')}" required>
        </div>
        <div class="field-row mb-8">
          <div class="field-col">
            <label class="editor-label" for="editEventType">Type *</label>
            <select id="editEventType" name="type" class="editor-input" required>
              ${typeOptions}
            </select>
          </div>
          <div class="field-col">
            <label class="editor-label" for="editEventCapacity">Capacity</label>
            <input type="number" id="editEventCapacity" name="capacity" class="editor-input" min="1" value="${ev.capacity != null ? escapeHtml(String(ev.capacity)) : ''}">
          </div>
        </div>
        <div class="field-row mb-8">
          <div class="field-col">
            <label class="editor-label" for="editEventStartsAt">Starts at *</label>
            <input type="datetime-local" id="editEventStartsAt" name="starts_at" class="editor-input" value="${escapeHtml(startsVal)}" required>
          </div>
          <div class="field-col">
            <label class="editor-label" for="editEventEndsAt">Ends at</label>
            <input type="datetime-local" id="editEventEndsAt" name="ends_at" class="editor-input" value="${escapeHtml(endsVal)}">
          </div>
        </div>
        <div class="editor-field">
          <label class="editor-label" for="editEventLocation">Location</label>
          <input type="text" id="editEventLocation" name="location" class="editor-input" value="${escapeHtml(ev.location || '')}">
        </div>
        <div class="editor-checkbox-row mb-12">
          <input type="checkbox" id="editEventRecurring" name="recurring"${ev.recurring ? ' checked' : ''}>
          <label for="editEventRecurring">Recurring event</label>
        </div>
        <div class="editor-actions">
          <button type="submit" class="btn btn-sm btn-plum">Save changes</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="cancel-edit-event">Cancel</button>
        </div>
      </form>
    </div>
  `;
  container.classList.remove('d-none');
}

function cancelEditEvent() {
  const container = document.getElementById('editEventContainer');
  if (container) {
    container.classList.add('d-none');
    container.innerHTML = '';
  }
}

async function submitEditEvent(form) {
  const eventId = form.getAttribute('data-event-id');
  const errBox = document.getElementById('editEventError');
  if (errBox) {
    errBox.classList.add('d-none');
    errBox.textContent = '';
  }

  const payload = {
    title: form.title.value.trim(),
    type: form.type.value,
    starts_at: form.starts_at.value ? form.starts_at.value.replace('T', ' ') : '',
    ends_at: form.ends_at.value ? form.ends_at.value.replace('T', ' ') : null,
    location: form.location.value.trim() || null,
    capacity: form.capacity.value ? parseInt(form.capacity.value, 10) : null,
    recurring: form.recurring ? form.recurring.checked : false
  };

  try {
    const res = await fetch(`/api/staff/event/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (errBox) {
        errBox.textContent = data.error || 'Failed to update event';
        errBox.classList.remove('d-none');
      }
      return;
    }

    cancelEditEvent();
    await loadEvents();
    await loadRecentChanges();
  } catch (e) {
    if (errBox) {
      errBox.textContent = e.message || 'Error updating event';
      errBox.classList.remove('d-none');
    }
  }
}

async function publishEvent(eventId) {
  try {
    const res = await fetch(`/api/staff/event/${encodeURIComponent(eventId)}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      alert(`Publish failed: ${data.error || 'Unknown error'}`);
      return;
    }
    await loadEvents();
    await loadRecentChanges();
  } catch (e) {
    alert(`Publish error: ${e.message}`);
  }
}

async function archiveEvent(eventId, confirmWithRegistrations = false) {
  try {
    const body = confirmWithRegistrations ? { confirm_with_registrations: true } : {};
    const res = await fetch(`/api/staff/event/${encodeURIComponent(eventId)}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (res.status === 409 && data.registration_count != null) {
        const confirmed = confirm(`This event has ${data.registration_count} active registration(s). Are you sure you want to archive it anyway?`);
        if (confirmed) {
          return archiveEvent(eventId, true);
        }
        return;
      }
      alert(`Archive failed: ${data.error || 'Unknown error'}`);
      return;
    }
    await loadEvents();
    await loadRecentChanges();
  } catch (e) {
    alert(`Archive error: ${e.message}`);
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
  const refreshChangesBtn = document.getElementById('refreshRecentChangesBtn');
  if (refreshChangesBtn) {
    refreshChangesBtn.addEventListener('click', function () {
      loadRecentChanges();
    });
  }
  const newEventBtn = document.getElementById('newEventToggleBtn');
  if (newEventBtn) {
    newEventBtn.addEventListener('click', function () {
      toggleNewEventForm();
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
  } else if (formAction === 'submit-add-note') {
    e.preventDefault();
    submitAddNote(form);
  } else if (formAction === 'submit-direct-content') {
    e.preventDefault();
    submitDirectContent(form);
  } else if (formAction === 'submit-create-event') {
    e.preventDefault();
    submitCreateEvent(form);
  } else if (formAction === 'submit-edit-event') {
    e.preventDefault();
    submitEditEvent(form);
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
  } else if (action === 'archive-note') {
    e.stopPropagation();
    const id = target.getAttribute('data-note-id');
    archiveNote(id, target);
  } else if (action === 'agent-change-confirm') {
    e.stopPropagation();
    confirmAgentChange(target);
  } else if (action === 'agent-change-discard') {
    e.stopPropagation();
    discardAgentChange(target);
  } else if (action === 'edit-content-item') {
    e.stopPropagation();
    const id = target.getAttribute('data-content-id');
    openContentEditor(id);
  } else if (action === 'close-content-editor') {
    e.stopPropagation();
    closeContentEditor();
  } else if (action === 'undo-change') {
    e.stopPropagation();
    const id = Number(target.getAttribute('data-audit-id'));
    handleUndoChange(id, target);
  } else if (action === 'toggle-new-event') {
    e.stopPropagation();
    toggleNewEventForm();
  } else if (action === 'cancel-new-event') {
    e.stopPropagation();
    cancelNewEventForm();
  } else if (action === 'edit-event') {
    e.stopPropagation();
    const id = target.getAttribute('data-event-id');
    openEditEvent(id);
  } else if (action === 'cancel-edit-event') {
    e.stopPropagation();
    cancelEditEvent();
  } else if (action === 'publish-event') {
    e.stopPropagation();
    const id = target.getAttribute('data-event-id');
    publishEvent(id);
  } else if (action === 'archive-event') {
    e.stopPropagation();
    const id = target.getAttribute('data-event-id');
    archiveEvent(id);
  }
});

async function confirmAgentChange(target) {
  const changeId = target.getAttribute('data-change-id');
  if (!changeId) return;
  try {
    const res = await fetch('/api/agent/change/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ change_id: changeId })
    });
    const data = await res.json();
    const row = target.closest('.confirm-row');
    if (!res.ok || !data.ok) {
      if (row) {
        row.innerHTML = `<span class="chat-confirm-discarded">Failed: ${escapeHtml(data.error || 'Could not confirm')}</span>`;
      }
      return;
    }
    if (row) {
      row.innerHTML = '<span class="chat-confirm-published">✓ Published — logged to the audit trail.</span>';
    }
    await loadStaffConsole();
    const panel = document.getElementById('caregiverRecordPanel');
    if (panel && panel.dataset.caregiverId) {
      await viewCaregiver(panel.dataset.caregiverId);
    }
  } catch (e) {
    const row = target.closest('.confirm-row');
    if (row) {
      row.innerHTML = `<span class="chat-confirm-discarded">Error: ${escapeHtml(e.message)}</span>`;
    }
  }
}

async function discardAgentChange(target) {
  const changeId = target.getAttribute('data-change-id');
  if (!changeId) return;
  try {
    const res = await fetch('/api/agent/change/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ change_id: changeId })
    });
    const row = target.closest('.confirm-row');
    if (row) {
      row.innerHTML = '<span class="chat-confirm-discarded">Draft discarded — nothing changed.</span>';
    }
  } catch (e) {
    const row = target.closest('.confirm-row');
    if (row) {
      row.innerHTML = `<span class="chat-confirm-discarded">Error: ${escapeHtml(e.message)}</span>`;
    }
  }
}

window.agentSend = async function () {
  const input = document.getElementById('chatInput');
  const body = document.getElementById('chatBody');
  const text = (input?.value || '').trim();
  if (!text || !body) return;
  input.value = '';

  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.textContent = text;
  body.appendChild(userDiv);

  const areaSelect = document.getElementById('chatAreaSelect');
  const selectedArea = areaSelect ? areaSelect.value : 'content';

  if (selectedArea === 'content') {
    const t = text.toLowerCase();
    let previewTitle, previewBody;
    if (t.includes('caregiver') && (t.includes('add') || t.includes('new'))) {
      previewTitle = '👤 New Sanctuary member record';
      previewBody = 'Name parsed from your message · programs: as specified<br>Fields: profile, contact, program flags, notes<br>Nothing saved until you confirm.';
    } else if (t.includes('resource') || t.includes('hub')) {
      previewTitle = '📚 Resource hub update';
      previewBody = 'New resource drafted into the category you named.<br>Will appear on the Resource Hub after confirmation.';
    } else if (t.includes('event')) {
      previewTitle = '📅 New event draft';
      previewBody = 'Date, time, and location parsed from your message.<br>Will list on the Events page + portal after confirmation.';
    } else {
      previewTitle = '✏️ Drafted change';
      previewBody = 'Mapped your request to a structured content change.<br>Preview it here — nothing goes live until you confirm.';
    }

    const botDiv = document.createElement('div');
    botDiv.className = 'msg bot';
    botDiv.innerHTML =
      'Here\'s a draft — nothing is live yet:' +
      '<div class="preview"><div class="p-title">' + previewTitle + '</div>' + previewBody + '</div>' +
      '<div class="confirm-row">' +
      '<button class="chip-btn chip-confirm" data-action="agent-confirm">Confirm &amp; publish</button>' +
      '<button class="chip-btn chip-cancel" data-action="agent-cancel">Discard</button>' +
      '</div>';

    setTimeout(function () {
      body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
    }, 300);
    body.scrollTop = body.scrollHeight;
    return;
  }

  let targetId = null;
  if (selectedArea === 'caregiver') {
    const panel = document.getElementById('caregiverRecordPanel');
    targetId = panel?.dataset?.caregiverId || currentCaregiverId;
    if (!targetId) {
      const botDiv = document.createElement('div');
      botDiv.className = 'msg bot';
      botDiv.innerHTML = 'Please select a caregiver from the queue or search results first to draft a caregiver change.';
      body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
      return;
    }
  } else if (selectedArea === 'grant') {
    targetId = currentGrantId;
    if (!targetId) {
      const grantRow = document.querySelector('#caregiverRecordPanel .grant-row');
      targetId = grantRow?.dataset?.grantId || currentGrantId;
    }
    if (!targetId) {
      const botDiv = document.createElement('div');
      botDiv.className = 'msg bot';
      botDiv.innerHTML = 'Please select a caregiver with an active grant or a grant application first to draft a grant transition.';
      body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
      return;
    }
  }

  try {
    const res = await fetch('/api/agent/change/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        area: selectedArea,
        target_id: targetId,
        request: text
      })
    });

    const data = await res.json();
    const botDiv = document.createElement('div');
    botDiv.className = 'msg bot';

    if (!res.ok || !data.ok) {
      botDiv.innerHTML = `⚠️ Refusal: ${escapeHtml(data.refusal || data.error || 'Request refused')}`;
      body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
      return;
    }

    const beforeJson = escapeHtml(JSON.stringify(data.preview?.before || {}, null, 2));
    const afterJson = escapeHtml(JSON.stringify(data.preview?.after || {}, null, 2));
    const areaLabel = selectedArea === 'grant' ? '🎁 Grant Transition' : '👤 Caregiver Update';

    botDiv.innerHTML = `
      Here's a draft — nothing is live yet:
      <div class="preview">
        <div class="p-title">${areaLabel} (${escapeHtml(data.change?.operation || 'change')})</div>
        <div class="diff-container">
          <div class="diff-box">
            <div class="diff-header">Before</div>
            <pre class="diff-content">${beforeJson}</pre>
          </div>
          <div class="diff-box">
            <div class="diff-header">After</div>
            <pre class="diff-content">${afterJson}</pre>
          </div>
        </div>
      </div>
      <div class="confirm-row">
        <button class="chip-btn chip-confirm" data-action="agent-change-confirm" data-change-id="${escapeHtml(data.change_id)}">Confirm &amp; publish</button>
        <button class="chip-btn chip-cancel" data-action="agent-change-discard" data-change-id="${escapeHtml(data.change_id)}">Discard</button>
      </div>
    `;
    body.appendChild(botDiv);
    body.scrollTop = body.scrollHeight;
  } catch (e) {
    const botDiv = document.createElement('div');
    botDiv.className = 'msg bot';
    botDiv.innerHTML = `Error drafting change: ${escapeHtml(e.message)}`;
    body.appendChild(botDiv);
    body.scrollTop = body.scrollHeight;
  }
};

let siteContentItems = [];
let siteContentTypes = {};

async function loadSiteContent() {
  try {
    const res = await fetch('/api/staff/content');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load site content');

    siteContentItems = data.items || data.content_items || [];
    siteContentTypes = {};
    for (const t of (data.types || data.content_types || [])) {
      let schema = t.json_schema;
      if (typeof schema === 'string') {
        try { schema = JSON.parse(schema); } catch {}
      }
      siteContentTypes[t.id] = schema;
    }

    renderSiteContent();
  } catch (e) {
    const list = document.getElementById('siteContentList');
    if (list) list.innerHTML = `<p class="muted small text-center my-20">Error loading content: ${escapeHtml(e.message)}</p>`;
  }
}

function renderSiteContent() {
  const container = document.getElementById('siteContentList');
  if (!container) return;

  if (siteContentItems.length === 0) {
    container.innerHTML = '<p class="muted small text-center my-20">No published content items found.</p>';
    return;
  }

  const groups = {};
  for (const item of siteContentItems) {
    if (!groups[item.type_id]) groups[item.type_id] = [];
    groups[item.type_id].push(item);
  }

  let html = '';
  for (const [typeId, items] of Object.entries(groups)) {
    html += `<div class="content-type-group">`;
    html += `<div class="content-type-title">${escapeHtml(typeId)}</div>`;
    for (const item of items) {
      let parsed = item.data;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch {}
      }
      const label = (parsed && (parsed.title || parsed.heading || parsed.section_key || parsed.label || parsed.name)) || item.id;
      html += `
        <div class="content-item-row">
          <div class="content-item-info">
            <div class="content-item-label">${escapeHtml(label)}</div>
            <div class="content-item-id">${escapeHtml(item.id)}</div>
          </div>
          <button class="btn btn-sm btn-outline btn-compact" data-action="edit-content-item" data-content-id="${escapeHtml(item.id)}">Edit</button>
        </div>
      `;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
}

function openContentEditor(contentId) {
  const item = siteContentItems.find(i => i.id === contentId);
  if (!item) return;

  const schema = siteContentTypes[item.type_id];
  if (!schema) {
    alert(`Schema for content type ${item.type_id} not found.`);
    return;
  }

  let parsedData = item.data;
  if (typeof parsedData === 'string') {
    try { parsedData = JSON.parse(parsedData); } catch {}
  }

  const editorContainer = document.getElementById('siteContentEditor');
  if (!editorContainer) return;

  editorContainer.innerHTML = generateSchemaFormHtml(schema, parsedData, item.type_id, item.id);
  editorContainer.classList.remove('d-none');
}

function closeContentEditor() {
  const editorContainer = document.getElementById('siteContentEditor');
  if (!editorContainer) return;
  editorContainer.innerHTML = '';
  editorContainer.classList.add('d-none');
}

function generateSchemaFormHtml(schema, initialData, typeId, contentId) {
  const props = schema.properties || {};
  const required = schema.required || [];
  const data = initialData || {};

  let fieldsHtml = '';
  for (const [key, prop] of Object.entries(props)) {
    const isReq = required.includes(key);
    const reqMark = isReq ? ' *' : '';
    const val = data[key];

    fieldsHtml += `<div class="editor-field">`;
    fieldsHtml += `<label class="editor-label">${escapeHtml(key)}${reqMark}</label>`;

    if (prop.enum && Array.isArray(prop.enum)) {
      fieldsHtml += `<select name="${escapeHtml(key)}" class="editor-input" data-schema-type="enum"${isReq ? ' required' : ''}>`;
      for (const opt of prop.enum) {
        const selected = val === opt ? ' selected' : '';
        fieldsHtml += `<option value="${escapeHtml(opt)}"${selected}>${escapeHtml(opt)}</option>`;
      }
      fieldsHtml += `</select>`;
    } else if (prop.type === 'string') {
      const isLong = (prop.maxLength && prop.maxLength > 100) || ['body', 'description', 'notes', 'summary'].includes(key);
      if (isLong) {
        fieldsHtml += `<textarea name="${escapeHtml(key)}" class="editor-textarea" data-schema-type="string"${isReq ? ' required' : ''}>${escapeHtml(val || '')}</textarea>`;
      } else {
        fieldsHtml += `<input type="text" name="${escapeHtml(key)}" class="editor-input" data-schema-type="string" value="${escapeHtml(val || '')}"${isReq ? ' required' : ''}>`;
      }
    } else if (prop.type === 'boolean') {
      const checked = Boolean(val) ? ' checked' : '';
      fieldsHtml += `<label class="editor-checkbox-row"><input type="checkbox" name="${escapeHtml(key)}" data-schema-type="boolean"${checked}> Enabled</label>`;
    } else if (prop.type === 'number' || prop.type === 'integer') {
      const numVal = val !== undefined && val !== null ? val : '';
      fieldsHtml += `<input type="number" name="${escapeHtml(key)}" class="editor-input" data-schema-type="${escapeHtml(prop.type)}" value="${escapeHtml(String(numVal))}"${isReq ? ' required' : ''}>`;
    } else if (prop.type === 'array' && prop.items?.type === 'string') {
      const lines = Array.isArray(val) ? val.join('\n') : '';
      fieldsHtml += `<textarea name="${escapeHtml(key)}" class="editor-textarea" data-schema-type="array-string" placeholder="One item per line"${isReq ? ' required' : ''}>${escapeHtml(lines)}</textarea>`;
    } else {
      const jsonStr = val !== undefined ? JSON.stringify(val, null, 2) : '';
      fieldsHtml += `<textarea name="${escapeHtml(key)}" class="editor-textarea editor-textarea-json" data-schema-type="json"${isReq ? ' required' : ''}>${escapeHtml(jsonStr)}</textarea>`;
    }

    fieldsHtml += `</div>`;
  }

  return `
    <div class="editor-box">
      <div class="editor-header">
        <strong>Direct Edit: ${escapeHtml(contentId)} (${escapeHtml(typeId)})</strong>
        <button type="button" class="btn btn-sm btn-outline btn-compact" data-action="close-content-editor">Cancel</button>
      </div>
      <div id="contentEditorError" class="form-error-banner d-none"></div>
      <form data-action="submit-direct-content" data-content-id="${escapeHtml(contentId)}">
        ${fieldsHtml}
        <div class="editor-actions">
          <button type="submit" class="btn btn-sm btn-plum">Save published changes</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="close-content-editor">Cancel</button>
        </div>
      </form>
    </div>
  `;
}

async function submitDirectContent(form) {
  const contentId = form.getAttribute('data-content-id');
  const item = siteContentItems.find(i => i.id === contentId);
  if (!item) return;
  const schema = siteContentTypes[item.type_id];
  const props = schema?.properties || {};

  const errorDiv = document.getElementById('contentEditorError');
  if (errorDiv) {
    errorDiv.textContent = '';
    errorDiv.classList.add('d-none');
  }

  const payload = {};
  for (const [key, prop] of Object.entries(props)) {
    const el = form.elements[key];
    if (!el) continue;

    const schemaType = el.getAttribute('data-schema-type');
    if (schemaType === 'boolean') {
      payload[key] = el.checked;
    } else if (schemaType === 'number') {
      payload[key] = el.value === '' ? null : Number(el.value);
    } else if (schemaType === 'integer') {
      payload[key] = el.value === '' ? null : parseInt(el.value, 10);
    } else if (schemaType === 'array-string') {
      payload[key] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (schemaType === 'json') {
      try {
        payload[key] = el.value.trim() ? JSON.parse(el.value) : null;
      } catch (err) {
        if (errorDiv) {
          errorDiv.textContent = `Field ${key} contains invalid JSON: ${err.message}`;
          errorDiv.classList.remove('d-none');
        }
        return;
      }
    } else {
      payload[key] = el.value;
    }
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch('/api/agent/change/direct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_id: contentId, data: payload })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || data.refusal || 'Failed to save content');
    }

    closeContentEditor();
    await Promise.all([loadSiteContent(), loadRecentChanges()]);
  } catch (e) {
    if (errorDiv) {
      errorDiv.textContent = e.message;
      errorDiv.classList.remove('d-none');
    } else {
      alert(`Error saving content: ${e.message}`);
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

let recentChanges = [];

async function loadRecentChanges() {
  try {
    const res = await fetch('/api/staff/recent-changes');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load recent changes');

    recentChanges = data.changes || data.recent_changes || [];
    renderRecentChanges();
  } catch (e) {
    const list = document.getElementById('recentChangesList');
    if (list) list.innerHTML = `<p class="muted small text-center my-20">Error loading recent changes: ${escapeHtml(e.message)}</p>`;
  }
}

function renderRecentChanges() {
  const container = document.getElementById('recentChangesList');
  if (!container) return;

  if (recentChanges.length === 0) {
    container.innerHTML = '<p class="muted small text-center my-20">No recent changes recorded.</p>';
    return;
  }

  let html = '';
  for (const c of recentChanges) {
    const isUndone = c.is_undone;
    const canUndo = c.restorable || c.can_undo;
    const timeStr = c.at || '';

    html += `
      <div class="recent-change-row">
        <div class="recent-change-meta">
          <div class="recent-change-action">${escapeHtml(c.action)} <span class="small muted">(${escapeHtml(c.entity)}:${escapeHtml(c.entity_id || '')})</span></div>
          <div class="recent-change-detail">Actor: <strong>${escapeHtml(c.actor)}</strong> - <span class="recent-change-time">${escapeHtml(timeStr)}</span></div>
        </div>
        <div>
          ${canUndo ? `<button class="btn btn-sm btn-outline btn-compact" data-action="undo-change" data-audit-id="${escapeHtml(String(c.id))}">Undo</button>` : ''}
          ${isUndone ? `<span class="badge badge-outline">Undone</span>` : ''}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

async function handleUndoChange(auditId, button) {
  if (!window.confirm(`Undo change #${auditId}? This will restore the previous state.`)) {
    return;
  }

  if (button) button.disabled = true;

  try {
    const res = await fetch(`/api/staff/undo/${auditId}`, {
      method: 'POST'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to undo change');
    }

    await Promise.all([
      loadRecentChanges(),
      loadSiteContent(),
      loadFollowups(),
      (async () => {
        const panel = document.getElementById('caregiverRecordPanel');
        if (panel && panel.dataset.caregiverId) {
          await viewCaregiver(panel.dataset.caregiverId);
        }
      })()
    ]);
  } catch (e) {
    alert(`Undo failed: ${e.message}`);
    if (button) button.disabled = false;
  }
}
