
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
