
document.documentElement.classList.add('js-enhanced');

window.addEventListener('DOMContentLoaded', () => {
  const selectors = [
    '.section-head', '.cta-panel', '.glass-panel', '.surface-panel', '.card', '.info-card',
    '.soft-card', '.stage-card', '.map-card', '.map-sidebar', '.faq-card', '.proof-card',
    '.audience-card', '.pillar-card', '.positioning-kpi', '.positioning-card',
    '.hero-home__copy', '.hero-home__media', '.hero-home__note'
  ];

  const revealEls = Array.from(document.querySelectorAll(selectors.join(',')));
  revealEls.forEach((el, idx) => {
    el.classList.add('reveal-up');
    el.style.transitionDelay = `${Math.min((idx % 6) * 55, 220)}ms`;
    el.setAttribute('data-premium-card', '');
  });

  if ('IntersectionObserver' in window) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => obs.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
  }

  const interactive = Array.from(document.querySelectorAll('[data-premium-card], .btn'));
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    interactive.forEach(el => {
      el.addEventListener('pointermove', (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        el.style.setProperty('--mx', `${x}px`);
        el.style.setProperty('--my', `${y}px`);
      });
    });
  }
});
