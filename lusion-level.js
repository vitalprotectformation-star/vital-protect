
document.documentElement.classList.add('js');

(() => {
  const canvas = document.querySelector('.vpl-canvas');
  if (!canvas) return;

  const mobileOrReducedMotion = window.matchMedia('(max-width: 900px), (prefers-reduced-motion: reduce)').matches;
  if (mobileOrReducedMotion) {
    canvas.remove();
    return;
  }

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




window.addEventListener('DOMContentLoaded', () => {
  /*
   * V18 — Single master card.
   * Une seule carte se construit progressivement au scroll.
   */
  const sections = [...document.querySelectorAll('[data-single-card]')];

  if (!sections.length) return;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x), 3);

  let ticking = false;

  const updateSingleCards = () => {
    const vh = window.innerHeight || 1;

    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      const scrollable = Math.max(section.offsetHeight - vh, 1);

      // Progression volontairement lente : l'effet reste visible.
      const raw = clamp((-rect.top + vh * 0.04) / (scrollable * 0.92));
      const progress = easeOutCubic(raw);

      section.style.setProperty('--single-progress', progress.toFixed(4));

      const progressLabel = section.querySelector('[data-master-progress]');
      if (progressLabel) {
        progressLabel.textContent = String(Math.round(progress * 100));
      }

      const steps = [...section.querySelectorAll('[data-master-step]')];
      steps.forEach((step, index) => {
        const threshold = 0.12 + index * 0.145;
        step.classList.toggle('is-visible', progress >= threshold);
      });
    });

    ticking = false;
  };

  updateSingleCards();

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateSingleCards);
    }
  }, { passive: true });

  window.addEventListener('resize', updateSingleCards);

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    sections.forEach((section) => {
      const card = section.querySelector('.vpl-master-card');
      if (!card) return;

      card.addEventListener('pointermove', (event) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        card.style.setProperty('--my', `${event.clientY - rect.top}px`);
      });

      card.addEventListener('pointerleave', () => {
        card.style.removeProperty('--mx');
        card.style.removeProperty('--my');
      });
    });
  }
});


window.addEventListener('DOMContentLoaded', () => {
  const carousels = [...document.querySelectorAll('[data-vp-carousel]')];

  carousels.forEach((carousel) => {
    const track = carousel.querySelector('[data-carousel-track]');
    const prev = carousel.querySelector('[data-carousel-prev]');
    const next = carousel.querySelector('[data-carousel-next]');
    const dots = carousel.querySelector('[data-carousel-dots]');
    const cards = [...carousel.querySelectorAll('.vpl-carousel-card')];

    if (!track || !cards.length) return;

    let current = 0;

    const goTo = (index) => {
      current = Math.max(0, Math.min(cards.length - 1, index));
      cards[current].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      updateDots();
    };

    const updateDots = () => {
      if (!dots) return;
      [...dots.children].forEach((dot, index) => {
        dot.classList.toggle('is-active', index === current);
      });
    };

    if (dots && !dots.children.length) {
      cards.forEach((_, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'vpl-carousel-dot';
        dot.setAttribute('aria-label', `Aller à la carte ${index + 1}`);
        dot.addEventListener('click', () => goTo(index));
        dots.appendChild(dot);
      });
    }

    prev?.addEventListener('click', () => goTo(current - 1));
    next?.addEventListener('click', () => goTo(current + 1));

    track.addEventListener('scroll', () => {
      const center = track.scrollLeft + track.clientWidth / 2;
      let closest = 0;
      let dist = Infinity;

      cards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const nextDist = Math.abs(cardCenter - center);
        if (nextDist < dist) {
          dist = nextDist;
          closest = index;
        }
      });

      current = closest;
      updateDots();
    }, { passive: true });

    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      cards.forEach((card) => {
        card.addEventListener('pointermove', (event) => {
          const rect = card.getBoundingClientRect();
          card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
          card.style.setProperty('--my', `${event.clientY - rect.top}px`);
        });

        card.addEventListener('pointerleave', () => {
          card.style.removeProperty('--mx');
          card.style.removeProperty('--my');
        });
      });
    }

    updateDots();
  });
});


