/* Transition inter-pages Vital Protect
   Version stable : fondu plein écran vers l'écran de marque, puis révélation de la page suivante.
   Cette version supprime l'effet de particules / mosaïque qui produisait des carrés noirs visibles
   pendant les changements de page. */
(function () {
  if (window.VitalPageTransition) return;

  var STORAGE_KEY = 'vpl-route-transition-next';
  var ORIGIN_KEY = 'vpl-route-transition-origin';
  var PREFETCH_ATTR = 'data-vpl-prefetched';
  var COLOR = '#2f6f9f';
  var SPLASH_IMAGE = 'transition-screen.png';
  var EXIT_DURATION = 420;
  var ENTER_DURATION = 460;
  var EXIT_HOLD = 110;
  var PRELOAD_RELEASE_DELAY = 50;

  var overlay = null;
  var transitionRunning = false;
  var prefetched = new Set();
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var splashImage = null;

  function getSplashUrl() {
    return new URL(SPLASH_IMAGE, window.location.href).href;
  }

  function ensureSplashImage() {
    if (splashImage) return splashImage;
    splashImage = new Image();
    splashImage.decoding = 'async';
    splashImage.src = getSplashUrl();
    return splashImage;
  }

  function injectTransitionStyles() {
    if (document.getElementById('vpl-page-transition-style')) return;

    var style = document.createElement('style');
    style.id = 'vpl-page-transition-style';
    style.textContent = [
      ':root{--vpl-transition-solid:' + COLOR + ';--vpl-transition-image:url("' + getSplashUrl() + '")}',
      'html.vpl-route-preload-transition,html.vpl-route-preload-transition body{background:' + COLOR + '!important}',
      'html.vpl-route-preload-transition::before{content:"";position:fixed;inset:0;z-index:2147482998;pointer-events:none;background-color:' + COLOR + ';background-image:var(--vpl-transition-image);background-position:center;background-size:cover;background-repeat:no-repeat;opacity:1;transform:translateZ(0);backface-visibility:hidden}',
      'html.vpl-route-preload-transition.vpl-route-preload-releasing::before{animation:vplPreloadFadeOut .22s ease both}',
      'html.vpl-route-transitioning{cursor:progress}',
      'html.vpl-route-transitioning,html.vpl-route-transitioning body{overflow:hidden!important}',
      '.vpl-page-transition{position:fixed!important;inset:0!important;z-index:2147483000!important;pointer-events:none!important;overflow:hidden!important;isolation:isolate!important;contain:layout paint style!important;background:' + COLOR + '!important;opacity:1!important;visibility:visible!important;transform:none!important}',
      '.vpl-page-transition__splash{position:absolute;inset:0;background-color:' + COLOR + ';background-image:var(--vpl-transition-image);background-position:center;background-size:cover;background-repeat:no-repeat;opacity:0;transform:scale(1.012) translateZ(0);backface-visibility:hidden;will-change:opacity,transform}',
      '@keyframes vplPreloadFadeOut{from{opacity:1}to{opacity:0}}',
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
    document.documentElement.classList.add('vpl-route-preload-transition');
  }

  function storeTransitionState(originX, originY) {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
      sessionStorage.setItem(ORIGIN_KEY, JSON.stringify({
        x: Math.max(0, Math.min(1, originX / Math.max(window.innerWidth || 1, 1))),
        y: Math.max(0, Math.min(1, originY / Math.max(window.innerHeight || 1, 1)))
      }));
    } catch (_) {}
  }

  function clearTransitionStorage() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(ORIGIN_KEY);
      sessionStorage.removeItem('vpl-route-transition-seed');
    } catch (_) {}
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

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.documentElement.classList.remove('vpl-route-transitioning');
    transitionRunning = false;
  }

  function createOverlay(visible) {
    injectTransitionStyles();
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.className = 'vpl-page-transition';
    overlay.setAttribute('aria-hidden', 'true');

    var splash = document.createElement('div');
    splash.className = 'vpl-page-transition__splash';
    splash.style.opacity = visible ? '1' : '0';
    splash.style.transform = visible ? 'scale(1) translateZ(0)' : 'scale(1.012) translateZ(0)';

    overlay.appendChild(splash);
    (document.body || document.documentElement).appendChild(overlay);
    return splash;
  }

  function animateSplash(splash, opacity, duration, callback) {
    var targetScale = opacity === 1 ? 'scale(1) translateZ(0)' : 'scale(1.012) translateZ(0)';
    var done = false;

    function finish() {
      if (done) return;
      done = true;
      splash.removeEventListener('transitionend', finish);
      if (callback) callback();
    }

    splash.addEventListener('transitionend', finish);
    window.setTimeout(finish, duration + 80);

    requestAnimationFrame(function () {
      splash.style.transition = 'opacity ' + duration + 'ms ease, transform ' + duration + 'ms ease';
      splash.style.opacity = String(opacity);
      splash.style.transform = targetScale;
    });
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
    ensureSplashImage();
    document.documentElement.classList.add('vpl-route-transitioning');

    var rect = eventTarget && eventTarget.getBoundingClientRect ? eventTarget.getBoundingClientRect() : null;
    var originX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    var originY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

    storeTransitionState(originX, originY);
    warmPage(href);

    var splash = createOverlay(false);
    animateSplash(splash, 1, EXIT_DURATION, function () {
      window.setTimeout(function () {
        window.location.href = href;
      }, EXIT_HOLD);
    });
  }

  function startEnterTransition() {
    if (!document.body) return;

    transitionRunning = true;
    injectTransitionStyles();
    ensureSplashImage();
    document.documentElement.classList.add('vpl-route-transitioning');
    clearTransitionStorage();

    var splash = createOverlay(true);

    requestAnimationFrame(function () {
      window.setTimeout(releasePreloadMask, PRELOAD_RELEASE_DELAY);
      animateSplash(splash, 0, ENTER_DURATION, removeOverlay);
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
