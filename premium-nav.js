
(function () {
  const nav = document.querySelector('[data-vp-nav]');
  if (!nav) return;

  const menu = nav.querySelector('[data-vp-menu]');
  const toggle = nav.querySelector('[data-vp-menu-toggle]');
  const dropdowns = nav.querySelectorAll('.vp-nav__dropdown');

  function closeDropdowns(except) {
    dropdowns.forEach((item) => {
      if (item !== except) {
        item.classList.remove('is-open');
        const button = item.querySelector('.vp-nav__link');
        if (button) button.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      if (!open) closeDropdowns();
    });
  }

  dropdowns.forEach((item) => {
    const button = item.querySelector('.vp-nav__link');
    if (!button) return;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const open = !item.classList.contains('is-open');
      closeDropdowns(item);
      item.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
    });
  });

  document.addEventListener('click', (event) => {
    if (!nav.contains(event.target)) {
      nav.classList.remove('is-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      closeDropdowns();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      nav.classList.remove('is-open');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      closeDropdowns();
    }
  });
})();
