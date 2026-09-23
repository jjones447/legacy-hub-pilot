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

async function loadStaffConsole() {
  await Promise.all([loadFollowups(), loadEvents()]);
  if (currentEventId) {
    await loadRegistrations(currentEventId, currentEventTitle);
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

    const caringFor = escapeHtml(p.caring_for || 'None specified');
    const relationship = p.relationship ? `(${escapeHtml(p.relationship)})` : '';
    const memberSince = p.member_since ? escapeHtml(p.member_since.split(' ')[0]) : 'N/A';

    const programList = data.registrations.map(r => r.event_title).filter(Boolean);
    const uniquePrograms = Array.from(new Set(programList)).map(t => escapeHtml(t)).join(' · ') || 'None';

    let grantStatusHtml = 'None';
    if (data.grants && data.grants.length > 0) {
      const g = data.grants[0];
      let gBadge = 'badge-plum';
      if (g.status === 'in_review') gBadge = 'badge-amber';
      if (g.status === 'awarded') gBadge = 'badge-green';
      if (g.status === 'course_complete') gBadge = 'badge-green';
      if (g.status === 'closed') gBadge = 'badge-outline';
      const label = g.status === 'course_complete' ? 'Course complete' : g.status;
      grantStatusHtml = `<span class="badge ${gBadge}">${escapeHtml(label)}</span>`;
      if (g.award_amount) {
        grantStatusHtml += ` (Awarded: ${escapeHtml(g.award_amount)})`;
      }
    }

    const attendedEvents = data.registrations.filter(r => r.status === 'attended');
    const lastAttended = attendedEvents.length > 0 
      ? `${escapeHtml(attendedEvents[0].event_title)} · ${escapeHtml(attendedEvents[0].event_starts_at.split(' ')[0])}`
      : 'N/A';

    const socialsCount = data.registrations.filter(r => r.status === 'attended').length;

    const notesHtml = data.notes.map(n => `<div><strong>${escapeHtml(n.author)}:</strong> ${escapeHtml(n.body)} <span class="small muted">(${escapeHtml(n.created_at.split(' ')[0])})</span></div>`).join('<br>') || 'None';

    const contactInfo = `Email: ${escapeHtml(p.email || 'N/A')} · Phone: ${escapeHtml(p.phone || 'N/A')} (Prefers: ${escapeHtml(p.preferred_contact || 'email')})`;

    panel.innerHTML = `
      <h4>👤 Caregiver record — ${name} ${memberBadge}</h4>
      <div class="kv-row"><span class="k">Contact Info</span><span class="v">${contactInfo}</span></div>
      <div class="kv-row"><span class="k">Sanctuary member since</span><span class="v">${memberSince}</span></div>
      <div class="kv-row"><span class="k">Caring for</span><span class="v">${caringFor} ${relationship}</span></div>
      <div class="kv-row"><span class="k">Registered Events</span><span class="v">${uniquePrograms}</span></div>
      <div class="kv-row"><span class="k">Grant status</span><span class="v">${grantStatusHtml}</span></div>
      <div class="kv-row"><span class="k">Last attended</span><span class="v">${lastAttended}</span></div>
      <div class="kv-row"><span class="k">Total attended</span><span class="v">${socialsCount} event(s)</span></div>
      <div class="kv-row"><span class="k">Staff Notes</span><span class="v">${notesHtml}</span></div>
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
  }
});
