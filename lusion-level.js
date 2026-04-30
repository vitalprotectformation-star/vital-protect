
document.documentElement.classList.add('js');

(() => {
  const canvas = document.querySelector('.vpl-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let mouse = { x: 0.5, y: 0.5 };
  let particles = [];

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.min(110, Math.max(55, Math.floor(width / 16)));
    particles = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - .5) * .28,
      vy: (Math.random() - .5) * .28,
      r: Math.random() * 2.2 + .55,
      h: Math.random() * 360,
      a: Math.random() * .45 + .12
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createRadialGradient(width * mouse.x, height * mouse.y, 0, width * mouse.x, height * mouse.y, Math.max(width, height) * .55);
    gradient.addColorStop(0, 'rgba(47,111,159,.15)');
    gradient.addColorStop(.45, 'rgba(255,255,255,.04)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    for (const p of particles) {
      p.x += p.vx + (mouse.x - .5) * .08;
      p.y += p.vy + (mouse.y - .5) * .08;
      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${212 + Math.sin((t / 1800) + p.h) * 8}, 55%, 74%, ${p.a})`;
      ctx.fill();
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 115) {
          ctx.strokeStyle = `rgba(216,230,243,${(1 - dist / 115) * .10})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX / window.innerWidth;
    mouse.y = e.clientY / window.innerHeight;
  });

  resize();
  requestAnimationFrame(draw);
})();

window.addEventListener('DOMContentLoaded', () => {
  const reveal = [...document.querySelectorAll('.vpl-reveal, .vpl-section-head, .vpl-card, .vpl-image-card, .vpl-step, .vpl-final-box')];
  reveal.forEach((el, idx) => {
    el.classList.add('vpl-reveal');
    el.style.transitionDelay = `${Math.min((idx % 8) * 55, 280)}ms`;
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .12, rootMargin: '0px 0px -42px 0px' });
    reveal.forEach((el) => observer.observe(el));
  } else {
    reveal.forEach((el) => el.classList.add('in-view'));
  }

  const cards = [...document.querySelectorAll('.vpl-card')];
  cards.forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  const magnetic = [...document.querySelectorAll('.vpl-button, .vpl-nav-cta')];
  if (window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
    magnetic.forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * .12;
        const y = (e.clientY - r.top - r.height / 2) * .18;
        el.style.transform = `translate(${x}px, ${y}px)`;
      });
      el.addEventListener('pointerleave', () => {
        el.style.transform = '';
      });
    });
  }
});


window.addEventListener('DOMContentLoaded', () => {
  /* V5: ribbon progress */
  const ribbon = document.querySelector('.vpl-scroll-ribbon');
  if (ribbon) {
    const progressPath = ribbon.querySelector('.vpl-ribbon-progress');
    const dot = ribbon.querySelector('.vpl-ribbon-dot');
    if (progressPath && dot && typeof progressPath.getTotalLength === 'function') {
      /*
       * V12 true draw fix:
       * All SVG paths use pathLength="1" in the HTML.
       * Therefore dasharray/dashoffset MUST be normalized from 1 to 0.
       * getTotalLength() is used only to position the moving dot along the geometry.
       */
      const geometryLength = progressPath.getTotalLength();

      progressPath.style.setProperty('stroke-dasharray', '1', 'important');
      progressPath.style.setProperty('stroke-dashoffset', '1', 'important');

      const updateRibbonTop = () => {
        const nav = document.querySelector('.vpl-nav');
        const navRect = nav ? nav.getBoundingClientRect() : { bottom: 0 };
        const top = Math.max(0, Math.ceil(navRect.bottom));
        document.documentElement.style.setProperty('--vpl-ribbon-top', `${top}px`);
      };

      let ticking = false;
      const updateRibbon = () => {
        updateRibbonTop();

        const max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
        const p = Math.min(1, Math.max(0, window.scrollY / max));

        // This is the actual drawing effect: 1 = hidden, 0 = fully drawn.
        const dashOffset = 1 - p;
        progressPath.style.setProperty('stroke-dasharray', '1', 'important');
        progressPath.style.setProperty('stroke-dashoffset', `${dashOffset}`, 'important');

        ribbon.classList.toggle('is-drawing', p > 0.003);

        const point = progressPath.getPointAtLength(geometryLength * p);
        dot.setAttribute('cx', point.x.toFixed(2));
        dot.setAttribute('cy', point.y.toFixed(2));
        ticking = false;
      };

      updateRibbon();
      window.addEventListener('scroll', () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(updateRibbon);
        }
      }, { passive: true });
      window.addEventListener('resize', updateRibbon);
    }
  }

  /* V5: honeycomb build on scroll */
  const honeyGrids = [...document.querySelectorAll('[data-honeycomb]')];
  if (honeyGrids.length) {
    honeyGrids.forEach((grid) => {
      [...grid.children].forEach((cell, i) => {
        cell.style.transitionDelay = `${Math.min(i * 70, 560)}ms`;
      });
    });

    let honeyTick = false;
    const updateHoney = () => {
      const vh = window.innerHeight;
      honeyGrids.forEach((grid) => {
        const rect = grid.getBoundingClientRect();
        const items = [...grid.children];
        const start = vh * 0.92;
        const end = -rect.height * 0.15;
        const ratio = Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
        const visibleCount = Math.max(0, Math.ceil(ratio * items.length));
        items.forEach((item, index) => {
          item.classList.toggle('is-visible', index < visibleCount);
        });
      });
      honeyTick = false;
    };

    updateHoney();
    window.addEventListener('scroll', () => {
      if (!honeyTick) {
        honeyTick = true;
        requestAnimationFrame(updateHoney);
      }
    }, { passive: true });
    window.addEventListener('resize', updateHoney);
  }
});


