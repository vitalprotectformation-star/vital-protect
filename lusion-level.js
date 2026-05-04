
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

/* Transition inter-pages : déplacée dans /page-transition.js pour l’appliquer à toutes les pages HTML du site. */


/* V23 — burger menu mobile */
window.addEventListener('DOMContentLoaded', () => {
  const MOBILE_QUERY = '(max-width: 760px)';
  const nav = document.querySelector('.vpl-nav');
  const menu = nav ? nav.querySelector('.vpl-menu') : null;
  if (!nav || !menu) return;

  const cta = nav.querySelector('.vpl-nav-cta');
  if (!menu.id) menu.id = 'vpl-mobile-menu';

  let burger = nav.querySelector('.vpl-nav-burger');
  if (!burger) {
    burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'vpl-nav-burger';
    burger.setAttribute('aria-label', 'Ouvrir le menu');
    burger.setAttribute('aria-controls', menu.id);
    burger.setAttribute('aria-expanded', 'false');
    burger.innerHTML = '<span></span><span></span><span></span>';
    nav.appendChild(burger);
  }

  if (cta && !menu.querySelector('.vpl-mobile-menu-cta')) {
    const mobileCta = cta.cloneNode(true);
    mobileCta.classList.add('vpl-mobile-menu-cta');
    mobileCta.removeAttribute('style');
    menu.appendChild(mobileCta);
  }

  let backdrop = document.querySelector('.vpl-mobile-menu-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'vpl-mobile-menu-backdrop';
    backdrop.setAttribute('aria-label', 'Fermer le menu');
    backdrop.hidden = true;
    document.body.appendChild(backdrop);
  }

  const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

  function setOpen(open) {
    const allow = isMobile() && open;
    nav.classList.toggle('is-open', allow);
    burger.classList.toggle('is-active', allow);
    burger.setAttribute('aria-expanded', allow ? 'true' : 'false');
    burger.setAttribute('aria-label', allow ? 'Fermer le menu' : 'Ouvrir le menu');
    document.documentElement.classList.toggle('vpl-mobile-menu-open', allow);
    if (allow) {
      backdrop.hidden = false;
      requestAnimationFrame(() => backdrop.classList.add('is-visible'));
    } else {
      backdrop.classList.remove('is-visible');
      window.setTimeout(() => {
        if (!document.documentElement.classList.contains('vpl-mobile-menu-open')) backdrop.hidden = true;
      }, 220);
    }
  }

  burger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(!nav.classList.contains('is-open'));
  });
  backdrop.addEventListener('click', () => setOpen(false));

  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  window.addEventListener('resize', () => {
    if (!isMobile()) setOpen(false);
  });
});

