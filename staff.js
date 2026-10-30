function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// datetime-local fields use the browser's wall clock; ISO strings use UTC.
function localDateTimeValue(date) {
  if (Number.isNaN(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatContactTime(value) {
  if (!value) return 'N/A';
  const normalized = String(value).replace(' ', 'T');
  // SQLite timestamps without an offset are stored in UTC as well.
  const instant = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : normalized + 'Z';
  return localDateTimeValue(new Date(instant)).replace('T', ' ') || 'N/A';
}

function formatStatusLine({ needsAttentionCount = 0, eventsThisWeekCount = 0, grantsInReviewCount = 0 }) {
  const attentionText = needsAttentionCount === 0
    ? 'Nothing needs attention'
    : (needsAttentionCount === 1 ? '1 needs attention' : `${needsAttentionCount} need attention`);

  const eventsText = eventsThisWeekCount === 0
    ? 'no events this week'
    : (eventsThisWeekCount === 1 ? '1 event this week' : `${eventsThisWeekCount} events this week`);

  const grantsText = grantsInReviewCount === 0
    ? 'no grants in review'
    : (grantsInReviewCount === 1 ? '1 grant in review' : `${grantsInReviewCount} grants in review`);

  return `${attentionText} · ${eventsText} · ${grantsText}`;
}

async function updateStatusLine() {
  const statusEl = document.getElementById('staffStatusLine');
  if (!statusEl) return;

  try {
    const [qRes, evRes, gRes] = await Promise.allSettled([
      fetch('/api/staff/queue'),
      fetch('/api/events'),
      fetch('/api/grants?status=in_review')
    ]);

    let needsAttentionCount = 0;
    if (qRes.status === 'fulfilled' && qRes.value && qRes.value.ok) {
      const qData = await qRes.value.json().catch(() => ({}));
      if (qData.ok && Array.isArray(qData.queue)) {
        needsAttentionCount = qData.queue.filter(fu => fu.status === 'open').length;
      }
    }

    let eventsThisWeekCount = 0;
    if (evRes.status === 'fulfilled' && evRes.value && evRes.value.ok) {
      const evData = await evRes.value.json().catch(() => ({}));
      if (evData.ok && Array.isArray(evData.events)) {
        const now = new Date();
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfWeek = new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000);
        eventsThisWeekCount = evData.events.filter(ev => {
          if (!ev.starts_at) return false;
          const d = new Date(ev.starts_at.replace(' ', 'T'));
          return !isNaN(d.getTime()) && d >= startOfWeek && d < endOfWeek;
        }).length;
      }
    }

    let grantsInReviewCount = 0;
    if (gRes.status === 'fulfilled' && gRes.value && gRes.value.ok) {
      const gData = await gRes.value.json().catch(() => ({}));
      if (gData.ok && Array.isArray(gData.grants)) {
        grantsInReviewCount = gData.grants.filter(g => g.status === 'in_review').length;
      }
    }

    statusEl.textContent = formatStatusLine({
      needsAttentionCount,
      eventsThisWeekCount,
      grantsInReviewCount
    });
  } catch (e) {
    console.error('Failed to update status line:', e);
  }
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
      if (body) body.innerHTML = '<tr><td colspan="5" class="text-center muted small">No caregivers found matching criteria.</td></tr>';
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
            if (Array.isArray(parsed) && parsed.length > 0) {
              segmentsStr = parsed.map(s => {
                const segEsc = escapeHtml(s);
                return `<button type="button" class="segment-tag-btn" data-action="filter-segment" data-segment="${segEsc}" title="Filter by ${segEsc}">${segEsc}</button>`;
              }).join(' ');
            }
          } catch (e) {
            segmentsStr = escapeHtml(cg.segment_tags);
          }
        }

        const contact = [cg.email, cg.phone].filter(Boolean).map(escapeHtml).join(' · ') || 'None';
        const statusBadge = cg.status === 'active' ? 'badge-green' : 'badge-outline';

        return `
          <tr>
            <td><strong>${name}</strong></td>
            <td><span class="small">${contact}</span></td>
            <td><span class="badge ${statusBadge}">${escapeHtml(cg.status || 'unknown')}</span></td>
            <td><span class="small muted">${segmentsStr || 'None'}</span></td>
            <td><button type="button" class="btn btn-sm btn-outline" data-action="view-caregiver" data-caregiver-id="${escapeHtml(cg.id)}" aria-label="Open or edit caregiver: ${name}">Open/Edit</button></td>
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

function filterBySegment(segment) {
  if (!segment) return;
  const select = document.getElementById('caregiverSearchSegment');
  if (select) {
    let optionExists = false;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === segment) {
        optionExists = true;
        break;
      }
    }
    if (!optionExists) {
      const opt = document.createElement('option');
      opt.value = segment;
      opt.textContent = segment;
      select.appendChild(opt);
    }
    select.value = segment;
  }
  searchCaregivers(0);
}

async function loadStaffConsole() {
  await Promise.all([
    loadFollowups(),
    loadEvents(),
    loadGrants(),
    searchCaregivers(0),
    loadSiteContent(),
    loadRecentChanges(),
    loadStaffTeam(),
    loadWellnessCaregivers()
  ]);
  if (currentEventId) {
    await loadRegistrations(currentEventId, currentEventTitle);
  }
  updateStatusLine();
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

// A focused caregiver view preserves the mounted dashboard search, filters and paging.
let caregiverDetailOpen = false;
let caregiverDetailEpoch = 0;
let caregiverReturnFocus = null;
let caregiverDashboardScroll = 0;

function openCaregiverDetail() {
  const dashboard = document.getElementById('staffDashboardView');
  const detail = document.getElementById('caregiverDetailView');
  if (!dashboard || !detail) return;
  const firstOpen = !caregiverDetailOpen;
  if (firstOpen) {
    caregiverReturnFocus = document.activeElement;
    caregiverDashboardScroll = window.scrollY || 0;
  }
  caregiverDetailOpen = true;
  dashboard.classList.add('d-none');
  detail.classList.remove('d-none');
  if (firstOpen) document.getElementById('caregiverBackButton')?.focus();
}

function openCaregiverEditor() {
  const editor = document.getElementById('caregiverEditDetails');
  if (!editor) return;
  editor.open = true;
  editor.querySelector('[name="first_name"]')?.focus();
}

function backToStaffDashboard() {
  caregiverDetailEpoch++;
  caregiverDetailOpen = false;
  document.getElementById('caregiverDetailView')?.classList.add('d-none');
  document.getElementById('staffDashboardView')?.classList.remove('d-none');
  const panel = document.getElementById('caregiverRecordPanel');
  if (panel) { panel.innerHTML = ''; delete panel.dataset.caregiverId; }
  currentCaregiverId = null;
  currentGrantId = null;
  const usableOpener = caregiverReturnFocus && caregiverReturnFocus.isConnected !== false
    && /^(BUTTON|INPUT|SELECT|TEXTAREA|A|SUMMARY)$/.test(caregiverReturnFocus.tagName || '');
  const focus = usableOpener ? caregiverReturnFocus : document.getElementById('staffDashboardHeading');
  focus?.focus({ preventScroll: true });
  window.scrollTo(0, caregiverDashboardScroll);
  caregiverReturnFocus = null;
}

async function viewCaregiver(id) {
  const epoch = ++caregiverDetailEpoch;
  openCaregiverDetail();
  const recordPanel = document.getElementById('caregiverRecordPanel');
  if (recordPanel) recordPanel.innerHTML = '<p role="status">Loading caregiver record…</p>';
  try {
    const res = await fetch(`/api/staff/caregiver/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (epoch !== caregiverDetailEpoch) return;
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
              const when = escapeHtml(formatContactTime(ch.occurred_at));
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

    const nowLocal = localDateTimeValue(new Date());

    panel.innerHTML = `
      <h2 id="caregiverDetailHeading" tabindex="-1">Caregiver record — ${name} ${memberBadge} ${statusBadge}</h2>
      <button type="button" class="btn btn-sm btn-outline mb-16" data-action="caregiver-edit">Edit caregiver details</button>
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

      <details class="mt-16" id="caregiverEditDetails">
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
    const heading = document.getElementById('caregiverDetailHeading');
    heading?.focus();
  } catch (e) {
    if (epoch !== caregiverDetailEpoch) return;
    if (recordPanel) recordPanel.innerHTML = '<p role="alert">Could not load this caregiver. Return to the dashboard and try opening the record again.</p>';
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
      if (state === 'published') {
        actions.push(`<button type="button" class="btn btn-sm btn-outline btn-compact" data-action="unpublish-event" data-event-id="${escapeHtml(ev.id)}">Unpublish</button>`);
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
      <div class="field mb-8">
        <label class="form-label-small" for="newEventDescription">Description</label>
        <textarea id="newEventDescription" name="description" class="editor-input" rows="3" maxlength="5000"></textarea>
      </div>
      <div class="field mb-8">
        <label class="form-label-small" for="newEventRegistrationUrl">External registration link (optional)</label>
        <input type="url" id="newEventRegistrationUrl" name="registration_url" class="editor-input" maxlength="2048" placeholder="https://">
        <p class="small muted">Leave blank to use Hub registration. An external link sends visitors to that registration site.</p>
      </div>
      <div class="editor-checkbox-row mb-12">
        <input type="checkbox" id="newEventRecurring" name="recurring">
        <label for="newEventRecurring">Recurring event</label>
      </div>
      <div id="newEventError" class="form-error-banner d-none"></div>
      <p class="small muted">After creating the draft, choose Edit to add an event photo.</p>
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
    description: form.description.value.trim() || null,
    registration_url: form.registration_url.value.trim() || null,
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

const eventPhotoPending = new Set();
const eventPhotoUncertain = new Set();

function eventPhotoEditor(ev) {
  const blocked = ev.publish_state === 'archived' || eventPhotoPending.has(ev.id) || eventPhotoUncertain.has(ev.id);
  return `
    <form data-action="submit-event-photo" data-event-id="${escapeHtml(ev.id)}" data-photo-key="${escapeHtml(ev.photo_key || '')}" class="event-photo-editor">
      <h3>Event photo</h3>
      ${ev.photo_key ? `<img class="event-photo-preview" src="/api/staff/event-photo/${encodeURIComponent(ev.id)}" alt="${escapeHtml(ev.photo_alt || 'Event photo')}">` : '<p class="small muted">No photo attached.</p>'}
      <p class="small muted">Photos appear on the public event card when the event is published. JPEG, PNG or still WebP, up to 5 MB.</p>
      <label class="editor-label" for="eventPhotoFile">Choose a photo</label>
      <input id="eventPhotoFile" name="photo" type="file" accept="image/jpeg,image/png,image/webp" class="editor-input"${blocked ? ' disabled' : ''}>
      <label class="editor-label" for="eventPhotoAlt">Short photo description (optional)</label>
      <input id="eventPhotoAlt" name="alt" type="text" maxlength="300" class="editor-input" value="${escapeHtml(ev.photo_alt || '')}"${blocked ? ' disabled' : ''}>
      <p data-photo-message role="status" class="small">${eventPhotoUncertain.has(ev.id) ? 'Reload the page to check the previous save before trying again.' : ev.publish_state === 'archived' ? 'Archived events cannot change photos.' : ''}</p>
      <div class="editor-actions">
        <button type="submit" class="btn btn-sm btn-plum"${blocked ? ' disabled' : ''}>${ev.photo_key ? 'Replace photo' : 'Upload photo'}</button>
        ${ev.photo_key ? `<button type="submit" name="photo_action" value="remove" class="btn btn-sm btn-outline"${blocked ? ' disabled' : ''}>Remove photo</button>` : ''}
      </div>
    </form>`;
}

async function submitEventPhoto(form, removed = false) {
  const id = form.getAttribute('data-event-id');
  if (eventPhotoPending.has(id) || eventPhotoUncertain.has(id)) return;
  const message = form.querySelector('[data-photo-message]');
  const file = form.querySelector('[name="photo"]').files[0];
  if (!removed && (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
    message.textContent = 'Choose a JPEG, PNG or WebP photo up to 5 MB.';
    return;
  }
  eventPhotoPending.add(id);
  const buttons = Array.from(form.querySelectorAll('button'));
  buttons.forEach(button => { button.disabled = true; });
  message.textContent = removed ? 'Removing photo…' : 'Saving photo…';
  let responseReceived = false;
  try {
    const body = new FormData();
    body.set('request_id', crypto.randomUUID());
    body.set('expected_photo_key', form.getAttribute('data-photo-key') || '');
    if (removed) body.set('remove', '1');
    else {
      body.set('photo', file);
      body.set('alt', form.querySelector('[name="alt"]').value.trim());
    }
    const response = await fetch('/api/staff/event-photo/' + encodeURIComponent(id), { method: 'POST', body });
    const data = await response.json();
    responseReceived = true;
    if (!response.ok || !data.ok) {
      if (data.uncertain || data.saved || response.status >= 500) eventPhotoUncertain.add(id);
      throw new Error(data.message || 'The photo was not saved. Refresh the event before trying again.');
    }
    const current = staffEvents.find(event => event.id === id);
    if (current) { current.photo_key = data.photo_key; current.photo_alt = data.photo_alt; }
    await loadEvents();
    await loadRecentChanges();
    eventPhotoPending.delete(id);
    openEditEvent(id);
    const resultMessage = document.querySelector('[data-photo-message]');
    if (resultMessage) resultMessage.textContent = removed ? 'Photo removed.' : 'Photo saved.';
  } catch (error) {
    // A failed response can follow a successful write. Never silently replay it.
    if (!responseReceived) eventPhotoUncertain.add(id);
    message.textContent = eventPhotoUncertain.has(id)
      ? 'The save could not be confirmed. Reload the page to check the event before trying again.'
      : error.message;
  } finally {
    eventPhotoPending.delete(id);
    if (!eventPhotoUncertain.has(id)) buttons.forEach(button => { button.disabled = false; });
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
        <div class="editor-field">
          <label class="editor-label" for="editEventDescription">Description</label>
          <textarea id="editEventDescription" name="description" class="editor-input" rows="3" maxlength="5000">${escapeHtml(ev.description || '')}</textarea>
        </div>
        <div class="editor-field">
          <label class="editor-label" for="editEventRegistrationUrl">External registration link (optional)</label>
          <input type="url" id="editEventRegistrationUrl" name="registration_url" class="editor-input" maxlength="2048" value="${escapeHtml(ev.registration_url || '')}" placeholder="https://">
          <p class="small muted">Leave blank to use Hub registration. An external link sends visitors to that registration site.</p>
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
      ${eventPhotoEditor(ev)}
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
    description: form.description.value.trim() || null,
    registration_url: form.registration_url.value.trim() || null,
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

async function unpublishEvent(eventId) {
  if (!confirm('Hide this event from the public calendar? Its details and registrations will be kept. You can publish it again.')) return;
  try {
    const res = await fetch(`/api/staff/event/${encodeURIComponent(eventId)}/unpublish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to unpublish event');
    await loadEvents();
    await loadRecentChanges();
  } catch (e) {
    alert(`Unpublish failed: ${e.message}`);
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
  initStaffAssistantDisclosure();
  void initWebJobFeature();
  initStaffChatTargets();
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
  const refreshWellnessBtn = document.getElementById('refreshWellnessBtn');
  if (refreshWellnessBtn) {
    refreshWellnessBtn.addEventListener('click', function () {
      loadWellnessCaregivers();
    });
  }
  const refreshStaffBtn = document.getElementById('refreshStaffTeamBtn');
  if (refreshStaffBtn) {
    refreshStaffBtn.addEventListener('click', function () {
      loadStaffTeam();
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
  } else if (formAction === 'submit-event-photo') {
    e.preventDefault();
    submitEventPhoto(form, e.submitter?.value === 'remove');
  } else if (formAction === 'submit-add-staff') {
    e.preventDefault();
    submitAddStaff(form);
  }
});

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let recordTimer = null;

function setMicStatus(message, isError = false) {
  const statusEl = document.getElementById('micStatus');
  if (!statusEl) return;
  if (!message) {
    statusEl.textContent = '';
    statusEl.classList.add('d-none');
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.remove('d-none');
}

function updateMicUi(recording) {
  const btn = document.getElementById('micBtn');
  if (!btn) return;
  if (recording) {
    btn.classList.add('recording');
    btn.setAttribute('aria-label', 'Stop recording');
    btn.title = 'Stop recording';
    btn.textContent = '⏹';
  } else {
    btn.classList.remove('recording');
    btn.setAttribute('aria-label', 'Record voice note');
    btn.title = 'Speak message';
    btn.textContent = '🎤';
  }
}

async function startRecording() {
  if (isRecording) return;
  setMicStatus('');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setMicStatus('Microphone is not supported in this browser.', true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async function () {
      // Release microphone tracks
      stream.getTracks().forEach(track => track.stop());

      if (audioChunks.length === 0) {
        setMicStatus('No audio was recorded.', true);
        return;
      }

      const mimeType = mediaRecorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunks, { type: mimeType });

      if (audioBlob.size === 0) {
        setMicStatus('No audio was recorded.', true);
        return;
      }

      if (audioBlob.size > 25 * 1024 * 1024) {
        setMicStatus('Audio exceeds the 25 MB limit.', true);
        return;
      }

      setMicStatus('Transcribing voice note…');

      try {
        const res = await fetch('/api/agent/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': mimeType },
          body: audioBlob,
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          const errMsg = data.error || 'Server error during transcription';
          setMicStatus(`Transcription failed: ${errMsg}`, true);
          return;
        }

        const text = (data.text || '').trim();
        if (text) {
          const input = document.getElementById('chatInput');
          if (input) {
            input.value = input.value.trim() ? `${input.value.trim()} ${text}` : text;
            input.focus();
          }
          setMicStatus('');
        } else {
          setMicStatus('No speech recognized.', true);
        }
      } catch (err) {
        setMicStatus(`Transcription failed: ${err.message}`, true);
      }
    };

    // A delayed microphone permission response must not start hidden recording.
    setStaffAssistantExpanded(true, false);
    mediaRecorder.start();
    isRecording = true;
    updateMicUi(true);
    setMicStatus('Recording voice note… (press stop or mic when done)');

    // 2-minute max duration cap
    recordTimer = setTimeout(function () {
      if (isRecording) {
        stopRecording();
      }
    }, 2 * 60 * 1000);
  } catch (err) {
    console.error('Microphone error:', err);
    setMicStatus('Microphone access was denied or is unavailable.', true);
    isRecording = false;
    updateMicUi(false);
  }
}

