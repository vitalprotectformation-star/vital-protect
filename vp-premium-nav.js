
(function(){
  const headers = document.querySelectorAll('.vp-premium-header');
  headers.forEach((header) => {
    const mobileToggle = header.querySelector('.vp-mobile-toggle');
    const dropdowns = header.querySelectorAll('.vp-dropdown');
    if (mobileToggle) {
      mobileToggle.addEventListener('click', function(event){
        event.stopPropagation();
        const open = header.classList.toggle('is-open');
        mobileToggle.setAttribute('aria-expanded', String(open));
      });
    }
    dropdowns.forEach((dropdown) => {
      const button = dropdown.querySelector('.vp-drop-toggle');
      if (!button) return;
      button.addEventListener('click', function(event){
        event.stopPropagation();
        dropdowns.forEach((other) => {
          if (other !== dropdown) {
            other.classList.remove('is-open');
            const otherButton = other.querySelector('.vp-drop-toggle');
            if (otherButton) otherButton.setAttribute('aria-expanded', 'false');
          }
        });
        const open = dropdown.classList.toggle('is-open');
        button.setAttribute('aria-expanded', String(open));
      });
    });
  });
  document.addEventListener('click', function(event){
    document.querySelectorAll('.vp-premium-header.is-open').forEach((header) => {
      if (!header.contains(event.target)) {
        header.classList.remove('is-open');
        const toggle = header.querySelector('.vp-mobile-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }
    });
    document.querySelectorAll('.vp-dropdown.is-open').forEach((dropdown) => {
      if (!dropdown.contains(event.target)) {
        dropdown.classList.remove('is-open');
        const button = dropdown.querySelector('.vp-drop-toggle');
        if (button) button.setAttribute('aria-expanded', 'false');
      }
    });
  });
  document.addEventListener('keydown', function(event){
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.vp-premium-header.is-open').forEach((header) => header.classList.remove('is-open'));
    document.querySelectorAll('.vp-dropdown.is-open').forEach((dropdown) => dropdown.classList.remove('is-open'));
    document.querySelectorAll('.vp-drop-toggle,.vp-mobile-toggle').forEach((button) => button.setAttribute('aria-expanded','false'));
  });
})();
