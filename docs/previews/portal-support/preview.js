// Fictional presentation only. No requests, persistence or real profile access.
(() => {
  // app.js is deliberately absent; bridge only the existing navigation toggle.
  const menu = document.querySelector?.('[data-action="toggle-nav"]');
  menu?.addEventListener('click', () => window.toggleMainNavigation?.());
  const show = document.getElementById('show-example');
  const clear = document.getElementById('clear-example');
  if (!show || !clear) return;
  function set(on) {
    for (const id of ['profile-example', 'wellness-example']) {
      const node = document.getElementById(id);
      if (node) node.hidden = !on;
    }
    const heading = document.getElementById('preview-welcome');
    if (heading) heading.textContent = on ? 'Welcome to Your Sanctuary, Jordan!' : 'Welcome to Your Sanctuary!';
    const examples = { 'preview-name': 'Jordan Rivera (fictional)', 'preview-email': 'jordan@example.invalid' };
    for (const [id, value] of Object.entries(examples)) {
      const field = document.getElementById(id);
      if (field) field.value = on ? value : '';
    }
    document.getElementById('example-note').textContent = on
      ? 'Fictional example — not your records. Nothing is sent or saved.'
      : 'Fictional example hidden. No personal records are loaded.';
    show.hidden = on;
    clear.hidden = !on;
  }
  show.addEventListener('click', () => set(true));
  clear.addEventListener('click', () => set(false));
  set(true);
})();