function stopRecording() {
  if (recordTimer) {
    clearTimeout(recordTimer);
    recordTimer = null;
  }
  if (!isRecording) return;
  isRecording = false;
  updateMicUi(false);

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

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
  } else if (action === 'caregiver-edit') {
    e.stopPropagation();
    openCaregiverEditor();
  } else if (action === 'caregiver-back') {
    e.stopPropagation();
    backToStaffDashboard();
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
  } else if (action === 'filter-segment') {
    e.stopPropagation();
    const seg = target.getAttribute('data-segment');
    filterBySegment(seg);
  } else if (action === 'agent-mic') {
    e.stopPropagation();
    toggleRecording();
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
  } else if (action === 'agent-select-candidate') {
    e.stopPropagation();
    selectAgentCandidateTarget(target);
  } else if (action === 'agent-web-job-recover') {
    e.stopPropagation();
    void recoverAgentWebJobHold();
  } else if (action === 'agent-web-job-legacy-reconcile') {
    e.stopPropagation();
    void recoverAgentWebJobHold(document.getElementById('agentLegacyJobId')?.value?.trim());
  } else if (action === 'edit-content-item') {
    e.stopPropagation();
    const id = target.getAttribute('data-content-id');
    openContentEditor(id);
  } else if (action === 'close-content-editor') {
    e.stopPropagation();
    closeContentEditor();
  } else if (action === 'wellness-show') {
    e.stopPropagation();
    showWellnessChart();
  } else if (action === 'staff-edit' || action === 'staff-cancel' || action === 'staff-save' || action === 'staff-deactivate' || action === 'staff-reactivate') {
    e.stopPropagation();
    staffTeamAction(action.replace('staff-', ''), target);
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
  } else if (action === 'unpublish-event') {
    e.stopPropagation();
    const id = target.getAttribute('data-event-id');
    unpublishEvent(id);
  } else if (action === 'archive-event') {
    e.stopPropagation();
    const id = target.getAttribute('data-event-id');
    archiveEvent(id);
  }
});

