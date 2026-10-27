// One shared dropdown state for clicks, keyboard controls and desktop hover.
(function () {
  var items = document.querySelectorAll('.nav-v2 .nav-item.has-drop');
  var hoverMedia = window.matchMedia
    ? window.matchMedia('(min-width: 1151px) and (hover: hover) and (pointer: fine)')
    : null;
  var hoveredItem = null;
  var closeTimer = null;
  function cancelClose() {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
  }
  function setOpen(it, opening) {
    it.classList.toggle('open', opening);
    var btn = it.querySelector('.drop-toggle');
    if (btn) btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }
  function closeAll(except) {
    items.forEach(function (it) {
      if (it !== except) setOpen(it, false);
    });
  }
  function scheduleClose(it) {
    if (!it.classList.contains('open')) return;
    cancelClose();
    closeTimer = setTimeout(function () {
      closeTimer = null;
      if (hoveredItem !== it && !it.contains(document.activeElement)) setOpen(it, false);
    }, 200);
  }
  items.forEach(function (it) {
    var btn = it.querySelector('.drop-toggle');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      cancelClose();
      var opening = !it.classList.contains('open');
      closeAll(it);
      setOpen(it, opening);
    });
    // Pointer events exclude synthetic mouse events produced by a touch tap.
    it.addEventListener('pointerenter', function (e) {
      if (!hoverMedia || !hoverMedia.matches || (e.pointerType !== 'mouse' && e.pointerType !== 'pen')) return;
      hoveredItem = it;
      cancelClose();
      closeAll(it);
      setOpen(it, true);
    });
    it.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      if (hoveredItem === it) hoveredItem = null;
      if (hoverMedia && hoverMedia.matches) scheduleClose(it);
    });
    it.addEventListener('focusout', function (e) {
      if (hoverMedia && hoverMedia.matches && hoveredItem !== it && !it.contains(e.relatedTarget)) {
        scheduleClose(it);
      }
    });
  });
  if (hoverMedia && hoverMedia.addEventListener) {
    hoverMedia.addEventListener('change', function () {
      cancelClose();
      hoveredItem = null;
    });
  }
  document.addEventListener('click', function () { cancelClose(); closeAll(null); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      cancelClose();
      var activeToggle = null;
      items.forEach(function (it) {
        if (it.classList.contains('open') && it.contains(e.target)) {
          activeToggle = it.querySelector('.drop-toggle');
        }
      });
      closeAll(null);
      if (activeToggle) activeToggle.focus();
    }
  });
})();