window.addEventListener('DOMContentLoaded', () => {
  const sections = [...document.querySelectorAll('[data-vp-constellation]')];
  if (!sections.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const stage = entry.target.querySelector('.vpl-constellation-stage');
        stage?.classList.add('is-visible');
      }
    });
  }, { threshold: 0.25 });

  sections.forEach((section) => {
    io.observe(section);
    const stage = section.querySelector('.vpl-constellation-stage');
    if (!stage) return;

    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      stage.addEventListener('pointermove', (event) => {
        const rect = stage.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        const rx = (py - 0.5) * -5;
        const ry = (px - 0.5) * 6;
        const core = stage.querySelector('.vpl-constellation-core');
        if (core) core.style.transform = `translate(-50%, -50%) rotateX(${rx}deg) rotateY(${ry}deg)`;
        stage.querySelectorAll('.vpl-constellation-node').forEach((node, index) => {
          const depth = (index + 1) * 2.2;
          const nx = (px - 0.5) * depth * 7;
          const ny = (py - 0.5) * depth * 6;
          node.style.transform = `translate(${nx}px, ${ny}px)`;
          const nr = node.getBoundingClientRect();
          node.style.setProperty('--mx', `${event.clientX - nr.left}px`);
          node.style.setProperty('--my', `${event.clientY - nr.top}px`);
        });
      });

      stage.addEventListener('pointerleave', () => {
        const core = stage.querySelector('.vpl-constellation-core');
        if (core) core.style.transform = '';
        stage.querySelectorAll('.vpl-constellation-node').forEach((node) => {
          node.style.transform = '';
          node.style.removeProperty('--mx');
          node.style.removeProperty('--my');
        });
      });
    }
  });
});


    const FIRST_START_DELAY = 900;
    const FIRST_DRAW_DURATION = 2200;

    const PAUSE_AFTER_FIRST = 850;

    const SECOND_DRAW_DURATION = 2600;
    const SECOND_START_DELAY = FIRST_START_DELAY + FIRST_DRAW_DURATION + PAUSE_AFTER_FIRST;

    const FLATLINE_DELAY = SECOND_START_DELAY + SECOND_DRAW_DURATION + 360;
    const OPEN_DELAY = FLATLINE_DELAY + 1150;
    const HIDE_DELAY = OPEN_DELAY + 1650;

    const ECG_PATH = `M 0 115
             L 1320 115
             L 1368 115
             L 1398 88
             L 1428 115
             L 1464 115
             L 1502 24
             L 1544 206
             L 1588 115
             L 1920 115`;

    const FLATLINE_PATH = "M 0 115 L 1920 115";
    const HEARTBEAT_POINTS = [0.79];

    let timers = [];
    let activeAnimation = null;
    let beatResetTimer = null;

    function wait(fn, delay) {
      const timer = setTimeout(fn, delay);
      timers.push(timer);
    }

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    function getTitles() {
      return document.querySelectorAll('.vp-title');
    }

    function triggerTitleBeat() {
      const titles = getTitles();
      titles.forEach((title) => title.classList.remove('is-beating'));

      // force reflow pour relancer l'effet proprement
      titles.forEach((title) => void title.offsetWidth);
      titles.forEach((title) => title.classList.add('is-beating'));

      clearTimeout(beatResetTimer);
      beatResetTimer = setTimeout(() => {
        titles.forEach((title) => title.classList.remove('is-beating'));
      }, 170);
    }

    function setupLine() {
      const line = document.getElementById("vpEcgLine");
      const tracer = document.getElementById("vpTracer");

      if (!line) return null;

      line.setAttribute("d", ECG_PATH);
      const length = line.getTotalLength();

      line.style.strokeDasharray = length;
      line.style.strokeDashoffset = length;
      line.classList.remove("is-active", "is-power", "is-flatline");

      if (tracer) {
        tracer.classList.remove("is-active");
        tracer.style.left = "0px";
        tracer.style.top = "50%";
      }

      return { line, tracer, length };
    }

    function getZoneMetrics() {
      const zone = document.querySelector(".vp-ecg-zone");
      return {
        zoneWidth: zone ? zone.getBoundingClientRect().width : window.innerWidth,
        zoneHeight: zone ? zone.getBoundingClientRect().height : 230
      };
    }

    function animateTracer(line, tracer, length, duration, beats = []) {
      const { zoneWidth, zoneHeight } = getZoneMetrics();
      let beatIndex = 0;
      const start = performance.now();

      function frame(now) {
        const progress = Math.min((now - start) / duration, 1);

        while (beatIndex < beats.length && progress >= beats[beatIndex]) {
          triggerTitleBeat();
          beatIndex += 1;
        }

        if (tracer) {
          const point = line.getPointAtLength(length * progress);
          tracer.style.left = (point.x / 1920 * zoneWidth) + 'px';
          tracer.style.top = (point.y / 230 * zoneHeight) + 'px';
        }

        if (progress < 1) {
          activeAnimation = requestAnimationFrame(frame);
        } else {
          if (tracer) tracer.classList.remove('is-active');
          activeAnimation = null;
        }
      }

      if (activeAnimation) cancelAnimationFrame(activeAnimation);
      activeAnimation = requestAnimationFrame(frame);
    }

    function drawLine(duration) {
      const data = setupLine();
      if (!data) return;

      const { line, tracer, length } = data;
      line.classList.add('is-active');
      if (tracer) tracer.classList.add('is-active');

      const { zoneWidth, zoneHeight } = getZoneMetrics();
      let beatIndex = 0;
      const start = performance.now();

      function frame(now) {
        const progress = Math.min((now - start) / duration, 1);
        line.style.strokeDashoffset = length * (1 - progress);

        while (beatIndex < HEARTBEAT_POINTS.length && progress >= HEARTBEAT_POINTS[beatIndex]) {
          triggerTitleBeat();
          beatIndex += 1;
        }

        if (tracer) {
          const point = line.getPointAtLength(length * progress);
          tracer.style.left = (point.x / 1920 * zoneWidth) + 'px';
          tracer.style.top = (point.y / 230 * zoneHeight) + 'px';
        }

        if (progress < 1) {
          activeAnimation = requestAnimationFrame(frame);
        } else {
          line.style.strokeDashoffset = 0;
          if (tracer) tracer.classList.remove('is-active');
          activeAnimation = null;
        }
      }

      if (activeAnimation) cancelAnimationFrame(activeAnimation);
      activeAnimation = requestAnimationFrame(frame);
    }

    function retraceLine(duration, options = {}) {
      const line = document.getElementById('vpEcgLine');
      const tracer = document.getElementById('vpTracer');
      if (!line) return;

      const length = line.getTotalLength();
      line.classList.add('is-active');

      if (options.power) {
        line.classList.add('is-power');
      }

      if (tracer) {
        tracer.classList.add('is-active');
      }

      animateTracer(line, tracer, length, duration, HEARTBEAT_POINTS);

      wait(() => {
        line.classList.remove('is-power');
      }, duration);
    }

    function flattenLine() {
      const line = document.getElementById('vpEcgLine');
      const tracer = document.getElementById('vpTracer');
      if (!line) return;

      if (activeAnimation) {
        cancelAnimationFrame(activeAnimation);
        activeAnimation = null;
      }

      line.setAttribute('d', FLATLINE_PATH);
      const length = line.getTotalLength();
      line.style.strokeDasharray = length;
      line.style.strokeDashoffset = 0;
      line.classList.remove('is-power');
      line.classList.add('is-active', 'is-flatline');

      if (tracer) {
        tracer.classList.remove('is-active');
      }
    }

    function startIntro() {
      const intro = document.getElementById('vpIntro');
      if (!intro) return;

      clearTimers();

      if (activeAnimation) {
        cancelAnimationFrame(activeAnimation);
        activeAnimation = null;
      }

      intro.classList.remove('vp-open', 'vp-hidden');
      document.body.classList.add('vp-intro-playing');

      setupLine();

      wait(function () {
        drawLine(FIRST_DRAW_DURATION);
      }, FIRST_START_DELAY);

      wait(function () {
        retraceLine(SECOND_DRAW_DURATION, { power: true });
      }, SECOND_START_DELAY);

      wait(function () {
        flattenLine();
      }, FLATLINE_DELAY);

      wait(function () {
        intro.classList.add('vp-open');
      }, OPEN_DELAY);

      wait(function () {
        intro.classList.add('vp-hidden');
        document.body.classList.remove('vp-intro-playing');
      }, HIDE_DELAY);
    }

    function replayIntro() {
      startIntro();
    }

    window.addEventListener('resize', () => {
      const line = document.getElementById('vpEcgLine');
      if (!line || !line.classList.contains('is-active')) return;
      // on ne reset pas l'animation en cours, on garde juste l'état visuel lors d'un resize
    });

    function shouldSkipIntroForRouteTransition() {
      try {
        return sessionStorage.getItem('vpl-route-transition-next') === '1'
          || document.documentElement.classList.contains('vpl-route-preload-transition');
      } catch (_) {
        return document.documentElement.classList.contains('vpl-route-preload-transition');
      }
    }

    function hideIntroImmediately() {
      const intro = document.getElementById('vpIntro');
      if (!intro) return;

      clearTimers();
      if (activeAnimation) {
        cancelAnimationFrame(activeAnimation);
        activeAnimation = null;
      }
      clearTimeout(beatResetTimer);

      intro.classList.add('vp-hidden');
      intro.classList.remove('vp-open');
      document.body.classList.remove('vp-intro-playing');
    }

    document.addEventListener('DOMContentLoaded', () => {
      // Si l'accueil est ouvert après une transition inter-page, on évite
      // de relancer l'intro ECG sous le masque de dépixélisation.
      if (shouldSkipIntroForRouteTransition()) {
        hideIntroImmediately();
        return;
      }

      startIntro();
    });