// Presentation only: hiding the panel never resets drafts, selection or HOLD.
function setStaffAssistantExpanded(expanded, moveFocus = true) {
  const toggle = document.getElementById('staffAssistantToggle');
  const panel = document.getElementById('staffAssistantPanel');
  if (!toggle || !panel) return;
  if (!expanded && isRecording) {
    setMicStatus('Stop recording with the microphone button before closing the assistant.');
    document.getElementById('micBtn')?.focus();
    return;
  }
  const focusWasInside = panel.contains(document.activeElement);
  panel.hidden = !expanded;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.textContent = expanded ? 'Close Legacy Assistant' : 'Open Legacy Assistant';
  if (expanded && moveFocus) document.getElementById('chatInput')?.focus();
  else if (!expanded && (moveFocus || focusWasInside)) toggle.focus();
}

function initStaffAssistantDisclosure() {
  const toggle = document.getElementById('staffAssistantToggle');
  const panel = document.getElementById('staffAssistantPanel');
  const close = document.getElementById('staffAssistantClose');
  if (!toggle || !panel || !close) return;
  // Do not steal focus on load or persist another person's open conversation.
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => setStaffAssistantExpanded(panel.hidden));
  close.addEventListener('click', () => setStaffAssistantExpanded(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    setStaffAssistantExpanded(false);
  });
}

// Extend the browser chat controls without changing the approval transport.
let lastClarificationRequest = '';

function initStaffChatTargets() {
  const area = document.getElementById('chatAreaSelect');
  if (!area) return;
  if (!Array.from(area.options).some(option => option.value === 'form')) {
    const option = document.createElement('option');
    option.value = 'form';
    option.textContent = 'Forms';
    area.appendChild(option);
  }
  if (!document.getElementById('chatContentTarget')) {
    const label = document.createElement('label');
    label.htmlFor = 'chatContentTarget';
    label.textContent = 'Existing content to change:';
    label.id = 'chatContentTargetLabel';
    label.className = 'chat-area-label';
    const select = document.createElement('select');
    select.id = 'chatContentTarget';
    select.className = 'chat-area-select';
    area.parentElement.appendChild(label);
    area.parentElement.appendChild(select);
  }
  area.addEventListener('change', refreshStaffChatTargets);
  refreshStaffChatTargets();
}

function chatContentItems(area) {
  return siteContentItems.filter(item => {
    if (item.status !== 'published') return false;
    if (area === 'auto') return true;
    const isForm = item.type_id === 'page_section' && item.id.startsWith('ps_form.');
    return area === 'form' ? isForm : !isForm;
  });
}