window.addEventListener('DOMContentLoaded', () => {
  /*
   * Card cinema effect:
   * Sticky section + scroll progress drives cards horizontally,
   * similar to the video reference.
   */
  const cinemaSections = [...document.querySelectorAll('[data-card-cinema]')];

  if (cinemaSections.length) {
    let ticking = false;

    const updateCinema = () => {
      const vh = window.innerHeight || 1;

      cinemaSections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        const scrollable = Math.max(section.offsetHeight - vh, 1);
        const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
        section.style.setProperty('--card-progress', progress.toFixed(4));
      });

      ticking = false;
    };

    updateCinema();

    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateCinema);
      }
    }, { passive: true });

    window.addEventListener('resize', updateCinema);

    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      cinemaSections.forEach((section) => {
        section.querySelectorAll('.vpl-floating-card').forEach((card) => {
          card.addEventListener('pointermove', (event) => {
            const rect = card.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const rx = ((y / rect.height) - 0.5) * -7;
            const ry = ((x / rect.width) - 0.5) * 7;
            card.style.setProperty('--mx', `${x}px`);
            card.style.setProperty('--my', `${y}px`);
            card.style.setProperty('--tilt-x', `${rx}deg`);
            card.style.setProperty('--tilt-y', `${ry}deg`);
          });

          card.addEventListener('pointerleave', () => {
            card.style.removeProperty('--mx');
            card.style.removeProperty('--my');
            card.style.removeProperty('--tilt-x');
            card.style.removeProperty('--tilt-y');
          });
        });
      });
    }
  }
});



window.addEventListener('DOMContentLoaded', () => {
  /*
   * V16 — Correctifs de calibration :
   * - progression card cinema recalibrée pour éviter les vides ;
   * - ruban atténué automatiquement sur sections claires / CTA final ;
   * - honeycomb plus progressive.
   */
  const cinemaSections = [...document.querySelectorAll('[data-card-cinema]')];
  const ribbon = document.querySelector('.vpl-scroll-ribbon');
  const honeyGrids = [...document.querySelectorAll('[data-honeycomb]')];

  let tickingV16 = false;

  const smoothstep = (x) => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
  };

  const updateV16 = () => {
    const vh = window.innerHeight || 1;

    cinemaSections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      const scrollable = Math.max(section.offsetHeight - vh, 1);
      const raw = Math.min(1, Math.max(0, -rect.top / scrollable));

      // Légère courbe pour éviter un départ trop brutal et garder les cartes visibles.
      const progress = smoothstep(raw);
      section.style.setProperty('--card-progress', progress.toFixed(4));
      section.classList.toggle('is-active', raw > 0.02 && raw < 0.98);
    });

    if (ribbon) {
      const probeX = Math.min(window.innerWidth - 40, Math.max(40, window.innerWidth * 0.72));
      const probeY = Math.min(window.innerHeight - 100, Math.max(120, window.innerHeight * 0.52));
      const node = document.elementFromPoint(probeX, probeY);
      const section = node ? node.closest('.vpl-final, .vpl-honeycomb-section, .vpl-light, .vpl-section-dark, .vpl-inner-hero, .vpl-hero, .vpl-card-cinema') : null;

      ribbon.classList.remove('is-on-light', 'is-on-final', 'is-on-dark', 'is-on-hero');

      if (section) {
        if (section.classList.contains('vpl-final')) {
          ribbon.classList.add('is-on-final');
        } else if (
          section.classList.contains('vpl-light') ||
          section.classList.contains('vpl-honeycomb-section') ||
          section.classList.contains('vpl-card-cinema')
        ) {
          ribbon.classList.add('is-on-light');
        } else if (
          section.classList.contains('vpl-section-dark') ||
          section.classList.contains('vpl-inner-hero') ||
          section.classList.contains('vpl-hero')
        ) {
          ribbon.classList.add('is-on-dark');
        }
      }
    }

    honeyGrids.forEach((grid) => {
      const rect = grid.getBoundingClientRect();
      const items = [...grid.children];
      const start = vh * 0.88;
      const end = vh * 0.20;
      const ratio = Math.min(1, Math.max(0, (start - rect.top) / (start - end)));
      const visibleCount = Math.ceil(smoothstep(ratio) * items.length);
      items.forEach((item, index) => {
        item.classList.toggle('is-visible', index < visibleCount);
      });
    });

    tickingV16 = false;
  };

  updateV16();

  window.addEventListener('scroll', () => {
    if (!tickingV16) {
      tickingV16 = true;
      requestAnimationFrame(updateV16);
    }
  }, { passive: true });

  window.addEventListener('resize', updateV16);
});