/* V21 — Header compact au scroll */
(() => {
  const root = document.documentElement;
  let ticking = false;

  const updateScrolledState = () => {
    root.classList.toggle('vpl-scrolled', window.scrollY > 36);
    ticking = false;
  };

  updateScrolledState();

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateScrolledState);
    }
  }, { passive: true });
})();

/* V24 — Hero carte animée / parallax premium */
(() => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canHover = window.matchMedia('(hover:hover) and (pointer:fine)');

  window.addEventListener('DOMContentLoaded', () => {
    const hero = document.querySelector('body.vpl-home .vpl-hero');
    const visual = document.querySelector('body.vpl-home [data-hero-visual]');

    if (hero) {
      requestAnimationFrame(() => {
        hero.classList.add('vpl-hero-mounted');
      });
    }

    if (!visual || prefersReduced.matches || !canHover.matches) return;

    const animatedItems = [...visual.querySelectorAll('[data-depth]')];
    let raf = null;
    let lastEvent = null;

    const reset = () => {
      visual.style.setProperty('--hero-rx', '0deg');
      visual.style.setProperty('--hero-ry', '0deg');
      visual.style.setProperty('--hero-x', '50%');
      visual.style.setProperty('--hero-y', '50%');
      animatedItems.forEach((item) => {
        item.style.setProperty('--card-x', '0px');
        item.style.setProperty('--card-y', '0px');
      });
    };

    const render = () => {
      raf = null;
      if (!lastEvent) return;

      const rect = visual.getBoundingClientRect();
      const px = (lastEvent.clientX - rect.left) / rect.width;
      const py = (lastEvent.clientY - rect.top) / rect.height;
      const x = Math.max(0, Math.min(1, px));
      const y = Math.max(0, Math.min(1, py));
      const rx = (x - .5) * 8.8;
      const ry = (0.5 - y) * 7.2;

      visual.style.setProperty('--hero-rx', `${rx.toFixed(2)}deg`);
      visual.style.setProperty('--hero-ry', `${ry.toFixed(2)}deg`);
      visual.style.setProperty('--hero-x', `${(x * 100).toFixed(1)}%`);
      visual.style.setProperty('--hero-y', `${(y * 100).toFixed(1)}%`);

      animatedItems.forEach((item) => {
        const depth = Number(item.getAttribute('data-depth') || 1);
        item.style.setProperty('--card-x', `${((x - .5) * depth * 22).toFixed(2)}px`);
        item.style.setProperty('--card-y', `${((y - .5) * depth * 18).toFixed(2)}px`);
      });
    };

    visual.addEventListener('pointermove', (event) => {
      lastEvent = event;
      if (!raf) raf = requestAnimationFrame(render);
    });

    visual.addEventListener('pointerleave', reset);
    reset();
  });
})();