function refreshStaffChatTargets() {
  const area = document.getElementById('chatAreaSelect')?.value || 'auto';
  const select = document.getElementById('chatContentTarget');
  if (!select) return;
  const active = area === 'auto' || area === 'content' || area === 'form';
  select.hidden = !active;
  const label = document.getElementById('chatContentTargetLabel');
  if (label) label.hidden = !active;
  const previous = select.dataset.area === area ? select.value : '';
  select.dataset.area = area;
  select.innerHTML = '<option value="">Choose existing content to edit…</option>' +
    chatContentItems(area).map(item =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)}</option>`).join('');
  if (chatContentItems(area).some(item => item.id === previous)) select.value = previous;
}

function selectAgentCandidateTarget(button) {
  if (!button) return;
  const targetId = button.getAttribute('data-target-id') || '';
  const area = button.getAttribute('data-area') || (targetId.startsWith('ps_form.') ? 'form' : 'content');
  const details = document.getElementById('chatAdvancedTargeting');
  if (details) details.open = true;
  const areaSelect = document.getElementById('chatAreaSelect');
  if (areaSelect) {
    areaSelect.value = area;
    refreshStaffChatTargets();
  }
  const targetSelect = document.getElementById('chatContentTarget');
  if (targetSelect && targetId) {
    targetSelect.value = targetId;
  }
  const input = document.getElementById('chatInput');
  if (input && !input.value.trim() && lastClarificationRequest) {
    input.value = lastClarificationRequest;
  }
  if (input && typeof input.focus === 'function') {
    input.focus();
  }
}

let agentConfirmationHold = false;
let agentConfirmationPending = false;
let agentBusinessConfirmationHold = false;
let agentHoldGeneration = 0;
try { agentConfirmationHold = window.sessionStorage?.getItem('agent-confirmation-hold') === '1'; }
catch { agentConfirmationHold = true; }
function holdAgentConfirmation(row) {
  agentBusinessConfirmationHold = true;
  agentHoldGeneration++;
  agentConfirmationHold = true;
  try {
    window.sessionStorage?.setItem('agent-business-confirmation-hold-v1', '1');
    window.sessionStorage?.setItem('agent-confirmation-hold', '1');
  } catch { /* In-memory HOLD remains. */ }
  if (row) {
    row.dataset ||= {};
    row.dataset.confirmationState = 'hold';
    row.innerHTML = '<span class="chat-confirm-discarded">Confirmation on hold. Do not retry, discard or replace the draft until an operator checks the website result.</span>';
  }
}
function reserveBusinessConfirmation() {
  agentHoldGeneration++;
  try {
    window.sessionStorage?.setItem('agent-business-confirmation-pending-v1', '1');
    if (window.sessionStorage && window.sessionStorage.getItem('agent-business-confirmation-pending-v1') !== '1') throw new Error('storage');
    return true;
  } catch { holdAgentConfirmation(null); return false; }
}
function finishBusinessConfirmation() {
  window.sessionStorage?.setItem('agent-business-confirmation-pending-v1', '');
  if (window.sessionStorage?.getItem('agent-business-confirmation-pending-v1')) throw new Error('storage');
}
async function confirmAgentChange(target) {
  const changeId = target.getAttribute('data-change-id');
  const draftId = target.getAttribute('data-draft-id');
  if (!changeId && !draftId) return;
  const row = target.closest('.confirm-row');
  if (agentConfirmationHold || agentConfirmationPending || agentWebJobPending || row?.dataset?.confirmationState) return;
  const previewVersion = target.getAttribute('data-preview-version');
  if (!previewVersion) { holdAgentConfirmation(row); return; }
  // Reserve every chat mutation before yielding, including controls on other previews.
  agentConfirmationPending = true;
  if (!reserveBusinessConfirmation()) return;
  if (row) {
    row.dataset ||= {};
    row.dataset.confirmationState = 'confirming';
    row.querySelectorAll?.('button').forEach(button => { button.disabled = true; });
  }
  try {
    const res = await fetch(draftId ? '/api/agent/confirm' : '/api/agent/change/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(draftId ? { draft_id: draftId } : { change_id: changeId }), preview_version: previewVersion })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      holdAgentConfirmation(row);
      return;
    }
    finishBusinessConfirmation();
    if (row) {
      row.dataset.confirmationState = 'published';
      row.innerHTML = '<span class="chat-confirm-published">✓ Published — logged to the audit trail.</span>';
    }
    await loadStaffConsole();
    const panel = document.getElementById('caregiverRecordPanel');
    if (panel && panel.dataset.caregiverId) {
      await viewCaregiver(panel.dataset.caregiverId);
    }
    agentConfirmationPending = false;
  } catch (e) {
    holdAgentConfirmation(row);
  }
}

async function discardAgentChange(target) {
  if (agentConfirmationHold || agentConfirmationPending || agentWebJobPending || target.closest('.confirm-row')?.dataset?.confirmationState) return;
  const changeId = target.getAttribute('data-change-id');
  const draftId = target.getAttribute('data-draft-id');
  if (!changeId && !draftId) return;
  const row = target.closest('.confirm-row');
  const previewVersion = target.getAttribute('data-preview-version');
  if (!previewVersion) { holdAgentConfirmation(row); return; }
  // Discard competes with confirmation: reserve all previews before the first await.
  agentConfirmationPending = true;
  if (!reserveBusinessConfirmation()) return;
  if (row) {
    row.dataset ||= {};
    row.dataset.confirmationState = 'discarding';
    row.querySelectorAll?.('button').forEach(button => { button.disabled = true; });
  }
  try {
    const res = await fetch(draftId ? '/api/agent/discard' : '/api/agent/change/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(draftId ? { draft_id: draftId } : { change_id: changeId }), preview_version: previewVersion })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      holdAgentConfirmation(row);
      return;
    }
    finishBusinessConfirmation();
    if (row) {
      row.dataset.confirmationState = 'discarded';
      row.innerHTML = '<span class="chat-confirm-discarded">Draft discarded — nothing changed.</span>';
    }
    agentConfirmationPending = false;
  } catch (e) {
    holdAgentConfirmation(row);
  }
}

let agentWebJobPending = false;
let agentWebJobsEnabled = false;
let agentWebJobActor = null;
let agentWebJobIdentityUnavailable = false;
let agentWebJobRecord = null;
let agentWebJobRecoveryPending = false;
let agentWebJobStorageFault = false;
let agentWebJobRecoveryNode = null;
let agentUnavailableNotice = null;
const AGENT_WEB_JOB_RECORD = 'agent-web-job-record-v1';
const AGENT_WEB_JOB_SESSION = 'agent-web-job-session-v1';
const webJobId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
function validWebJobRecord(record) {
  return record && Object.keys(record).sort().join('|') === ['v','kind','actor','origin','session_id','job_id','idempotency_key','phase'].sort().join('|')
    && record.v === 1 && record.kind === 'web_job' && typeof record.actor === 'string' && record.actor.includes('@') && record.actor.length <= 254
    && record.origin === window.location?.origin && webJobId(record.session_id) && webJobId(record.idempotency_key)
    && (record.job_id === null || webJobId(record.job_id)) && ['create','waiting','materialize'].includes(record.phase);
}
try {
  for (const key of ['agent-confirmation-hold','agent-business-confirmation-hold-v1','agent-business-confirmation-pending-v1']) {
    const value = window.sessionStorage?.getItem(key);
    if (value && value !== '1') throw new Error('hold storage');
  }
  agentBusinessConfirmationHold = window.sessionStorage?.getItem('agent-business-confirmation-hold-v1') === '1'
    || window.sessionStorage?.getItem('agent-business-confirmation-pending-v1') === '1';
  const saved = window.sessionStorage?.getItem(AGENT_WEB_JOB_RECORD);
  if (saved) {
    agentWebJobRecord = JSON.parse(saved);
    if (!validWebJobRecord(agentWebJobRecord)) throw new Error('correlation');
    agentConfirmationHold = true; // Reload of an interrupted attempt never resends.
  }
  if (agentBusinessConfirmationHold) agentConfirmationHold = true;
} catch { agentWebJobStorageFault = true; agentConfirmationHold = true; }
function webJobSession() {
  let session = window.sessionStorage?.getItem(AGENT_WEB_JOB_SESSION);
  if (!session) {
    session = crypto.randomUUID().replaceAll('-', '');
    window.sessionStorage.setItem(AGENT_WEB_JOB_SESSION, session);
  }
  if (!webJobId(session) || window.sessionStorage.getItem(AGENT_WEB_JOB_SESSION) !== session) throw new Error('session');
  return session;
}
function saveWebJobRecord(record) {
  if (!validWebJobRecord(record)) throw new Error('correlation');
  const raw = JSON.stringify(record);
  window.sessionStorage.setItem(AGENT_WEB_JOB_RECORD, raw);
  if (window.sessionStorage.getItem(AGENT_WEB_JOB_RECORD) !== raw) throw new Error('storage');
  agentWebJobRecord = record;
}
function forgetFinishedWebJob() {
  if (!agentWebJobRecord) return;
  window.sessionStorage.setItem(AGENT_WEB_JOB_RECORD, '');
  if (window.sessionStorage.getItem(AGENT_WEB_JOB_RECORD)) throw new Error('storage');
  agentWebJobRecord = null;
}
function holdWebJob() {
  if (!agentWebJobRecord) { holdAgentConfirmation(null); return; } // Old uncorrelated surfaces remain fail-closed.
  agentConfirmationHold = true;
  agentHoldGeneration++;
  renderWebJobRecovery();
}
function renderWebJobRecovery() {
  if (!agentConfirmationHold || !agentWebJobActor || !window.location?.origin) return;
  const body = document.getElementById('chatBody');
  if (!body) return;
  let session;
  try { session = webJobSession(); } catch { agentWebJobStorageFault = true; return; }
  agentWebJobRecoveryNode ||= document.createElement('div');
  agentWebJobRecoveryNode.className = 'msg bot';
  const typed = validWebJobRecord(agentWebJobRecord);
  agentWebJobRecoveryNode.innerHTML = `<p>Request on hold. Nothing is being retried. Check recovery only after the operator has closed the exact request.</p>
    <p class="small">Exact-tab recovery reference: <code>${escapeHtml(session)}</code></p>
    ${agentBusinessConfirmationHold ? '<p>An uncertain business confirmation is separately held. Closing a web job cannot release it.</p>' : ''}
    ${agentWebJobStorageFault ? '<p>Saved correlation is invalid or storage is unavailable. Preserve this tab for exact operator reconciliation; no recovery reset is available.</p>' : ''}
    ${typed ? '<button class="chip-btn" data-action="agent-web-job-recover">Check closed request</button>' : '<p>Legacy hold has no saved job correlation. The operator must reconcile this exact tab and any uncertain confirmation first.</p><input id="agentLegacyJobId" maxlength="32" aria-label="Operator-reconciled closed job ID"><button class="chip-btn" data-action="agent-web-job-legacy-reconcile">Check exact-session reconciliation</button>'}`;
  body.appendChild(agentWebJobRecoveryNode);
}
async function recoverAgentWebJobHold(legacyJobId = null) {
  if (!agentConfirmationHold || agentConfirmationPending || agentWebJobPending || agentWebJobRecoveryPending || agentBusinessConfirmationHold || agentWebJobStorageFault || !agentWebJobActor) return false;
  agentWebJobRecoveryPending = true;
  const generation = agentHoldGeneration;
  try {
    const storage = window.sessionStorage, origin = window.location?.origin;
    if (storage.getItem('agent-business-confirmation-hold-v1') === '1' || storage.getItem('agent-business-confirmation-pending-v1') === '1') return false;
    const raw = storage.getItem(AGENT_WEB_JOB_RECORD) || '';
    const generic = storage.getItem('agent-confirmation-hold') || '';
    const typed = validWebJobRecord(agentWebJobRecord) && raw === JSON.stringify(agentWebJobRecord);
    if (!typed && (raw || generic !== '1' || !webJobId(legacyJobId))) return false;
    if (typed && generic === '1') return false; // Never reinterpret an unrelated generic confirmation HOLD.
    const session = webJobSession(), record = typed ? { ...agentWebJobRecord } : null;
    if (record && (record.actor !== agentWebJobActor || record.origin !== origin || record.session_id !== session)) return false;
    const body = { action:'recover', kind:typed?'web_job':'legacy', job_id:record?.job_id || legacyJobId || null, idempotency_key:record?.idempotency_key || null, session_id:session };
    const { response, data } = await webJobJson('/api/agent/web-jobs', body, Date.now() + 10000);
    if (!response.ok || response.redirected || !data || data.ok !== true || data.kind !== body.kind || data.state !== 'closed_unmaterialized'
      || data.actor !== agentWebJobActor || data.origin !== origin || data.session_id !== session || !webJobId(data.job_id) || !webJobId(data.idempotency_key)
      || body.job_id && data.job_id !== body.job_id || record && data.idempotency_key !== record.idempotency_key
      || !webJobId(data.disposition_id) || data.delivery !== 'unknown' || data.legacy_authorized !== !typed) return false;
    if (generation !== agentHoldGeneration || agentBusinessConfirmationHold || agentConfirmationPending || agentWebJobPending
      || storage.getItem('agent-business-confirmation-hold-v1') === '1' || storage.getItem('agent-business-confirmation-pending-v1') === '1' || (storage.getItem('agent-confirmation-hold') || '') !== generic
      || (storage.getItem(AGENT_WEB_JOB_RECORD) || '') !== raw || storage.getItem(AGENT_WEB_JOB_SESSION) !== session) return false;
    // Persist an exact local receipt first. A crash/error at any intermediate step remains held.
    storage.setItem('agent-web-job-recovery-receipt-v1', JSON.stringify({ v:1,kind:body.kind,actor:data.actor,origin,session_id:session,job_id:data.job_id,idempotency_key:data.idempotency_key,disposition_id:data.disposition_id }));
    if (!typed) {
      saveWebJobRecord({ v:1,kind:'web_job',actor:data.actor,origin,session_id:session,job_id:data.job_id,idempotency_key:data.idempotency_key,phase:'waiting' });
      storage.setItem('agent-confirmation-hold', '');
      if (storage.getItem('agent-confirmation-hold')) throw new Error('storage');
    }
    forgetFinishedWebJob();
    if (storage.getItem('agent-business-confirmation-hold-v1') === '1' || storage.getItem('agent-business-confirmation-pending-v1') === '1' || storage.getItem('agent-confirmation-hold')) return false;
    agentConfirmationHold = false;
    if (agentWebJobRecoveryNode) agentWebJobRecoveryNode.textContent = 'The exact request is closed without materialization; its delivery remains unknown. You may enter a new request. The old request will not be sent again.';
    return true;
  } catch { agentConfirmationHold = true; return false; }
  finally { agentWebJobRecoveryPending = false; }
}
function showAgentUnavailable() {
  const body = document.getElementById('chatBody');
  if (!body) return;
  if (!agentUnavailableNotice) {
    agentUnavailableNotice = document.createElement('div');
    agentUnavailableNotice.className = 'msg bot';
    agentUnavailableNotice.setAttribute?.('role', 'status');
    agentUnavailableNotice.textContent = 'Legacy Assistant is unavailable on this page. Ask the Legacy administrator to check sign-in and the connection. Do not resend an earlier request unless its result has been checked.';
    body.appendChild(agentUnavailableNotice);
  }
  body.scrollTop = body.scrollHeight;
}
async function initWebJobFeature() {
  try {
    const response = await fetch('/api/agent/web-jobs');
    const result = await response.json();
    agentWebJobsEnabled = response.ok && result.ok === true && result.enabled === true;
    agentWebJobActor = agentWebJobsEnabled && !response.redirected && result.origin === window.location?.origin && typeof result.actor === 'string' && result.actor.includes('@') && result.actor.length <= 254 ? result.actor : null;
    agentWebJobIdentityUnavailable = agentWebJobsEnabled && !agentWebJobActor;
    renderWebJobRecovery();
    if (agentWebJobIdentityUnavailable) showAgentUnavailable();
  } catch {
    agentWebJobsEnabled = false; agentWebJobActor = null; agentWebJobIdentityUnavailable = true;
    showAgentUnavailable();
  } // Unknown bootstrap never admits an uncorrelated send.
}
async function webJobJson(path, body, until) {
  const remaining = until - Date.now();
  if (remaining <= 0 || document.hidden) throw new Error('Job request stopped; do not retry.');
  const controller = new AbortController();
  let timer, stopForHidden;
  const stopped = new Promise((resolve, reject) => {
    const stop = () => {
      controller.abort();
      reject(new Error('Job response unknown or deadline reached; do not retry.'));
    };
    timer = setTimeout(stop, remaining);
    stopForHidden = () => { if (document.hidden) stop(); };
    document.addEventListener?.('visibilitychange', stopForHidden);
  });
  try {
    // Abort controls the real response stream; race also bounds body parsing and
    // transports that fail to reject on abort. Late completion has no UI effect.
    return await Promise.race([stopped, (async () => {
      const response = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal, redirect:'error', credentials:'same-origin', cache:'no-store'
      });
      const data = await response.json();
      if (controller.signal.aborted || Date.now() >= until || document.hidden) throw new Error('Job response arrived after its deadline; do not retry.');
      return { response, data };
    })()]);
  } finally {
    clearTimeout(timer);
    document.removeEventListener?.('visibilitychange', stopForHidden);
  }
}
async function awaitCurrentWebJob(initial, pendingNode, until = Date.now() + 60000) {
  // This refresh exists only for this newly-created job and has a hard one-minute budget.
  // No standing timer, restart recovery, model retry or invisible re-post is installed.
  const jobId = initial.job_id;
  if (!/^[a-f0-9]{32}$/.test(jobId || '')) throw new Error('Invalid job receipt; do not retry.');
  let status = initial;
  for (let refresh = 0; refresh < 30; refresh++) {
    if (document.hidden || Date.now() >= until) break;
    if (status.state === 'result') {
      if (agentWebJobRecord) saveWebJobRecord({ ...agentWebJobRecord, phase:'materialize' });
      const { response, data: draft } = await webJobJson('/api/agent/web-jobs', { action: 'materialize', job_id: jobId }, until);
      if (!response.ok || !draft.ok) throw new Error('Job needs review; no change confirmed. Do not retry.');
      return draft; // Existing exact preview/confirm/discard UI below, never auto-confirm.
    }
    if (status.state === 'refused') return { ok: false, terminal_refused:true, refusal: 'The container assistant refused this request. Nothing has been drafted or confirmed.' };
    if (!['pending', 'claimed'].includes(status.state)) throw new Error('Job held or unknown; nothing confirmed. Do not retry.');
    pendingNode.textContent = 'Waiting for the existing container assistant. Nothing has been confirmed.';
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, until - Date.now())));
    if (document.hidden || Date.now() >= until) break;
    const { response, data } = await webJobJson('/api/agent/web-jobs', { action: 'status', job_id: jobId }, until);
    status = data;
    if (!response.ok || !status.ok || status.job_id !== jobId) throw new Error('Job status unknown; do not retry.');
  }
  throw new Error('Job refresh stopped. Nothing confirmed; have an administrator inspect it before another request.');
}

window.agentSend = async function () {
  if (agentWebJobIdentityUnavailable) { showAgentUnavailable(); return; }
  if (agentConfirmationHold || agentConfirmationPending || agentWebJobPending || agentWebJobRecoveryPending) return;
  const input = document.getElementById('chatInput');
  const body = document.getElementById('chatBody');
  const text = (input?.value || '').trim();
  if (!text || !body) return;
  input.value = '';
  const empty = document.getElementById('chatEmptyState');
  if (empty) empty.remove();

  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.textContent = text;
  body.appendChild(userDiv);

  const areaSelect = document.getElementById('chatAreaSelect');
  const selectedArea = areaSelect ? areaSelect.value : 'auto';

  let effectiveArea = selectedArea;
  let isContent = selectedArea === 'auto' || selectedArea === 'content' || selectedArea === 'form';
  let contentItem = null;
  let targetId = null;
  let untargetedContentRequest = false;
  if (isContent) {
    targetId = document.getElementById('chatContentTarget')?.value || '';
    if (targetId) {
      contentItem = chatContentItems(selectedArea).find(item => item.id === targetId);
      if (!contentItem) {
        const botDiv = document.createElement('div');
        botDiv.className = 'msg bot';
        botDiv.textContent = 'Select a published item in this area first. Nothing has been drafted.';
        body.appendChild(botDiv);
        body.scrollTop = body.scrollHeight;
        return;
      }
      if (selectedArea === 'auto') {
        effectiveArea = contentItem.id.startsWith('ps_form.') ? 'form' : 'content';
      }
    } else if (agentWebJobsEnabled) {
      const mentionsOtherTarget = /\b(?:about|programs?|membership|grant|coaching|memory\s+socials?|support\s+group|resources?|faq|partners?|journey|values|story|footer|phone|contact|event|caregiver|workshop)\b/i.test(text);
      const matchesHomeHero = (selectedArea === 'auto' || selectedArea === 'content')
        && !mentionsOtherTarget
        && !/\b(?:request[\s-]+support|intake|name_label)\b/i.test(text)
        && /\b(?:ps_home\.hero|home\.hero|home(?:\s*page)?\s+(?:hero|banner|headline|heading|title|lede|subtitle)|hero\s+(?:banner|headline|heading|title|lede|subtitle|section))\b/i.test(text);
      const matchesRequestSupportForm = (selectedArea === 'auto' || selectedArea === 'form')
        && !mentionsOtherTarget
        && !/\b(?:home(?:\s*page)?|hero|banner)\b/i.test(text)
        && /\b(?:ps_form\.request_support|form\.request_support|request[\s-]+support\s+(?:form|intake|heading|title|label|field|button|copy)|support\s+intake\s+form|name_label)\b/i.test(text);
      const candidateTargetId = (matchesHomeHero && !matchesRequestSupportForm)
        ? 'ps_home.hero'
        : (matchesRequestSupportForm && !matchesHomeHero)
          ? 'ps_form.request_support'
          : '';
      contentItem = candidateTargetId ? chatContentItems(selectedArea).find(item => item.id === candidateTargetId) : null;
      if (!contentItem) {
        const botDiv = document.createElement('div');
        botDiv.className = 'msg bot';
        botDiv.textContent = 'Select a published item in this area first, or specify the homepage hero banner or request support form. Nothing has been drafted.';
        body.appendChild(botDiv);
        body.scrollTop = body.scrollHeight;
        return;
      }
      targetId = contentItem.id;
      effectiveArea = contentItem.id.startsWith('ps_form.') ? 'form' : 'content';
    } else if (selectedArea === 'auto' && /\b(?:create|add|schedule)\b[\s\S]*\b(?:event|support group|memory social|workshop)\b/i.test(text) && !/\b(?:page|section|form|hero|banner|heading|subtitle|lede|button)\b/i.test(text)) {
      isContent = false;
      effectiveArea = 'event';
      targetId = 'new';
    } else {
      untargetedContentRequest = true;
    }
  } else if (selectedArea === 'event') {
    targetId = currentEventId;
    if (!targetId) {
      const botDiv = document.createElement('div');
      botDiv.className = 'msg bot';
      botDiv.textContent = 'Select an event first to draft an event change. Use the existing New Event form to create one.';
      body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
      return;
    }
  } else if (selectedArea === 'caregiver') {
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

  // Reserve synchronously before the FIRST await. A second Enter returns at the
  // entry guard without clearing its text, generating another ID, or posting.
  const webJobLifecycle = agentWebJobsEnabled;
  agentWebJobPending = true;
  const jobDeadline = webJobLifecycle ? Date.now() + 60000 : null;
  let ordinaryPendingNode = null;
  try {
    const draftPath = isContent ? '/api/agent/draft' : '/api/agent/change/draft';
    const draftRequest = untargetedContentRequest
      ? {
          request: text,
          ...(selectedArea === 'content' || selectedArea === 'form' ? { area: selectedArea } : {}),
        }
      : {
          ...(isContent ? { type_id: contentItem.type_id } : { area: effectiveArea }),
          target_id: targetId,
          request: text,
          ...(webJobLifecycle ? { idempotency_key: crypto.randomUUID().replaceAll('-', '') } : {})
        };
    if (webJobLifecycle && agentWebJobActor) {
      saveWebJobRecord({ v:1,kind:'web_job',actor:agentWebJobActor,origin:window.location.origin,session_id:webJobSession(),job_id:null,idempotency_key:draftRequest.idempotency_key,phase:'create' });
    }
    if (!webJobLifecycle) {
      ordinaryPendingNode = document.createElement('div');
      ordinaryPendingNode.className = 'msg bot';
      ordinaryPendingNode.setAttribute?.('role', 'status');
      ordinaryPendingNode.textContent = 'Waiting for your edit preview. This request has not been confirmed. Do not resend it while its result is unclear.';
      body.appendChild(ordinaryPendingNode);
      body.scrollTop = body.scrollHeight;
    }
    const created = webJobLifecycle ? await webJobJson(draftPath, draftRequest, jobDeadline) : null;
    const res = created ? created.response : await fetch(draftPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draftRequest)
    });

    let data = created ? created.data : await res.json();
    const botDiv = ordinaryPendingNode || document.createElement('div');
    botDiv.className = 'msg bot';
    if (ordinaryPendingNode) botDiv.textContent = '';

    if (res.ok && data.ok && data.job_id) {
      if (agentWebJobRecord) saveWebJobRecord({ ...agentWebJobRecord, job_id:data.job_id, phase:'waiting' });
      botDiv.textContent = 'Request saved privately; waiting for the existing container assistant.';
      if (!ordinaryPendingNode) body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
      data = await awaitCurrentWebJob(data, botDiv, jobDeadline || undefined);
    }

    if (res.ok && data.ok && data.clarification_needed) {
      lastClarificationRequest = text;
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const chipsHtml = candidates.length > 0
        ? `<div class="confirm-row" role="group" aria-label="Suggested sections">` +
          candidates.map(cand =>
            `<button type="button" class="chip-btn" data-action="agent-select-candidate" data-target-id="${escapeHtml(cand.id || '')}" data-area="${escapeHtml(cand.area || 'content')}">${escapeHtml(cand.label || cand.id || '')}</button>`
          ).join('') +
          `</div>`
        : '';
      botDiv.innerHTML = `<div class="clarification-msg"><strong>Which section should I update?</strong> ${escapeHtml(data.message || 'Choose a section below or reply with the page and section name.')}${chipsHtml}</div>`;
      if (!ordinaryPendingNode) body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
      return;
    }

    if (!res.ok || !data.ok || !(isContent ? data.draft_id : data.change_id)) {
      if (webJobLifecycle) {
        if (data.terminal_refused === true) forgetFinishedWebJob();
        else holdWebJob();
      }
      botDiv.innerHTML = `⚠️ Refusal: ${escapeHtml(data.refusal || data.error || 'Request refused')}`;
      if (!ordinaryPendingNode) body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
      return;
    }

    const before = isContent ? data.confirmation_preview?.before : data.preview?.before;
    const after = isContent ? data.draft?.data : data.preview?.after;
    const isPreviewObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!isPreviewObject(before) || !isPreviewObject(after) || !/^[a-f0-9]{64}$/.test(data.preview_version || '')) {
      if (webJobLifecycle) holdWebJob();
      // The server may have saved a draft already; do not turn a missing preview into {} or replay it.
      botDiv.textContent = 'Preview unavailable — nothing has been confirmed. A draft may already exist. Do not retry; have an administrator inspect the saved draft.';
      if (!ordinaryPendingNode) body.appendChild(botDiv);
      body.scrollTop = body.scrollHeight;
      return;
    }
    const beforeJson = escapeHtml(JSON.stringify(before || {}, null, 2));
    const afterJson = escapeHtml(JSON.stringify(after || {}, null, 2));
    const resolvedTargetId = data.resolved_target_id || data.draft?.draft_of || contentItem?.id || data.change?.operation || 'change';
    const displayArea = isContent
      ? (effectiveArea === 'form' || String(resolvedTargetId).startsWith('ps_form.') ? 'form' : 'content')
      : effectiveArea;
    const areaLabel = { content: '📚 Content Update', form: '📝 Form Copy Update', grant: '🎁 Grant Transition', caregiver: '👤 Caregiver Update', event: '📅 Event Update' }[displayArea];
    const idAttribute = (isContent ? `data-draft-id="${escapeHtml(data.draft_id)}"` : `data-change-id="${escapeHtml(data.change_id)}"`) + ` data-preview-version="${escapeHtml(data.preview_version)}"`;
    const stagingPreviewSupported = isContent && data.staging_preview_supported !== false;
    const stagingPreviewHref = stagingPreviewSupported ? (data.staging_preview_url || data.preview_url || data.preview_path || '') : '';
    const localPreviewHref = stagingPreviewSupported ? (data.preview_path || '') : '';
    const stagingPreviewHtml = stagingPreviewHref
      ? `<p class="small draft-staging-preview-row"><a href="${escapeHtml(stagingPreviewHref)}" target="_blank" rel="noopener noreferrer" class="preview-staging-link">Open staging preview ↗</a>${localPreviewHref && localPreviewHref !== stagingPreviewHref ? ` · <a href="${escapeHtml(localPreviewHref)}" target="_blank" rel="noopener noreferrer">Preview on this host ↗</a>` : ''} <span class="muted">(unconfirmed draft <code>${escapeHtml(data.draft_id)}</code>)</span></p>`
      : (isContent && data.preview_unavailable_reason
          ? `<p class="small muted draft-staging-preview-unavailable" data-preview-unavailable="true">${escapeHtml(data.preview_unavailable_reason)}</p>`
          : '');

    botDiv.innerHTML = `
      Here's what will change:
      <div class="preview">
        <div class="p-title">${areaLabel} (${escapeHtml(resolvedTargetId)})</div>
        ${isContent ? '<p class="small">Before and after: website preview. Review before confirming.</p>' : ''}
        ${stagingPreviewHtml}
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
        <button class="chip-btn chip-confirm" data-action="agent-change-confirm" ${idAttribute}>Confirm &amp; publish</button>
        <button class="chip-btn chip-cancel" data-action="agent-change-discard" ${idAttribute}>Discard</button>
      </div>
    `;
    if (!ordinaryPendingNode) body.appendChild(botDiv);
    body.scrollTop = body.scrollHeight;
    if (webJobLifecycle) forgetFinishedWebJob();
  } catch (e) {
    if (webJobLifecycle) holdWebJob(); // Typed job HOLD is distinct from uncertain business confirmation.
    const botDiv = ordinaryPendingNode || document.createElement('div');
    botDiv.className = 'msg bot';
    if (ordinaryPendingNode) botDiv.textContent = '';
    botDiv.innerHTML = `Error drafting change: ${escapeHtml(e.message)}${ordinaryPendingNode ? ' A draft may already exist. Do not resend this request; ask the administrator to check its result.' : ''}`;
    if (!ordinaryPendingNode) body.appendChild(botDiv);
    body.scrollTop = body.scrollHeight;
  } finally {
    agentWebJobPending = false; // Persistent HOLD, if set, still blocks every later mutation.
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
    refreshStaffChatTargets();
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
          <button class="btn btn-sm btn-outline btn-compact" data-action="edit-content-item" data-content-id="${escapeHtml(item.id)}" aria-label="Edit wording: ${escapeHtml(label)}">Edit wording</button>
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
  const panel = document.getElementById('siteContentPanel');
  if (panel) panel.open = true;
  const heading = document.getElementById('contentEditorHeading');
  if (heading) heading.focus();
}

function closeContentEditor() {
  const editorContainer = document.getElementById('siteContentEditor');
  if (!editorContainer) return;
  editorContainer.innerHTML = '';
  editorContainer.classList.add('d-none');
}

function contentEditorSchema(schema, data, contentId) {
  if (!schema || typeof schema !== 'object') return null;
  if (!Array.isArray(schema.oneOf)) return schema;
  // Section identity comes from the selected published item, never an editable selector.
  const storedKey = data?.section_key;
  const idKey = typeof contentId === 'string' && contentId.startsWith('ps_') ? contentId.slice(3) : null;
  // Older published rows identify their section in the persisted item ID only.
  // Never use an editable field to choose the schema, or override a conflicting identity.
  if (storedKey !== undefined && idKey && storedKey !== idKey) return null;
  const key = storedKey === undefined ? idKey : storedKey;
  const matches = schema.oneOf.filter(branch => {
    const identity = branch?.properties?.section_key;
    return typeof key === 'string' && identity
      && (identity.const === key || (Array.isArray(identity.enum) && identity.enum.length === 1 && identity.enum[0] === key));
  });
  return matches.length === 1 ? matches[0] : null;
}

function generateSchemaFormHtml(schema, initialData, typeId, contentId) {
  const selected = contentEditorSchema(schema, initialData, contentId);
  if (!selected) {
    return '<p class="small muted" id="contentEditorHeading" tabindex="-1">This section cannot be edited here. Ask X-Centric for help.</p><button type="button" class="btn btn-sm btn-outline" data-action="close-content-editor">Close</button>';
  }
  const props = selected.properties || {};
  const required = selected.required || [];
  const data = initialData || {};
  const label = data.title || data.heading || data.label || data.name || contentId;

  let fieldsHtml = '';
  for (const [key, prop] of Object.entries(props)) {
    if (key === 'section_key' || prop.readOnly) continue;
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
        <h5 class="m-0" id="contentEditorHeading" tabindex="-1">Edit wording: ${escapeHtml(label)}</h5>
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
  let current;
  try {
    current = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
  } catch {
    return;
  }
  const selected = contentEditorSchema(schema, current, item.id);
  const props = selected?.properties || {};

  const errorDiv = document.getElementById('contentEditorError');
  if (errorDiv) {
    errorDiv.textContent = '';
    errorDiv.classList.add('d-none');
  }

  if (!selected || !current || typeof current !== 'object' || Array.isArray(current)) {
    if (errorDiv) {
      errorDiv.textContent = 'This section cannot be edited here. Ask X-Centric for help.';
      errorDiv.classList.remove('d-none');
    }
    return;
  }
  // Direct saves replace the published object. Keep unedited/read-only values and
  // the original section identity instead of dropping them from that replacement.
  const payload = { ...current };
  if (Array.isArray(schema.oneOf) && payload.section_key === undefined) {
    payload.section_key = item.id.slice(3);
  }
  for (const [key, prop] of Object.entries(props)) {
    if (key === 'section_key' || prop.readOnly) continue;
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
    if (list) list.innerHTML = `<p class="muted small text-center my-20">Error loading change log: ${escapeHtml(e.message)}</p>`;
  }
}

function renderRecentChanges() {
  const container = document.getElementById('recentChangesList');
  if (!container) return;

  if (recentChanges.length === 0) {
    container.innerHTML = '<p class="muted small text-center my-20">No changes recorded.</p>';
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

/* ---------- Staff team (schema 0011) ---------- */
let staffMe = null;
let editingStaffEmail = null;
let staffTeam = [];

async function loadStaffTeam() {
  const list = document.getElementById('staffTeamList');
  try {
    const [meRes, teamRes] = await Promise.all([fetch('/api/staff/me'), fetch('/api/staff/team')]);
    const meData = await meRes.json();
    const teamData = await teamRes.json();
    if (!meRes.ok || !meData.ok) throw new Error(meData.error || 'Failed to load your staff record');
    if (!teamRes.ok || !teamData.ok) throw new Error(teamData.error || 'Failed to load staff');
    staffMe = meData.me;
    staffTeam = teamData.team || [];
    renderStaffTeam();
    return true;
  } catch (e) {
    if (list) list.innerHTML = `<p class="muted small text-center my-20">Error loading staff: ${escapeHtml(e.message)}</p>`;
    return false;
  }
}

function renderStaffTeam() {
  const container = document.getElementById('staffTeamList');
  if (!container) return;
  if (staffTeam.length === 0) {
    container.innerHTML = '<p class="muted small text-center my-20">No staff have signed in yet.</p>';
    return;
  }
  const isAdmin = !!(staffMe && staffMe.role === 'admin' && staffMe.status === 'active');
  const myEmail = staffMe ? String(staffMe.email || '').toLowerCase() : '';
  let rows = '';
  for (const m of staffTeam) {
    const email = escapeHtml(m.email);
    const isSelf = String(m.email).toLowerCase() === myEmail;
    const active = m.status === 'active';
    const lastSeen = m.last_seen_at ? escapeHtml(m.last_seen_at) : 'never';
    const editing = isAdmin && editingStaffEmail === m.email;
    const nameCell = editing
      ? `<input type="text" class="staff-search-input" data-staff-name="${email}" aria-label="Staff name: ${email}" value="${escapeHtml(m.display_name || '')}" placeholder="Add a name" maxlength="120">`
      : escapeHtml(m.display_name || '');
    const roleCell = editing && !isSelf
      ? `<select class="staff-filter-select-sm" data-staff-role="${email}" aria-label="Staff role: ${email}">
           <option value="staff"${m.role === 'staff' ? ' selected' : ''}>Staff</option>
           <option value="admin"${m.role === 'admin' ? ' selected' : ''}>Admin</option>
         </select>`
      : (m.role === 'admin' ? 'Admin' : 'Staff');
    let actions = '';
    if (isAdmin && !editing) {
      actions = `<button type="button" class="btn btn-sm btn-outline" data-action="staff-edit" data-email="${email}" aria-label="Edit staff account: ${escapeHtml(m.display_name || m.email)}">Edit</button>`;
    } else if (editing) {
      actions += `<button type="button" class="btn btn-sm btn-plum btn-compact-mr" data-action="staff-save" data-email="${email}">Save</button>`;
      actions += `<button type="button" class="btn btn-sm btn-outline btn-compact-mr" data-action="staff-cancel" data-email="${email}">Cancel</button>`;
      if (!isSelf) {
        actions += active
          ? `<button class="btn btn-sm btn-outline btn-compact-mr" data-action="staff-deactivate" data-email="${email}">Turn off access</button>`
          : `<button class="btn btn-sm btn-coral btn-compact-mr" data-action="staff-reactivate" data-email="${email}">Turn access back on</button>`;
      }
    }
    rows += `
      <tr>
        <td>${nameCell}<div class="small muted">${email}${isSelf ? ' (you)' : ''}</div></td>
        <td>${roleCell}</td>
        <td><span class="badge ${active ? 'badge-green' : 'badge-amber'}">${active ? 'Active' : 'Access off'}</span><div class="small muted">Last seen: ${lastSeen}</div></td>
        <td>${actions}<p class="small muted mt-8" data-staff-row-message="${email}"></p></td>
      </tr>`;
  }
  container.innerHTML = `${isAdmin ? `
    <form data-action="submit-add-staff" class="mb-12">
      <h5>Add staff member</h5>
      <label>Name <input name="display_name" class="form-input-compact" maxlength="120" required></label>
      <label>Email <input name="email" type="email" class="form-input-compact" maxlength="254" required></label>
      <label>Role <select name="role" class="form-input-compact"><option value="staff">Staff</option><option value="admin">Admin</option></select></label>
      <button type="submit" class="btn btn-sm btn-plum">Add staff member</button>
      <p class="small muted" data-add-staff-message role="status" aria-live="polite"></p>
    </form>` : ''}
    <table class="data">
      <thead><tr><th>Person</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function submitAddStaff(form) {
  const button = form.querySelector('button[type="submit"]');
  const message = form.querySelector('[data-add-staff-message]');
  if (button.disabled) return;
  button.disabled = true;
  message.textContent = '';
  try {
    const fields = new FormData(form);
    const res = await fetch('/api/staff/team', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: fields.get('display_name'), email: fields.get('email'), role: fields.get('role') }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not add staff. Try again.');
    await loadStaffTeam();
    const after = document.getElementById('staffTeamMessage');
    if (after) after.textContent = 'Staff member added. They can sign in with their approved email address. No invitation was sent.';
    loadRecentChanges();
  } catch (e) {
    message.textContent = e.message;
    button.disabled = false;
  }
}

