// Public resource pages continue to work while bookmarking is disabled.
(() => {
  if (!['https://customer-test.legacy-hub-5qo.pages.dev', 'https://staging.legacy-hub-5qo.pages.dev'].includes(location.origin)) return;
  const cards = [...document.querySelectorAll('[data-resource-id]')];
  const endpoint = '/api/portal/saved-resources';
  let active;

  function clearControls() {
    active?.abort();
    active = null;
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

  async function refresh() {
    clearControls();
    if (document.hidden || !cards.length) return;
    active = new AbortController();
    const { signal } = active;
    const saved = new Set();
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
        token = page.csrfToken;
        for (const item of page.items) saved.add(item.resourceId);
        cursor = page.nextCursor;
      } while (cursor);
      if (!signal.aborted) {
        for (const card of cards) addControl(card, token, saved.has(card.dataset.resourceId), signal);
      }
    } catch {
      // Browsing the public cards does not depend on the private API.
    }
  }

  window.addEventListener('pagehide', clearControls);
  window.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', refresh);
})();