/* V30 — Transition inter-pages en particules
   Idée : de fines particules viennent s'assembler pour recouvrir l'écran,
   le mot-symbole VITAL PROTECT apparaît au centre, puis la nouvelle page
   démarre sous un aplat plein avant une désintégration inverse. */
(() => {
  const STORAGE_KEY = 'vpl-route-transition-next';
  const ORIGIN_KEY = 'vpl-route-transition-origin';
  const SEED_KEY = 'vpl-route-transition-seed';
  const PREFETCH_ATTR = 'data-vpl-prefetched';
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const EXIT_BUILD_MS = 980;
  const ENTER_BREAK_MS = 980;
  const SOLID_HOLD_MS = 220;
  const PRELOAD_RELEASE_MS = 120;

  let overlay = null;
  let overlayController = null;
  let transitionRunning = false;
  const prefetched = new Set();

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOutQuart = (t) => 1 - Math.pow(1 - clamp(t), 4);
  const nowSeed = () => Math.floor((performance.now() * 1000 + Math.random() * 1000000) % 2147483647);

  const seededNoise = (seed, index) => {
    let value = (seed + index * 374761393) | 0;
    value = (value ^ (value >>> 13)) * 1274126177;
    value = value ^ (value >>> 16);
    return ((value >>> 0) % 10000) / 10000;
  };

  const getSolidColor = () => {
    const fromCss = getComputedStyle(document.documentElement).getPropertyValue('--vpl-transition-solid').trim();
    return fromCss || '#0b1424';
  };

  const stopOverlayController = () => {
    if (overlayController && typeof overlayController.destroy === 'function') {
      overlayController.destroy();
    }
    overlayController = null;
  };

  const removeOverlay = () => {
    stopOverlayController();

    if (overlay) {
      overlay.remove();
      overlay = null;
    }

    document.documentElement.classList.remove('vpl-route-transitioning');
    document.documentElement.style.removeProperty('--vpl-transition-x');
    document.documentElement.style.removeProperty('--vpl-transition-y');
    transitionRunning = false;
  };

  const releasePreloadMask = () => {
    const root = document.documentElement;
    if (!root.classList.contains('vpl-route-preload-transition')) return;

    root.classList.add('vpl-route-preload-releasing');
    window.setTimeout(() => {
      root.classList.remove('vpl-route-preload-transition', 'vpl-route-preload-releasing');
      root.style.removeProperty('--vpl-transition-x');
      root.style.removeProperty('--vpl-transition-y');
    }, PRELOAD_RELEASE_MS + 120);
  };

  const storeTransitionState = (originX, originY, seed) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
      sessionStorage.setItem(SEED_KEY, String(seed));
      sessionStorage.setItem(ORIGIN_KEY, JSON.stringify({
        x: clamp(originX / Math.max(window.innerWidth || 1, 1)),
        y: clamp(originY / Math.max(window.innerHeight || 1, 1))
      }));
    } catch (_) {}
  };

  const readTransitionOrigin = () => {
    try {
      const raw = sessionStorage.getItem(ORIGIN_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Number.isFinite(data?.x) || !Number.isFinite(data?.y)) return null;
      return {
        originX: clamp(data.x) * (window.innerWidth || 1),
        originY: clamp(data.y) * (window.innerHeight || 1)
      };
    } catch (_) {
      return null;
    }
  };

  const readTransitionSeed = () => {
    try {
      const value = Number(sessionStorage.getItem(SEED_KEY));
      return Number.isFinite(value) ? value : 1;
    } catch (_) {
      return 1;
    }
  };

  const clearTransitionStorage = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(ORIGIN_KEY);
      sessionStorage.removeItem(SEED_KEY);
    } catch (_) {}
  };

  const warmPage = (href) => {
    if (!href || prefetched.has(href)) return;
    prefetched.add(href);

    try {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = href;
      link.as = 'document';
      document.head.appendChild(link);
    } catch (_) {}

    try {
      fetch(href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'force-cache',
        priority: 'low'
      }).catch(() => {});
    } catch (_) {}
  };

  const setOrigin = (node, originX, originY) => {
    const width = window.innerWidth || document.documentElement.clientWidth || 1;
    const height = window.innerHeight || document.documentElement.clientHeight || 1;
    const x = `${clamp(originX / width) * 100}%`;
    const y = `${clamp(originY / height) * 100}%`;

    node.style.setProperty('--vpl-transition-x', x);
    node.style.setProperty('--vpl-transition-y', y);
    document.documentElement.style.setProperty('--vpl-transition-x', x);
    document.documentElement.style.setProperty('--vpl-transition-y', y);
  };

  const createParticleOverlay = ({ mode, originX, originY, seed }) => {
    stopOverlayController();
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.className = `vpl-page-transition vpl-particle-transition is-${mode}`;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.setProperty('--vpl-transition-solid-current', getSolidColor());
    setOrigin(overlay, originX, originY);

    const solid = document.createElement('div');
    solid.className = 'vpl-page-transition__solid';

    const canvas = document.createElement('canvas');
    canvas.className = 'vpl-page-transition__canvas';

    const brand = document.createElement('div');
    brand.className = 'vpl-page-transition__brand';
    brand.innerHTML = '<span>Vital Protect</span>';

    overlay.append(solid, canvas, brand);
    document.body.appendChild(overlay);

    const ctx = canvas.getContext('2d', { alpha: true });
    let raf = 0;
    let resizeRaf = 0;
    let startTime = null;
    let dpr = 1;
    let width = 0;
    let height = 0;
    let particles = [];
    let destroyed = false;

    const particleCountForViewport = () => {
      const area = Math.max(1, (window.innerWidth || 1) * (window.innerHeight || 1));
      return Math.min(1600, Math.max(360, Math.round(area / 2400)));
    };

    const buildParticles = () => {
      const count = particleCountForViewport();
      const cols = Math.max(16, Math.round(Math.sqrt(count * (width / Math.max(height, 1)))));
      const rows = Math.max(12, Math.ceil(count / cols));
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const maxDistance = Math.max(...[[0,0],[width,0],[0,height],[width,height]].map(([x, y]) => Math.hypot(x - originX, y - originY))) || 1;

      particles = Array.from({ length: count }, (_, index) => {
        const noiseA = seededNoise(seed, index + 11);
        const noiseB = seededNoise(seed, index + 1011);
        const noiseC = seededNoise(seed, index + 2011);
        const noiseD = seededNoise(seed, index + 3011);
        const col = index % cols;
        const row = Math.floor(index / cols);
        const cellW = width / cols;
        const cellH = height / rows;
        const tx = clamp((col + 0.14 + noiseA * 0.72) / cols, 0, 1) * width;
        const ty = clamp((row + 0.14 + noiseB * 0.72) / rows, 0, 1) * height;
        const angle = Math.atan2(ty - originY, tx - originX) + (noiseC - 0.5) * 0.38;
        const travel = Math.max(width, height) * (1.05 + noiseD * 0.55);
        const sx = originX + Math.cos(angle) * travel;
        const sy = originY + Math.sin(angle) * travel;
        const exAngle = angle + (noiseA - 0.5) * 0.55;
        const exDist = travel * (1.06 + noiseB * 0.35);
        const ex = originX + Math.cos(exAngle) * exDist;
        const ey = originY + Math.sin(exAngle) * exDist;
        const distNorm = clamp(Math.hypot(tx - originX, ty - originY) / maxDistance);
        const centerNorm = clamp(Math.hypot(tx - centerX, ty - centerY) / Math.max(width, height));

        return {
          sx,
          sy,
          tx,
          ty,
          ex,
          ey,
          r: 0.9 + noiseA * 1.8,
          alpha: 0.34 + noiseB * 0.58,
          glow: 10 + noiseC * 22,
          delay: clamp(distNorm * 0.42 + noiseD * 0.22, 0, 0.72),
          fadeDelay: clamp((1 - distNorm) * 0.12 + centerNorm * 0.28 + noiseA * 0.24, 0, 0.72)
        };
      });
    };

    const resize = () => {
      width = Math.max(window.innerWidth || document.documentElement.clientWidth || 1, 1);
      height = Math.max(window.innerHeight || document.documentElement.clientHeight || 1, 1);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildParticles();
    };

    const drawParticle = (x, y, radius, alpha, glow, stretchX = 0, stretchY = 0) => {
      if (alpha <= 0.001 || radius <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = glow;
      ctx.shadowColor = 'rgba(142, 190, 235, 0.42)';
      ctx.fillStyle = 'rgba(247, 250, 255, 0.96)';
      ctx.beginPath();
      ctx.ellipse(x, y, radius + stretchX, radius + stretchY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const render = (timestamp) => {
      if (destroyed) return;
      if (startTime == null) startTime = timestamp;

      const elapsed = timestamp - startTime;
      ctx.clearRect(0, 0, width, height);

      if (mode === 'exiting') {
        const buildProgress = clamp(elapsed / EXIT_BUILD_MS);
        const holdProgress = clamp((elapsed - EXIT_BUILD_MS) / SOLID_HOLD_MS);
        const solidOpacity = clamp(0.14 + easeOutQuart(buildProgress) * 0.92 + holdProgress * 0.18, 0, 1);
        const brandIn = clamp((buildProgress - 0.24) / 0.44);
        const brandOpacity = clamp(easeInOutCubic(brandIn) * (1 - holdProgress * 0.18), 0, 1);
        const brandScale = 0.92 + easeOutCubic(brandIn) * 0.08;

        solid.style.opacity = solidOpacity.toFixed(4);
        brand.style.opacity = brandOpacity.toFixed(4);
        brand.style.transform = `translate3d(0, 0, 0) scale(${brandScale.toFixed(4)})`;

        particles.forEach((particle) => {
          const p = clamp((buildProgress - particle.delay) / Math.max(0.22, 1 - particle.delay));
          const eased = easeOutCubic(p);
          const x = lerp(particle.sx, particle.tx, eased);
          const y = lerp(particle.sy, particle.ty, eased);
          const alpha = particle.alpha * clamp(0.10 + p * 1.05, 0, 1) * (1 - holdProgress * 0.12);
          const radius = particle.r * (0.5 + p * 0.95 + holdProgress * 0.16);
          const stretch = (1 - p) * 2.4;
          drawParticle(x, y, radius, alpha, particle.glow, stretch, stretch * 0.45);
        });

        if (elapsed < EXIT_BUILD_MS + SOLID_HOLD_MS) {
          raf = window.requestAnimationFrame(render);
        }
      } else {
        const breakProgress = clamp(elapsed / ENTER_BREAK_MS);
        const bgFade = 1 - easeInOutCubic(clamp((elapsed - 100) / (ENTER_BREAK_MS - 100)));
        const brandOut = clamp(elapsed / 420);
        const brandOpacity = 1 - easeOutCubic(brandOut);
        const brandScale = 1 - clamp(breakProgress * 0.08, 0, 0.08);

        solid.style.opacity = clamp(bgFade, 0, 1).toFixed(4);
        brand.style.opacity = clamp(brandOpacity, 0, 1).toFixed(4);
        brand.style.transform = `translate3d(0, 0, 0) scale(${brandScale.toFixed(4)})`;

        particles.forEach((particle) => {
          const p = clamp((breakProgress - particle.fadeDelay) / Math.max(0.22, 1 - particle.fadeDelay));
          const eased = easeInOutCubic(p);
          const x = lerp(particle.tx, particle.ex, eased);
          const y = lerp(particle.ty, particle.ey, eased);
          const alpha = particle.alpha * Math.pow(1 - p, 1.12);
          const radius = particle.r * (1 + p * 0.85);
          const stretch = p * 2.8;
          drawParticle(x, y, radius, alpha, particle.glow, stretch * 0.4, stretch);
        });

        if (elapsed < ENTER_BREAK_MS) {
          raf = window.requestAnimationFrame(render);
        }
      }
    };

    const onResize = () => {
      window.cancelAnimationFrame(resizeRaf);
      resizeRaf = window.requestAnimationFrame(resize);
    };

    resize();
    window.addEventListener('resize', onResize, { passive: true });
    raf = window.requestAnimationFrame(render);

    return {
      node: overlay,
      destroy() {
        destroyed = true;
        window.cancelAnimationFrame(raf);
        window.cancelAnimationFrame(resizeRaf);
        window.removeEventListener('resize', onResize, { passive: true });
      }
    };
  };

  const shouldSkipLink = (link, event) => {
    if (!link || transitionRunning || prefersReduced.matches) return true;
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return true;
    if (link.target && link.target !== '_self') return true;
    if (link.hasAttribute('download')) return true;
    if (link.dataset.noTransition === 'true') return true;

    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return true;

    let url;
    try {
      url = new URL(link.href, window.location.href);
    } catch (_) {
      return true;
    }

    if (url.origin !== window.location.origin) return true;

    const samePath = url.pathname === window.location.pathname && url.search === window.location.search;
    if (samePath) return true;

    const lastPart = url.pathname.split('/').pop() || '';
    if (/\.[a-z0-9]+$/i.test(lastPart) && !/\.html?$/i.test(lastPart)) return true;

    const publicTransitionPages = new Set([
      '',
      'index.html',
      'stage.html',
      'methode.html',
      'entreprises.html',
      'devenir-formateur.html',
      'contact.html',
      'faq.html',
      'cgv.html',
      'mentions-legales.html',
      'politique-confidentialite.html'
    ]);

    if (!publicTransitionPages.has(lastPart)) return true;
    return false;
  };

  const startExitTransition = (href, eventTarget) => {
    transitionRunning = true;
    document.documentElement.classList.add('vpl-route-transitioning');

    const rect = eventTarget?.getBoundingClientRect?.();
    const originX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const originY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const seed = nowSeed();

    storeTransitionState(originX, originY, seed);
    warmPage(href);

    overlayController = createParticleOverlay({ mode: 'exiting', originX, originY, seed });

    window.setTimeout(() => {
      window.location.href = href;
    }, EXIT_BUILD_MS + SOLID_HOLD_MS);
  };

  const startEnterTransition = () => {
    const storedOrigin = readTransitionOrigin();
    const originX = storedOrigin?.originX ?? window.innerWidth / 2;
    const originY = storedOrigin?.originY ?? window.innerHeight / 2;
    const seed = readTransitionSeed();

    transitionRunning = true;
    document.documentElement.classList.add('vpl-route-transitioning');
    clearTransitionStorage();

    overlayController = createParticleOverlay({ mode: 'entering', originX, originY, seed });

    window.requestAnimationFrame(() => {
      window.setTimeout(releasePreloadMask, 34);
    });

    window.setTimeout(removeOverlay, ENTER_BREAK_MS + 140);
  };

  const initPageTransition = () => {
    let shouldPlayEnter = false;
    try {
      shouldPlayEnter = sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {}

    if (shouldPlayEnter && !prefersReduced.matches) {
      startEnterTransition();
    } else {
      clearTransitionStorage();
      releasePreloadMask();
    }

    document.addEventListener('pointerover', (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute(PREFETCH_ATTR) || shouldSkipLink(link, null)) return;
      link.setAttribute(PREFETCH_ATTR, 'true');
      warmPage(link.href);
    }, { passive: true });

    document.addEventListener('focusin', (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute(PREFETCH_ATTR) || shouldSkipLink(link, null)) return;
      link.setAttribute(PREFETCH_ATTR, 'true');
      warmPage(link.href);
    });

    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (shouldSkipLink(link, event)) return;

      event.preventDefault();
      startExitTransition(link.href, link);
    }, true);
  };

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) removeOverlay();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageTransition, { once: true });
  } else {
    initPageTransition();
  }
})();