function setStaffTeamMessage(email, text, state) {
  const message = document.getElementById('staffTeamMessage');
  const rowMessage = document.querySelector(`[data-staff-row-message="${CSS.escape(email)}"]`);
  for (const target of [message, rowMessage]) {
    if (target) {
      target.textContent = text;
      target.dataset.state = state;
    }
  }
}

async function saveStaffMember(email, changes, button) {
  if (button && button.disabled) return;
  const originalText = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Saving…';
    button.setAttribute('aria-busy', 'true');
  }
  setStaffTeamMessage(email, `Saving changes for ${email}…`, 'saving');
  let saved = false;
  try {
    const res = await fetch('/api/staff/team', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, ...changes })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save');
    saved = true;
    editingStaffEmail = null;
    const refreshed = await loadStaffTeam();
    setStaffTeamMessage(email, refreshed
      ? `Saved changes for ${email}.`
      : `Changes for ${email} were saved, but the staff list could not refresh. Use Refresh to check the record; do not save again.`,
    refreshed ? 'success' : 'warning');
    loadRecentChanges();
  } catch (e) {
    setStaffTeamMessage(email, saved
      ? `Changes for ${email} were saved, but the on-screen confirmation could not finish. Use Refresh to check the record; do not save again.`
      : `Save was not confirmed for ${email}: ${e.message}. Stop and ask the administrator to check what was saved before trying again.`,
    saved ? 'warning' : 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
      button.removeAttribute('aria-busy');
    }
  }
}