window.addEventListener('DOMContentLoaded', () => {
  /*
   * V17 — Card cinema unfold
   * Les cards se déploient en éventail, restent visibles et ne sortent plus hors champ.
   */
  const sections = [...document.querySelectorAll('[data-card-cinema]')];

  if (!sections.length) return;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x), 3);

  let ticking = false;

  const finalPositions = [
    { x: -250, y: -150, z: 80, r: -7, ry: -8 },
    { x: -40,  y: -42,  z: 130, r: 3,  ry: -4 },
    { x: 180,  y: 108,  z: 100, r: -3, ry: 5 },
    { x: 360,  y: -116, z: 70,  r: 6,  ry: -5 },
    { x: 505,  y: 72,   z: 115, r: -5, ry: 6 }
  ];

  const updateCardsUnfold = () => {
    const vh = window.innerHeight || 1;

    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      const scrollable = Math.max(section.offsetHeight - vh, 1);

      /*
        Le déploiement commence un peu avant que la section soit pleinement centrée
        et se termine avant la fin, afin qu'en bas toutes les cards soient visibles.
      */
      const raw = clamp((-rect.top + vh * 0.10) / (scrollable * 0.62));
      const globalProgress = easeOutCubic(raw);

      section.style.setProperty('--card-progress', globalProgress.toFixed(4));
      section.classList.toggle('is-ready', globalProgress > 0.015);
      section.classList.toggle('is-complete', globalProgress > 0.92);

      const cards = [...section.querySelectorAll('.vpl-floating-card')];

      cards.forEach((card, index) => {
        const final = finalPositions[index] || finalPositions[finalPositions.length - 1];

        // Déploiement séquentiel mais rapide : les 5 cards sont visibles avant le bas.
        const local = easeOutCubic((globalProgress - index * 0.085) / 0.52);

        const startX = 230;
        const startY = 0;
        const startZ = 0;
        const startR = 0;
        const startRy = 0;

        const x = startX + (final.x - startX) * local;
        const y = startY + (final.y - startY) * local;
        const z = startZ + (final.z - startZ) * local;
        const r = startR + (final.r - startR) * local;
        const ry = startRy + (final.ry - startRy) * local;
        const scale = 0.82 + 0.18 * local;

        const opacity = clamp((globalProgress - index * 0.055) / 0.24);

        card.style.setProperty('--cinema-x', `${x.toFixed(2)}px`);
        card.style.setProperty('--cinema-y', `${y.toFixed(2)}px`);
        card.style.setProperty('--cinema-z', `${z.toFixed(2)}px`);
        card.style.setProperty('--cinema-r', `${r.toFixed(2)}deg`);
        card.style.setProperty('--cinema-ry', `${ry.toFixed(2)}deg`);
        card.style.setProperty('--cinema-scale', scale.toFixed(3));
        card.style.setProperty('--cinema-opacity', opacity.toFixed(3));
      });
    });

    ticking = false;
  };

  updateCardsUnfold();

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateCardsUnfold);
    }
  }, { passive: true });

  window.addEventListener('resize', updateCardsUnfold);
});
