/* Transition inter-pages Vital Protect
   Sortie : la page visible est remplie par le bloc bleu.
   Entrée : le bloc bleu se désintègre pour révéler la nouvelle page. */
(function () {
  if (window.VitalPageTransition) return;

  var STORAGE_KEY = 'vpl-route-transition-next';
  var ORIGIN_KEY = 'vpl-route-transition-origin';
  var SEED_KEY = 'vpl-route-transition-seed';
  var PREFETCH_ATTR = 'data-vpl-prefetched';
  var COLOR = '#2f6f9f';
  var SPLASH_IMAGE = 'transition-screen.png';
  var TILE_SIZE = 11;
  var HOLD_DURATION = 240;
  var FLOW_DURATION = 1550;
  var PARTICLE_LIFE = 980;
  var EXTRA_SAFE_MS = 110;
  var TOTAL_DURATION = HOLD_DURATION + FLOW_DURATION + PARTICLE_LIFE * 1.25 + EXTRA_SAFE_MS;

  var overlay = null;
  var controller = null;
  var transitionRunning = false;
  var prefetched = new Set();
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  var splashImage = null;
  var splashImageReady = false;

  function getSplashUrl() {
    return new URL(SPLASH_IMAGE, window.location.href).href;
  }

  function ensureSplashImage() {
    if (splashImage) return splashImage;
    splashImage = new Image();
    splashImage.decoding = 'async';
    splashImage.onload = function () { splashImageReady = true; };
    splashImage.onerror = function () { splashImageReady = false; };
    splashImage.src = getSplashUrl();
    if (splashImage.complete && splashImage.naturalWidth > 0) splashImageReady = true;
    return splashImage;
  }

  function whenSplashReady(callback) {
    var image = ensureSplashImage();

    if (splashImageReady || (image.complete && image.naturalWidth > 0)) {
      splashImageReady = true;
      callback();
      return;
    }

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      image.removeEventListener('load', finish);
      image.removeEventListener('error', finish);
      splashImageReady = !!(image.complete && image.naturalWidth > 0);
      callback();
    }

    image.addEventListener('load', finish);
    image.addEventListener('error', finish);

    if (image.decode) {
      image.decode().then(finish).catch(function () {});
    }

    window.setTimeout(finish, 900);
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeInOutCubic(t) {
    t = clamp01(t);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - clamp01(t), 3);
  }

  function nowSeed() {
    return Math.floor((performance.now() * 1000 + Math.random() * 1000000) % 2147483647);
  }

  function seededRandom(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function injectTransitionStyles() {
    if (document.getElementById('vpl-page-transition-style')) return;

    var style = document.createElement('style');
    style.id = 'vpl-page-transition-style';
    style.textContent = [
      ':root{--vpl-transition-solid:' + COLOR + ';--vpl-transition-text:#fff;--vpl-transition-image:url("' + getSplashUrl() + '")}',
      'html.vpl-route-preload-transition,html.vpl-route-preload-transition body{background:' + COLOR + '!important}',
      'html.vpl-route-preload-transition::before{content:"";position:fixed;inset:0;z-index:2147482998;pointer-events:none;background:' + COLOR + ' center/cover no-repeat;background-image:var(--vpl-transition-image);opacity:1}',
      'html.vpl-route-preload-transition.vpl-route-preload-releasing::before{animation:vplBlockPreloadOut .22s ease both}',
      'html.vpl-route-transitioning{cursor:progress}',
      'html.vpl-route-transitioning,html.vpl-route-transitioning body{overflow:hidden!important}',
      '.vpl-page-transition{position:fixed!important;inset:0!important;z-index:2147483000!important;pointer-events:none!important;overflow:hidden!important;isolation:isolate!important;contain:layout paint style!important;background:transparent!important;opacity:1!important;visibility:visible!important;transform:none!important}',
      '.vpl-page-transition__canvas{position:absolute;inset:0;width:100%;height:100%;z-index:1;display:block}',
      '@keyframes vplBlockPreloadOut{from{opacity:1}to{opacity:0}}',
      '@media(prefers-reduced-motion:reduce){.vpl-page-transition,html.vpl-route-preload-transition::before{display:none!important}}'
    ].join('\n');

    (document.head || document.documentElement).appendChild(style);
  }

  function hasIncomingTransition() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function prepareIncomingMask() {
    if (!hasIncomingTransition()) return;

    ensureSplashImage();
    injectTransitionStyles();

    try {
      var origin = JSON.parse(sessionStorage.getItem(ORIGIN_KEY) || '{}');
      if (Number.isFinite(origin.x)) {
        document.documentElement.style.setProperty('--vpl-transition-x', (clamp01(origin.x) * 100) + '%');
      }
      if (Number.isFinite(origin.y)) {
        document.documentElement.style.setProperty('--vpl-transition-y', (clamp01(origin.y) * 100) + '%');
      }
    } catch (_) {}

    document.documentElement.classList.add('vpl-route-preload-transition');
  }

  function getSolidColor() {
    var cssColor = '';
    try {
      cssColor = getComputedStyle(document.documentElement).getPropertyValue('--vpl-transition-solid').trim();
    } catch (_) {}
    return cssColor || COLOR;
  }

  function stopController() {
    if (controller && typeof controller.destroy === 'function') controller.destroy();
    controller = null;
  }

  function removeOverlay() {
    stopController();
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.documentElement.classList.remove('vpl-route-transitioning');
    document.documentElement.style.removeProperty('--vpl-transition-x');
    document.documentElement.style.removeProperty('--vpl-transition-y');
    transitionRunning = false;
  }

  function releasePreloadMask() {
    var root = document.documentElement;
    if (!root.classList.contains('vpl-route-preload-transition')) return;

    root.classList.add('vpl-route-preload-releasing');
    window.setTimeout(function () {
      root.classList.remove('vpl-route-preload-transition', 'vpl-route-preload-releasing');
      root.style.removeProperty('--vpl-transition-x');
      root.style.removeProperty('--vpl-transition-y');
    }, 260);
  }

  function storeTransitionState(originX, originY, seed) {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
      sessionStorage.setItem(SEED_KEY, String(seed));
      sessionStorage.setItem(ORIGIN_KEY, JSON.stringify({
        x: clamp01(originX / Math.max(window.innerWidth || 1, 1)),
        y: clamp01(originY / Math.max(window.innerHeight || 1, 1))
      }));
    } catch (_) {}
  }

  function readTransitionOrigin() {
    try {
      var raw = sessionStorage.getItem(ORIGIN_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!Number.isFinite(data && data.x) || !Number.isFinite(data && data.y)) return null;
      return {
        originX: clamp01(data.x) * (window.innerWidth || 1),
        originY: clamp01(data.y) * (window.innerHeight || 1)
      };
    } catch (_) {
      return null;
    }
  }

  function readTransitionSeed() {
    try {
      var value = Number(sessionStorage.getItem(SEED_KEY));
      return Number.isFinite(value) ? value : 1;
    } catch (_) {
      return 1;
    }
  }

  function clearTransitionStorage() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(ORIGIN_KEY);
      sessionStorage.removeItem(SEED_KEY);
    } catch (_) {}
  }

  function warmPage(href) {
    if (!href || prefetched.has(href)) return;
    prefetched.add(href);

    ensureSplashImage();

    try {
      var link = document.createElement('link');
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
      }).catch(function () {});
    } catch (_) {}
  }

  function setOrigin(node, originX, originY) {
    var width = window.innerWidth || document.documentElement.clientWidth || 1;
    var height = window.innerHeight || document.documentElement.clientHeight || 1;
    var x = (clamp01(originX / width) * 100) + '%';
    var y = (clamp01(originY / height) * 100) + '%';

    node.style.setProperty('--vpl-transition-x', x);
    node.style.setProperty('--vpl-transition-y', y);
    document.documentElement.style.setProperty('--vpl-transition-x', x);
    document.documentElement.style.setProperty('--vpl-transition-y', y);
  }

  function buildCanvasTransition(options) {
    var mode = options.mode;
    var originX = options.originX;
    var originY = options.originY;
    var seed = options.seed;

    stopController();
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.className = 'vpl-page-transition vpl-block-transition is-' + mode;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.setProperty('--vpl-transition-solid-current', getSolidColor());
    setOrigin(overlay, originX, originY);

    var canvas = document.createElement('canvas');
    canvas.className = 'vpl-page-transition__canvas';

    overlay.appendChild(canvas);
    (document.body || document.documentElement).appendChild(overlay);

    var ctx = canvas.getContext('2d', { alpha: true });
    var color = getSolidColor();
    var textureCanvas = document.createElement('canvas');
    var textureCtx = textureCanvas.getContext('2d', { alpha: false });
    var textureReady = false;
    var w = 0;
    var h = 0;
    var dpr = 1;
    var tiles = [];
    var particles = [];
    var cursor = 0;
    var raf = 0;
    var resizeTimer = 0;
    var startTime = 0;
    var destroyed = false;

    function createTiles() {
      var rand = seededRandom(seed || 1);
      var cols = Math.ceil(w / TILE_SIZE);
      var rows = Math.ceil(h / TILE_SIZE);
      tiles = [];
      particles = [];
      cursor = 0;

      for (var y = 0; y < rows; y += 1) {
        for (var x = 0; x < cols; x += 1) {
          tiles.push({
            x: x * TILE_SIZE,
            y: y * TILE_SIZE,
            released: false,
            filling: false,
            filled: mode === 'entering'
          });
        }
      }

      for (var i = tiles.length - 1; i > 0; i -= 1) {
        var j = Math.floor(rand() * (i + 1));
        var tmp = tiles[i];
        tiles[i] = tiles[j];
        tiles[j] = tmp;
      }

      tiles.sort(function (a, b) {
        var ax = a.x - w / 2;
        var ay = a.y - h / 2;
        var bx = b.x - w / 2;
        var by = b.y - h / 2;
        var da = Math.sqrt(ax * ax + ay * ay) + rand() * 900;
        var db = Math.sqrt(bx * bx + by * by) + rand() * 900;
        return da - db;
      });

      if (mode === 'exiting') tiles.reverse();
    }

    function renderTexture() {
      var image = ensureSplashImage();
      textureReady = !!(image && splashImageReady && image.naturalWidth > 0 && image.naturalHeight > 0);
      textureCanvas.width = Math.max(1, Math.round(w));
      textureCanvas.height = Math.max(1, Math.round(h));
      textureCtx.clearRect(0, 0, w, h);

      if (!textureReady) {
        textureCtx.fillStyle = color;
        textureCtx.fillRect(0, 0, w, h);
        return;
      }

      var iw = image.naturalWidth || image.width;
      var ih = image.naturalHeight || image.height;
      var scale = Math.max(w / iw, h / ih);
      var dw = iw * scale;
      var dh = ih * scale;
      var dx = (w - dw) / 2;
      var dy = (h - dh) / 2;
      textureCtx.drawImage(image, dx, dy, dw, dh);
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth || document.documentElement.clientWidth || 1;
      h = window.innerHeight || document.documentElement.clientHeight || 1;
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderTexture();
      createTiles();
    }

    function drawFullBlock() {
      ctx.clearRect(0, 0, w, h);
      if (textureReady) ctx.drawImage(textureCanvas, 0, 0, w, h);
      else {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
      }
    }

    function tileCenter(tile) {
      return {
        cx: tile.x + TILE_SIZE / 2,
        cy: tile.y + TILE_SIZE / 2
      };
    }

    function releaseTile(tile, now) {
      tile.released = true;
      tile.filled = false;

      var rand = seededRandom(seed + Math.round(tile.x * 13 + tile.y * 17));
      var center = tileCenter(tile);
      var fromCenterX = center.cx - w / 2;
      var fromCenterY = center.cy - h / 2;
      var baseAngle = Math.atan2(fromCenterY, fromCenterX);
      var angle = baseAngle + (-0.85 + rand() * 1.7);
      var speed = 0.55 + rand() * 1.9;
      var size = TILE_SIZE + rand() * 7;

      particles.push({
        x: center.cx,
        y: center.cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        sx: tile.x,
        sy: tile.y,
        sw: TILE_SIZE + 1,
        sh: TILE_SIZE + 1,
        size: size,
        rotation: rand() * Math.PI,
        spin: -0.055 + rand() * 0.11,
        born: now,
        life: PARTICLE_LIFE * (0.72 + rand() * 0.5),
        alpha: 0.75 + rand() * 0.25,
        wobble: rand() * 100
      });
    }

    function launchTile(tile, now) {
      tile.filling = true;

      /*
        Sortie renforcée : la case devient visible dès son lancement.
        Les particules gardent le mouvement organique, mais la page se remplit
        clairement avant le changement d'URL.
      */
      if (mode === 'exiting') tile.filled = true;

      var rand = seededRandom(seed + Math.round(tile.x * 13 + tile.y * 17));
      var center = tileCenter(tile);
      var fromCenterX = center.cx - w / 2;
      var fromCenterY = center.cy - h / 2;
      var baseAngle = Math.atan2(fromCenterY, fromCenterX);
      var angle = baseAngle + (-0.85 + rand() * 1.7);
      var speed = 0.55 + rand() * 1.9;
      var size = TILE_SIZE + rand() * 7;
      var life = PARTICLE_LIFE * (0.72 + rand() * 0.5);
      var travelDistance = speed * (life / 16.67) * 2.05 + 40;

      particles.push({
        tile: tile,
        startX: center.cx + Math.cos(angle) * travelDistance,
        startY: center.cy + Math.sin(angle) * travelDistance,
        endX: center.cx,
        endY: center.cy,
        sx: tile.x,
        sy: tile.y,
        sw: TILE_SIZE + 1,
        sh: TILE_SIZE + 1,
        size: size,
        rotation: rand() * Math.PI,
        spin: -0.055 + rand() * 0.11,
        born: now,
        life: life,
        alpha: 0.75 + rand() * 0.25,
        wobble: rand() * 100
      });
    }

    function drawTiles() {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;

      for (var i = 0; i < tiles.length; i += 1) {
        var tile = tiles[i];
        var shouldDraw = mode === 'entering' ? !tile.released : tile.filled;
        if (!shouldDraw) continue;

        if (textureReady) {
          ctx.drawImage(textureCanvas, tile.x, tile.y, TILE_SIZE + 1, TILE_SIZE + 1, tile.x, tile.y, TILE_SIZE + 1, TILE_SIZE + 1);
        } else {
          ctx.fillRect(tile.x, tile.y, TILE_SIZE + 1, TILE_SIZE + 1);
        }
      }

      ctx.restore();
    }

    function drawParticles(now) {
      for (var i = particles.length - 1; i >= 0; i -= 1) {
        var p = particles[i];
        var age = now - p.born;
        var lifeProgress = clamp01(age / p.life);

        if (lifeProgress >= 1) {
          if (mode === 'exiting' && p.tile) p.tile.filled = true;
          particles.splice(i, 1);
          continue;
        }

        p.wobble += 0.09;
        p.rotation += p.spin;

        ctx.save();
        ctx.fillStyle = color;

        if (mode === 'entering') {
          var drift = easeOutCubic(lifeProgress);
          p.x += p.vx * (1 + drift * 1.6) + Math.cos(p.wobble) * 0.55;
          p.y += p.vy * (1 + drift * 1.6) + Math.sin(p.wobble) * 0.55;
          ctx.globalAlpha = p.alpha * (1 - easeInOutCubic(lifeProgress));
          ctx.translate(p.x, p.y);
        } else {
          var arrival = easeInOutCubic(lifeProgress);
          var wobbleAmount = 0.55 * (1 - easeOutCubic(lifeProgress));
          var x = lerp(p.startX, p.endX, arrival) + Math.cos(p.wobble) * wobbleAmount;
          var y = lerp(p.startY, p.endY, arrival) + Math.sin(p.wobble) * wobbleAmount;
          ctx.globalAlpha = p.alpha * easeInOutCubic(lifeProgress);
          ctx.translate(x, y);
        }

        ctx.rotate(p.rotation);
        if (textureReady) {
          ctx.drawImage(textureCanvas, p.sx, p.sy, p.sw, p.sh, -p.size / 2, -p.size / 2, p.size, p.size);
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function render(now) {
      if (destroyed) return;
      if (!startTime) startTime = now;

      var elapsed = now - startTime;
      var rawProgress = clamp01((elapsed - HOLD_DURATION) / FLOW_DURATION);
      var flowProgress = easeInOutCubic(rawProgress);
      var targetCount = Math.floor(flowProgress * tiles.length);

      ctx.clearRect(0, 0, w, h);

      while (cursor < targetCount) {
        if (mode === 'entering') releaseTile(tiles[cursor], now);
        else launchTile(tiles[cursor], now);
        cursor += 1;
      }

      drawTiles();
      drawParticles(now);

      if (elapsed >= TOTAL_DURATION && particles.length === 0) {
        if (mode === 'exiting') {
          drawFullBlock();
        } else {
          removeOverlay();
        }
        return;
      }

      raf = requestAnimationFrame(render);
    }

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resize();
        if (mode === 'entering') drawFullBlock();
      }, 160);
    }

    resize();

    var splash = ensureSplashImage();
    if (splash && !splashImageReady) {
      splash.addEventListener('load', function handleSplashLoad() {
        renderTexture();
        if (mode === 'entering' || (mode === 'exiting' && cursor >= tiles.length)) {
          drawFullBlock();
        }
        splash.removeEventListener('load', handleSplashLoad);
      });
    }

    if (mode === 'entering') {
      drawFullBlock();
    }
    window.addEventListener('resize', onResize, { passive: true });
    raf = requestAnimationFrame(render);

    return {
      destroy: function () {
        destroyed = true;
        cancelAnimationFrame(raf);
        clearTimeout(resizeTimer);
        window.removeEventListener('resize', onResize);
      },
      drawFullBlock: drawFullBlock
    };
  }

  function normalizePath(pathname) {
    if (pathname === '/index.html') return '/';
    return pathname.replace(/\/index\.html$/i, '/');
  }

  function shouldSkipUrl(url, event) {
    if (!url || transitionRunning || (prefersReduced && prefersReduced.matches)) return true;
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return true;
    if (url.origin !== window.location.origin) return true;

    var samePath = normalizePath(url.pathname) === normalizePath(window.location.pathname) && url.search === window.location.search;
    if (samePath) return true;

    var lastPart = url.pathname.split('/').pop() || '';
    if (/\.[a-z0-9]+$/i.test(lastPart) && !/\.html?$/i.test(lastPart)) return true;

    return false;
  }

  function shouldSkipLink(link, event) {
    if (!link) return true;
    if (link.target && link.target !== '_self') return true;
    if (link.hasAttribute('download')) return true;
    if (link.dataset && link.dataset.noTransition === 'true') return true;

    var href = link.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return true;

    var url;
    try {
      url = new URL(link.href, window.location.href);
    } catch (_) {
      return true;
    }

    return shouldSkipUrl(url, event);
  }

  function startExitTransition(href, eventTarget) {
    if (transitionRunning) return;
    if (!document.body) {
      window.location.href = href;
      return;
    }

    transitionRunning = true;
    injectTransitionStyles();
    document.documentElement.classList.add('vpl-route-transitioning');

    var rect = eventTarget && eventTarget.getBoundingClientRect ? eventTarget.getBoundingClientRect() : null;
    var originX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    var originY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    var seed = nowSeed();

    storeTransitionState(originX, originY, seed);
    warmPage(href);

    whenSplashReady(function () {
      if (!transitionRunning) return;
      controller = buildCanvasTransition({ mode: 'exiting', originX: originX, originY: originY, seed: seed });

      window.setTimeout(function () {
        window.location.href = href;
      }, TOTAL_DURATION + 80);
    });
  }

  function startEnterTransition() {
    if (!document.body) return;
    var storedOrigin = readTransitionOrigin();
    var originX = storedOrigin && Number.isFinite(storedOrigin.originX) ? storedOrigin.originX : window.innerWidth / 2;
    var originY = storedOrigin && Number.isFinite(storedOrigin.originY) ? storedOrigin.originY : window.innerHeight / 2;
    var seed = readTransitionSeed();

    transitionRunning = true;
    injectTransitionStyles();
    document.documentElement.classList.add('vpl-route-transitioning');
    clearTransitionStorage();

    whenSplashReady(function () {
      if (!transitionRunning) return;
      controller = buildCanvasTransition({ mode: 'entering', originX: originX, originY: originY, seed: seed });

      requestAnimationFrame(function () {
        setTimeout(releasePreloadMask, 34);
      });

      window.setTimeout(removeOverlay, TOTAL_DURATION + 180);
    });
  }

  function initPageTransition() {
    ensureSplashImage();
    injectTransitionStyles();

    if (hasIncomingTransition() && !(prefersReduced && prefersReduced.matches)) {
      startEnterTransition();
    } else {
      clearTransitionStorage();
      releasePreloadMask();
    }

    document.addEventListener('pointerover', function (event) {
      var target = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
      var link = target && target.closest && target.closest('a[href]');
      if (!link || link.hasAttribute(PREFETCH_ATTR) || shouldSkipLink(link, null)) return;
      link.setAttribute(PREFETCH_ATTR, 'true');
      warmPage(link.href);
    }, { passive: true });

    document.addEventListener('focusin', function (event) {
      var target = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
      var link = target && target.closest && target.closest('a[href]');
      if (!link || link.hasAttribute(PREFETCH_ATTR) || shouldSkipLink(link, null)) return;
      link.setAttribute(PREFETCH_ATTR, 'true');
      warmPage(link.href);
    });

    document.addEventListener('click', function (event) {
      var target = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
      var link = target && target.closest && target.closest('a[href]');
      if (shouldSkipLink(link, event)) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      startExitTransition(link.href, link);
    }, true);
  }

  function navigateWithTransition(href) {
    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (_) {
      window.location.href = href;
      return;
    }

    if (shouldSkipUrl(url, null)) {
      window.location.href = href;
      return;
    }

    startExitTransition(url.href, null);
  }

  window.VitalPageTransition = {
    go: navigateWithTransition,
    remove: removeOverlay
  };
  window.vplNavigate = navigateWithTransition;

  prepareIncomingMask();

  window.addEventListener('pageshow', function (event) {
    if (event.persisted) removeOverlay();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageTransition, { once: true });
  } else {
    initPageTransition();
  }
})();