function staffTeamAction(kind, target) {
  const email = target.getAttribute('data-email');
  if (!email) return;
  if (kind === 'edit' || kind === 'cancel') {
    if (!staffMe || staffMe.role !== 'admin' || staffMe.status !== 'active') return;
    if (!staffTeam.some(member => member.email === email)) return;
    editingStaffEmail = kind === 'edit' ? email : null;
    renderStaffTeam();
    const selector = kind === 'edit' ? `[data-staff-name="${CSS.escape(email)}"]` : `[data-action="staff-edit"][data-email="${CSS.escape(email)}"]`;
    document.querySelector(selector)?.focus?.();
  } else if (kind === 'save') {
    const nameInput = document.querySelector(`[data-staff-name="${CSS.escape(email)}"]`);
    const roleSelect = document.querySelector(`[data-staff-role="${CSS.escape(email)}"]`);
    const changes = {};
    if (nameInput) changes.display_name = nameInput.value;
    if (roleSelect) changes.role = roleSelect.value;
    saveStaffMember(email, changes, target);
  } else if (kind === 'deactivate') {
    if (!window.confirm(`Turn off staff access for ${email}? They will be refused even if their email still works.`)) return;
    saveStaffMember(email, { status: 'deactivated' }, target);
  } else if (kind === 'reactivate') {
    saveStaffMember(email, { status: 'active' }, target);
  }
}

