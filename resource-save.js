// Public resource pages continue to work while bookmarking is disabled.
(() => {
  if (!['https://customer-test.legacy-hub-5qo.pages.dev', 'https://staging.legacy-hub-5qo.pages.dev'].includes(location.origin)) return;
  const cards = [...document.querySelectorAll('[data-resource-id]')];
  const endpoint = '/api/portal/saved-resources';
  const panel = document.getElementById('portalSavedResources');
  const dashboard = document.getElementById('dashView');
  const logout = document.getElementById('portalLogoutBtn');
  const placeholder = document.getElementById('portalSavedResourcesPlaceholder');
  let active;

  function dashboardOwner() {
    if (dashboard?.style.display !== 'block' || logout?.disabled) return '';
    return (window.portalActiveCaregiverKey || '').split('|')[0];
  }

  function clearControls() {
    active?.abort();
    active = null;
    if (panel) {
      panel.hidden = true;
      panel.replaceChildren();
      placeholder.hidden = false;
    }
    for (const card of cards) card.querySelector('[data-save-controls]')?.remove();
  }

  function addControl(card, token, saved, signal) {
    const box = document.createElement('div');
    box.dataset.saveControls = '';
    box.className = 'mt-12';
    if (!token) {
      const link = document.createElement('a');
      link.href = '/portal';
      link.textContent = 'Sign in to save';
      box.append(link);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline btn-sm';
      button.textContent = saved ? 'Saved' : 'Save resource';
      button.disabled = saved;
      const status = document.createElement('span');
      status.setAttribute('role', 'status');
      status.className = 'small';
      button.addEventListener('click', async () => {
        if (button.disabled || signal.aborted) return;
        button.disabled = true;
        status.textContent = ' Saving…';
        try {
          const response = await fetch(endpoint, {
            method: 'PUT', credentials: 'same-origin', cache: 'no-store', signal,
            headers: { 'Content-Type': 'application/json', 'X-Portal-CSRF': token },
            body: JSON.stringify({ resource_id: card.dataset.resourceId }),
          });
          if (signal.aborted) return;
          if (response.status === 401 || response.status === 403) {
            await refresh();
            return;
          }
          const receipt = await response.json();
          if (!response.ok || !receipt.ok || receipt.status !== 'saved') throw new Error('Save failed');
          if (signal.aborted) return;
          button.textContent = 'Saved';
          status.textContent = ' Saved to My Resources.';
        } catch {
          if (signal.aborted) return;
          status.textContent = ' Could not confirm the save. Try again.';
          button.disabled = false;
        }
      });
      box.append(button, status);
    }
    card.append(box);
  }

  function showList(items, token, signal) {
    const heading = document.createElement('h5');
    heading.textContent = 'Saved resources';
    const list = document.createElement('ul');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    function showEmpty() {
      if (!list.children.length) status.textContent = 'You have no saved resources.';
    }
    for (const item of items) {
      const row = document.createElement('li');
      const title = item.available && item.href ? document.createElement('a') : document.createElement('span');
      title.textContent = item.title || 'Resource no longer available';
      if (title.tagName === 'A') title.href = item.href;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-outline btn-sm';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + title.textContent);
      remove.addEventListener('click', async () => {
        if (remove.disabled || signal.aborted) return;
        remove.disabled = true;
        try {
          const res = await fetch(endpoint, {
            method: 'DELETE', credentials: 'same-origin', cache: 'no-store', signal,
            headers: { 'Content-Type': 'application/json', 'X-Portal-CSRF': token },
            body: JSON.stringify({ resource_id: item.resourceId }),
          });
          if (signal.aborted) return;
          if (res.status === 401 || res.status === 403) return refresh();
          const receipt = await res.json();
          if (!res.ok || !receipt.ok || receipt.status !== 'removed') throw new Error('Remove failed');
          if (signal.aborted) return;
          const nextButton = (row.nextElementSibling || row.previousElementSibling)?.querySelector('button');
          row.remove();
          status.textContent = 'Resource removed.';
          showEmpty();
          (nextButton || document.querySelector('#portalResourcesCard a[href="resources.html"]'))?.focus();
        } catch {
          if (signal.aborted) return;
          remove.disabled = false;
          status.textContent = 'Could not confirm removal. Try again.';
        }
      });
      row.append(title, ' ', remove);
      list.append(row);
    }
    showEmpty();
    panel.replaceChildren(heading, list, status);
    placeholder.hidden = true;
    panel.hidden = false;
  }

  async function refresh() {
    clearControls();
    const owner = dashboardOwner();
    if (document.hidden || (!cards.length && !panel) || (panel && !owner)) return;
    active = new AbortController();
    const { signal } = active;
    const saved = new Map();
    let token = null;
    let cursor = null;
    try {
      do {
        const url = cursor ? endpoint + '?cursor=' + encodeURIComponent(cursor) : endpoint;
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
        if (signal.aborted) return;
        if (response.status === 401 && !cursor) break;
        if (!response.ok) return;
        const page = await response.json();
        if (!page.ok || !Array.isArray(page.items) || !page.csrfToken || (token && token !== page.csrfToken)) return;
        if (panel && (page.caregiverId !== owner || dashboardOwner() !== owner)) return;
        token = page.csrfToken;
        for (const item of page.items) saved.set(item.resourceId, item);
        cursor = page.nextCursor;
      } while (cursor);
      if (!signal.aborted) {
        if (panel && token && dashboardOwner() === owner) showList(saved.values(), token, signal);
        for (const card of cards) addControl(card, token, saved.has(card.dataset.resourceId), signal);
      }
    } catch {
      // Browsing the public cards does not depend on the private API.
    }
  }

  if (panel && dashboard && logout) {
    const observer = new MutationObserver(refresh);
    observer.observe(dashboard, { attributes: true, attributeFilter: ['style'] });
    observer.observe(logout, { attributes: true, attributeFilter: ['disabled'] });
  }
  window.addEventListener('pagehide', clearControls);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', refresh);
})();