/* ---------- Caregiver wellness chart (schema 0012) ---------- */
const WELLNESS_COLORS = ['#7a3b2e', '#d9774a', '#3f7d6e', '#4a6fa5', '#9a6fb0', '#b8860b', '#555555', '#c0392b', '#2e86ab', '#6b8e23'];

async function loadWellnessCaregivers() {
  const select = document.getElementById('wellnessCaregivers');
  if (!select) return;
  try {
    const res = await fetch('/api/staff/wellness');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load');
    const chosen = new Set([...select.selectedOptions].map((o) => o.value));
    select.textContent = '';
    for (const c of data.caregivers || []) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.first_name || ''} ${c.last_name || ''}`.trim() + ` (${c.checkins})`;
      if (chosen.has(c.id)) opt.selected = true;
      select.appendChild(opt);
    }
    if (select.options.length && !select.selectedOptions.length) select.options[0].selected = true;
    if (select.options.length) showWellnessChart();
  } catch (e) {
    const chart = document.getElementById('wellnessChart');
    if (chart) chart.innerHTML = `<p class="muted small text-center my-20">Error loading wellness: ${escapeHtml(e.message)}</p>`;
  }
}

async function showWellnessChart() {
  const select = document.getElementById('wellnessCaregivers');
  const range = document.getElementById('wellnessRange');
  const chart = document.getElementById('wellnessChart');
  if (!select || !chart) return;
  const ids = [...select.selectedOptions].map((o) => o.value);
  if (ids.length === 0) {
    chart.innerHTML = '<p class="muted small text-center my-20">Pick at least one caregiver.</p>';
    return;
  }
  const params = new URLSearchParams();
  ids.forEach((id) => params.append('caregiver', id));
  params.set('range', range ? range.value : 'quarter');
  try {
    const res = await fetch(`/api/staff/wellness?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to load');
    drawWellnessChart(chart, data);
  } catch (e) {
    chart.innerHTML = `<p class="muted small text-center my-20">Error loading wellness: ${escapeHtml(e.message)}</p>`;
  }
}

function drawWellnessChart(container, data) {
  container.textContent = '';
  const series = (data.series || []).filter((s) => s.points && s.points.length);
  if (series.length === 0) {
    container.innerHTML = '<p class="muted small text-center my-20">No check-ins in this time range.</p>';
    return;
  }
  const toMs = (v) => Date.parse(String(v).replace(' ', 'T') + 'Z');
  const start = toMs(data.since);
  const end = Date.now();
  const W = 640, H = 220, L = 34, R = 10, T = 10, B = 24;
  const x = (ms) => L + ((ms - start) / Math.max(1, end - start)) * (W - L - R);
  const y = (score) => T + (1 - score / 100) * (H - T - B);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Wellness scores over time');
  for (const v of [0, 50, 100]) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', L); line.setAttribute('x2', W - R);
    line.setAttribute('y1', y(v)); line.setAttribute('y2', y(v));
    line.setAttribute('class', 'axis');
    svg.appendChild(line);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', 4); label.setAttribute('y', y(v) + 4);
    label.setAttribute('class', 'axis-label');
    label.textContent = String(v);
    svg.appendChild(label);
  }
  const startLabel = document.createElementNS(ns, 'text');
  startLabel.setAttribute('x', L); startLabel.setAttribute('y', H - 6);
  startLabel.setAttribute('class', 'axis-label');
  startLabel.textContent = String(data.since).slice(0, 10);
  svg.appendChild(startLabel);
  const legend = document.createElement('div');
  legend.className = 'wellness-legend small';
  series.forEach((s, i) => {
    const color = WELLNESS_COLORS[i % WELLNESS_COLORS.length];
    const pts = s.points.map((p) => `${x(toMs(p.created_at)).toFixed(1)},${y(p.score).toFixed(1)}`);
    if (pts.length > 1) {
      const pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', pts.join(' '));
      pl.setAttribute('fill', 'none');
      pl.setAttribute('stroke', color);
      pl.setAttribute('stroke-width', '2.5');
      svg.appendChild(pl);
    }
    for (const p of s.points) {
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', x(toMs(p.created_at)).toFixed(1));
      dot.setAttribute('cy', y(p.score).toFixed(1));
      dot.setAttribute('r', '3.5');
      dot.setAttribute('fill', color);
      const tip = document.createElementNS(ns, 'title');
      tip.textContent = `${s.name}: ${p.score} on ${String(p.created_at).slice(0, 10)}`;
      dot.appendChild(tip);
      svg.appendChild(dot);
    }
    const item = document.createElement('span');
    const sw = document.createElement('span');
    sw.className = 'wellness-swatch';
    sw.style.background = color;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(`${s.name} (latest ${s.points[s.points.length - 1].score})`));
    legend.appendChild(item);
  });
  container.appendChild(svg);
  container.appendChild(legend);
}

// A locator only: request text, actor, challenge and preview never enter the URL.
async function initAssistantHandoff() {
  const match = /^#handoff=(ah_[a-f0-9]{32})$/.exec(window.location.hash || '');
  if (!match) return;
  const handoffId = match[1];
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'Assistant request handoff');
  (document.getElementById('assistantHandoffRegion') || document.getElementById('chatBody')?.parentElement)?.prepend(panel);
  let busy = false;
  const addText = value => { const p = document.createElement('p'); p.textContent = value; panel.appendChild(p); };
  const button = (label, action, version) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', () => { void send(action, version); }); panel.appendChild(b);
  };
  async function send(action, version) {
    if (busy || agentConfirmationHold || agentConfirmationPending) return;
    busy = true;
    const mutating = action !== 'view';
    let uncertainState = false;
    if (mutating) agentConfirmationPending = true;
    panel.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const res = await fetch('/api/agent/handoff', { method: 'POST', headers: {'content-type':'application/json'},
        body: JSON.stringify({action,handoff_id:handoffId,...(version ? {preview_version:version} : {})}) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error('handoff');
      panel.replaceChildren();
      addText('Assistant request: ' + data.state);
      if (data.challenge) {
        addText('Post this one-use code yourself in the ORIGINAL Slack request thread. Do not forward it to an assistant or another person. It expires in three minutes.');
        const code = document.createElement('pre'); code.textContent = data.challenge; panel.appendChild(code);
        addText('Original channel: ' + data.channel + '; thread: ' + data.thread);
        button('Check pairing', 'view');
      } else if (data.state === 'pending') button('Begin identity pairing', 'begin');
      else if (data.state === 'challenged') {
        addText('Pairing is pending. Use the original protected page code; do not generate another code or retry the claim.');
        button('Check pairing', 'view');
      } else if (data.state === 'paired') {
        addText(data.area + ' / ' + data.target_id); addText(data.request);
        button('Create my draft', 'draft');
      } else if (data.state === 'drafted') {
        addText(data.area + ' / ' + data.target_id); addText(data.request);
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(data.preview,null,2); panel.appendChild(pre);
        if (!/^[a-f0-9]{64}$/.test(data.preview_version || '')) throw new Error('preview');
        addText('Review the exact before/after. Only you may confirm or discard this proposal.');
        button('Confirm this exact preview', 'confirm', data.preview_version);
        button('Discard this exact preview', 'discard', data.preview_version);
      } else if (!['published','discarded','refused'].includes(data.state)) {
        uncertainState = true;
        throw new Error('unknown outcome');
      }
      if (mutating) agentConfirmationPending = false;
    } catch {
      panel.replaceChildren();
      if (mutating || uncertainState) {
        addText('Handoff on HOLD. Do not retry, replace or discard. An operator must reconcile the original application outcome.');
        holdAgentConfirmation();
      } else addText('Could not read this handoff. No action was sent from this page; have an operator verify it.');
    } finally { busy = false; }
  }
  await send('view');
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => { void initAssistantHandoff(); });
}

if (typeof window !== 'undefined') {
  window.formatStatusLine = formatStatusLine;
  window.updateStatusLine = updateStatusLine;
  window.filterBySegment = filterBySegment;
  window.toggleRecording = toggleRecording;
}
if (typeof globalThis !== 'undefined') {
  globalThis.formatStatusLine = formatStatusLine;
  globalThis.updateStatusLine = updateStatusLine;
  globalThis.filterBySegment = filterBySegment;
  globalThis.toggleRecording = toggleRecording;
}
