/**
 * glass3d.js (v2) — Liquid Crystal Interface Effects
 * Exposed as: window.GlassFX2  (also aliased as window.GlassFX)
 *
 * ── Layer 1: IRIDESCENT CANVAS BACKGROUND ─────────────────────
 *   Canvas 2D draws slowly drifting spectrum orbs.
 *   Hue rotates continuously → rainbow oil-slick effect.
 *   Mouse disturbs the orb field — orbs lean away from cursor.
 *
 * ── Layer 2: CHROMATIC ABERRATION on hero name ────────────────
 *   Clones the name text in red and blue, offset ±px.
 *   Both layers animate opposite phases → breathing split.
 *   Intensity increases on scroll (approaching distortion).
 *
 * ── Layer 3: SVG DISPLACEMENT / REFRACTION on cards ──────────
 *   Injects SVG <feDisplacementMap> filter into DOM.
 *   On card hover: a .gl-refract div applies the filter
 *   making the background behind the card appear warped.
 *
 * ── Layer 4: IRIDESCENT SHIMMER on cards ─────────────────────
 *   Mouse position inside card drives conic-gradient angle.
 *   .gl-iris overlay rotates to match → mother-of-pearl effect.
 *
 * ── Layer 5: PRISM CURSOR with spectrum trail ─────────────────
 *   Cursor = rotating prism shape (diamond SVG).
 *   Trail = 6 colored dots (ROYGBV) with increasing lag.
 *   Each trail dot has its own color from spectrum.
 *
 * ── Layer 6: DEPTH LAYERS on cards ───────────────────────────
 *   Cards assigned depth-1, depth-2, depth-3 in sequence.
 *   Spring tilt physics (same as Liquid/Noir themes).
 *
 * ── Layer 7: CRYSTAL REVEAL ──────────────────────────────────
 *   Cards materialize with scale(0.94) + blur(8px) → clear.
 *   Skills pop in with spring scale bounce.
 */

(function () {
  'use strict';

  let _active    = false;
  let _timeouts  = [];
  let _listeners = [];
  let _observers = [];

  const SPECTRUM = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6'];
  const VIOLET   = '#8b5cf6';
  const CYAN     = '#06b6d4';

  function _t(fn, ms)  { const id = setTimeout(fn, ms); _timeouts.push(id); }
  function _on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    _listeners.push({ el, ev, fn });
  }

  /* ════════════════════════════════════════════════════════
     LAYER 1 — IRIDESCENT CANVAS BACKGROUND
  ════════════════════════════════════════════════════════ */

  let _canvas, _ctx;
  let _frameId;
  let _hue = 0;
  let _mouseX = 0, _mouseY = 0;
  let _orbs = [];
  let _time  = 0;

  function initCanvas() {
    _canvas = document.createElement('canvas');
    _canvas.id = 'gl-canvas';
    _canvas.style.cssText = `
      position:fixed; inset:0;
      width:100%; height:100%;
      z-index:0; pointer-events:none;
    `;
    document.body.insertBefore(_canvas, document.body.firstChild);
    _ctx = _canvas.getContext('2d');
    resizeCanvas();

    /* Create orbs with hue-distributed colors */
    _orbs = Array.from({ length: 6 }, (_, i) => ({
      x: Math.random() * _canvas.width,
      y: Math.random() * _canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: 200 + Math.random() * 300,
      hue: (i * 60) + Math.random() * 30,
      opacity: 0.10 + Math.random() * 0.08,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0003 + Math.random() * 0.0004,
    }));

    renderCanvas();
  }

  function resizeCanvas() {
    if (!_canvas) return;
    _canvas.width  = window.innerWidth;
    _canvas.height = window.innerHeight;
  }

  function renderCanvas() {
    if (!_active || !_ctx) return;
    _frameId = requestAnimationFrame(renderCanvas);
    _time += 0.008;
    _hue  = (_hue + 0.03) % 360;

    const W = _canvas.width, H = _canvas.height;
    _ctx.clearRect(0, 0, W, H);

    /* Base void */
    _ctx.fillStyle = '#04040e';
    _ctx.fillRect(0, 0, W, H);

    _orbs.forEach(orb => {
      /* Drift */
      orb.x += orb.vx + Math.sin(_time * orb.speed * 1000 + orb.phase) * 0.3;
      orb.y += orb.vy + Math.cos(_time * orb.speed * 800  + orb.phase) * 0.2;

      /* Soft boundary bounce */
      if (orb.x < -orb.r) orb.x = W + orb.r;
      if (orb.x > W + orb.r) orb.x = -orb.r;
      if (orb.y < -orb.r) orb.y = H + orb.r;
      if (orb.y > H + orb.r) orb.y = -orb.r;

      /* Repel from cursor */
      const dx = orb.x - _mouseX, dy = orb.y - _mouseY;
      const dist = Math.hypot(dx, dy);
      if (dist < 300) {
        const force = (300 - dist) / 300 * 0.6;
        orb.x += (dx / dist) * force;
        orb.y += (dy / dist) * force;
      }

      /* Hue shift over time */
      const currentHue = (orb.hue + _hue) % 360;
      const r = _ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
      r.addColorStop(0, `hsla(${currentHue},80%,55%,${orb.opacity})`);
      r.addColorStop(0.5, `hsla(${(currentHue+30)%360},70%,45%,${orb.opacity * 0.4})`);
      r.addColorStop(1, 'rgba(0,0,0,0)');

      _ctx.beginPath();
      _ctx.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
      _ctx.fillStyle = r;
      _ctx.fill();
    });

    /* Subtle iridescent noise overlay */
    const noiseA = 0.012 + Math.sin(_time * 0.5) * 0.006;
    _ctx.fillStyle = `rgba(139,92,246,${noiseA})`;
    _ctx.fillRect(0, 0, W, H);
  }

  /* ════════════════════════════════════════════════════════
     LAYER 2 — CHROMATIC ABERRATION on hero name
  ════════════════════════════════════════════════════════ */

  function initChromaticAberration() {
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (!nameEl || nameEl.dataset.glCA) return;
    nameEl.dataset.glCA = '1';

    const text = nameEl.textContent.trim();
    nameEl.style.position = 'relative';

    /* Red layer */
    const red = document.createElement('span');
    red.className = 'gl-ca-r';
    red.setAttribute('aria-hidden', 'true');
    red.textContent = text;
    /* Copy font styles */
    red.style.cssText = `
      position:absolute; top:0; left:0;
      font-size:inherit; font-weight:inherit;
      letter-spacing:inherit; line-height:inherit;
      text-transform:inherit; font-family:inherit;
      color:rgba(255,80,80,0.40);
      mix-blend-mode:screen;
      pointer-events:none; user-select:none;
      animation:gl-ca-r 4s ease-in-out infinite;
    `;

    /* Blue layer */
    const blue = document.createElement('span');
    blue.className = 'gl-ca-b';
    blue.setAttribute('aria-hidden', 'true');
    blue.textContent = text;
    blue.style.cssText = `
      position:absolute; top:0; left:0;
      font-size:inherit; font-weight:inherit;
      letter-spacing:inherit; line-height:inherit;
      text-transform:inherit; font-family:inherit;
      color:rgba(80,150,255,0.40);
      mix-blend-mode:screen;
      pointer-events:none; user-select:none;
      animation:gl-ca-b 4s ease-in-out infinite;
    `;

    if (!document.getElementById('gl-ca-style')) {
      const s = document.createElement('style');
      s.id = 'gl-ca-style';
      s.textContent = `
        @keyframes gl-ca-r {
          0%,100%{transform:translate(0,0)}
          25%{transform:translate(2.5px,0)}
          75%{transform:translate(-2px,0.5px)}
        }
        @keyframes gl-ca-b {
          0%,100%{transform:translate(0,0)}
          25%{transform:translate(-2.5px,0)}
          75%{transform:translate(2px,-0.5px)}
        }
      `;
      document.head.appendChild(s);
    }

    /* Insert behind main text */
    nameEl.insertBefore(red,  nameEl.firstChild);
    nameEl.insertBefore(blue, nameEl.firstChild);
  }

  /* ════════════════════════════════════════════════════════
     LAYER 3 — SVG REFRACTION FILTER
  ════════════════════════════════════════════════════════ */

  function initRefractionFilter() {
    if (document.getElementById('gl-filters')) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'gl-filters';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    svg.innerHTML = `
      <defs>
        <filter id="gl-displace" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.65 0.65"
            numOctaves="3" seed="2" result="noise"/>
          <feDisplacementMap in="SourceGraphic" in2="noise"
            scale="12" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
      </defs>
    `;
    document.body.appendChild(svg);

    /* Add .gl-refract and .gl-iris to each card */
    document.querySelectorAll('.project-card').forEach(card => {
      if (card.querySelector('.gl-refract')) return;

      const refract = document.createElement('div');
      refract.className = 'gl-refract';
      card.insertBefore(refract, card.firstChild);

      const iris = document.createElement('div');
      iris.className = 'gl-iris';
      card.insertBefore(iris, card.firstChild);
    });
  }

  /* ════════════════════════════════════════════════════════
     LAYER 4 — IRIDESCENT SHIMMER (mouse → conic angle)
  ════════════════════════════════════════════════════════ */

  function applyIridescentShimmer(card) {
    if (card.dataset.glIris) return;
    card.dataset.glIris = '1';

    const iris = card.querySelector('.gl-iris');
    if (!iris) return;

    function onMove(e) {
      if (!_active) return;
      const r   = card.getBoundingClientRect();
      const cx  = ((e.clientX - r.left) / r.width)  * 100;
      const cy  = ((e.clientY - r.top)  / r.height) * 100;
      const dx  = e.clientX - (r.left + r.width  / 2);
      const dy  = e.clientY - (r.top  + r.height / 2);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 180;

      iris.style.setProperty('--gl-angle', angle + 'deg');
      iris.style.setProperty('--gl-cx',    cx + '%');
      iris.style.setProperty('--gl-cy',    cy + '%');
    }

    card.addEventListener('mousemove',  onMove);
    _listeners.push({ el: card, ev: 'mousemove', fn: onMove });
  }

  function initIridescentShimmer() {
    document.querySelectorAll('.project-card').forEach(applyIridescentShimmer);
  }

  /* ════════════════════════════════════════════════════════
     LAYER 5 — PRISM CURSOR + SPECTRUM TRAIL
  ════════════════════════════════════════════════════════ */

  function initCursor() {
    if (window.matchMedia('(pointer: coarse)').matches) return;

    /* Diamond prism */
    const prism = document.createElement('div');
    prism.id = 'gl-prism';
    prism.style.cssText = `
      position:fixed; pointer-events:none; z-index:99999;
      width:16px; height:16px;
      transform:translate(-50%,-50%) rotate(45deg);
      opacity:0; transition:opacity .15s, width .2s, height .2s;
      mix-blend-mode:screen;
    `;
    prism.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <polygon points="8,0 16,8 8,16 0,8"
          fill="rgba(255,255,255,0.12)"
          stroke="rgba(255,255,255,0.7)" stroke-width="0.8"/>
        <polygon points="8,0 16,8 8,16 0,8"
          fill="none" stroke="rgba(139,92,246,0.5)" stroke-width="0.5"
          stroke-dasharray="2 2"/>
      </svg>
    `;

    /* Spectrum trail — 6 dots */
    const trail = SPECTRUM.map((color, i) => {
      const dot = document.createElement('div');
      dot.style.cssText = `
        position:fixed; pointer-events:none;
        z-index:${99998 - i};
        width:${6 - i * 0.6}px; height:${6 - i * 0.6}px;
        border-radius:50%;
        background:${color};
        box-shadow:0 0 ${8 - i}px ${color};
        transform:translate(-50%,-50%);
        opacity:0; mix-blend-mode:screen;
        transition:opacity .15s;
      `;
      document.body.appendChild(dot);
      return { el: dot, x: 0, y: 0, lag: 0.08 - i * 0.012 };
    });

    document.body.appendChild(prism);
    document.body.classList.add('gl-cursor-active');

    let mx = 0, my = 0;
    let px = 0, py = 0;
    let angle = 0;

    _on(document, 'mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      prism.style.left = mx + 'px';
      prism.style.top  = my + 'px';
      prism.style.opacity = '1';
      trail.forEach(t => t.el.style.opacity = '1');
    }, { passive: true });

    _on(document, 'mouseleave', () => {
      prism.style.opacity = '0';
      trail.forEach(t => t.el.style.opacity = '0');
    });

    _on(document, 'mouseover', (e) => {
      const isI = e.target.matches('button,a,.project-card,.skill-tag,[contenteditable]');
      prism.style.width  = isI ? '24px' : '16px';
      prism.style.height = isI ? '24px' : '16px';
    });

    /* Smooth prism rotation + trail follow */
    (function loop() {
      if (!_active) return;
      requestAnimationFrame(loop);

      px += (mx - px) * 0.14;
      py += (my - py) * 0.14;

      angle += 0.8;
      prism.style.transform = `translate(-50%,-50%) rotate(${45 + angle}deg)`;

      /* Each trail dot follows the previous */
      let prevX = mx, prevY = my;
      trail.forEach(t => {
        t.x += (prevX - t.x) * t.lag;
        t.y += (prevY - t.y) * t.lag;
        t.el.style.left = t.x + 'px';
        t.el.style.top  = t.y + 'px';
        prevX = t.x; prevY = t.y;
      });
    })();
  }

  /* ════════════════════════════════════════════════════════
     LAYER 6 — DEPTH + SPRING TILT
  ════════════════════════════════════════════════════════ */

  const DEPTHS = ['gl-depth-1','gl-depth-2','gl-depth-3'];
  const _cardSprings = new WeakMap();

  function applyDepthAndTilt(card, idx) {
    /* Depth class */
    if (!card.dataset.glDepth) {
      const depthClass = DEPTHS[idx % DEPTHS.length];
      card.classList.add(depthClass);
      card.dataset.glDepth = depthClass;
    }

    /* Spring tilt */
    if (_cardSprings.has(card)) return;
    const sp = { x:0, y:0, vx:0, vy:0, tx:0, ty:0 };
    _cardSprings.set(card, sp);

    function onMove(e) {
      if (!_active) return;
      const r  = card.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width/2)  / (r.width/2);
      const dy = (e.clientY - r.top  - r.height/2) / (r.height/2);
      sp.tx = dy * 9;
      sp.ty = -dx * 9;

      /* Cursor glow position */
      const mx = ((e.clientX - r.left) / r.width)  * 100;
      const my = ((e.clientY - r.top)  / r.height) * 100;
      card.style.setProperty('--lq-mx', mx + '%');
      card.style.setProperty('--lq-my', my + '%');
    }

    function onLeave() { sp.tx = 0; sp.ty = 0; }

    card.addEventListener('mousemove',  onMove);
    card.addEventListener('mouseleave', onLeave);
    _listeners.push({ el:card, ev:'mousemove',  fn:onMove  });
    _listeners.push({ el:card, ev:'mouseleave', fn:onLeave });
  }

  function initDepthCards() {
    document.querySelectorAll('.project-card').forEach((card, i) => applyDepthAndTilt(card, i));
  }

  function runCardPhysics() {
    if (!_active) return;
    requestAnimationFrame(runCardPhysics);

    document.querySelectorAll('.project-card').forEach(card => {
      const sp = _cardSprings.get(card);
      if (!sp) return;

      const ax = (sp.tx - sp.x) * 0.13;
      const ay = (sp.ty - sp.y) * 0.13;
      sp.vx = (sp.vx + ax) * 0.70;
      sp.vy = (sp.vy + ay) * 0.70;
      sp.x += sp.vx;
      sp.y += sp.vy;

      const dist = Math.hypot(sp.x, sp.y);
      if (dist < 0.02) {
        /* Restore depth transform when not tilted */
        const depthClass = card.dataset.glDepth || 'gl-depth-1';
        const depthTransforms = { 'gl-depth-1':'', 'gl-depth-2':'translateZ(8px) scale(1.01)', 'gl-depth-3':'translateZ(16px) scale(1.02)' };
        card.style.transform  = depthTransforms[depthClass];
        card.style.boxShadow  = '';
        card.style.transition = '';
        return;
      }

      card.style.transition = 'none';
      card.style.transform  =
        `perspective(900px) rotateX(${sp.x}deg) rotateY(${sp.y}deg) translateZ(${10 + dist * 0.5}px)`;
      card.style.boxShadow  =
        `${-sp.y * 2}px ${-sp.x * 2}px 50px rgba(0,0,0,0.65),
         0 0 ${40 + dist * 2}px rgba(139,92,246,${dist * 0.015})`;
    });
  }

  /* ════════════════════════════════════════════════════════
     LAYER 7 — CRYSTAL REVEAL
  ════════════════════════════════════════════════════════ */

  function initReveal() {
    const style = document.createElement('style');
    style.id = 'gl-reveal-style';
    style.textContent = `
      [data-theme="glass3d"] .project-card,
      .theme-glass3d .project-card {
        opacity:0;
        transform:scale(0.93);
        filter:blur(6px);
        transition:opacity .7s ease, transform .7s cubic-bezier(.16,1,.3,1), filter .7s ease;
      }
      [data-theme="glass3d"] .project-card.gl-revealed,
      .theme-glass3d .project-card.gl-revealed {
        opacity:1; transform:scale(1); filter:blur(0);
      }
      [data-theme="glass3d"] .section-label,
      .theme-glass3d .section-label {
        opacity:0; transform:translateY(10px);
        transition:opacity .5s ease, transform .5s cubic-bezier(.16,1,.3,1);
      }
      [data-theme="glass3d"] .section-label.gl-revealed,
      .theme-glass3d .section-label.gl-revealed {
        opacity:1; transform:translateY(0);
      }
      [data-theme="glass3d"] .skill-tag:not(.skill-tag--add),
      .theme-glass3d .skill-tag:not(.skill-tag--add) {
        opacity:0; transform:scale(0.8);
        transition:opacity .4s ease, transform .4s cubic-bezier(.34,1.56,.64,1);
      }
      [data-theme="glass3d"] .skill-tag.gl-revealed,
      .theme-glass3d .skill-tag.gl-revealed {
        opacity:1; transform:scale(1);
      }
    `;
    document.head.appendChild(style);

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el  = entry.target;
        const all = [...document.querySelectorAll('.project-card')];
        const i   = all.indexOf(el);
        const delay = el.classList.contains('project-card') ? (i % 3) * 100 : 0;
        _t(() => el.classList.add('gl-revealed'), delay);
        obs.unobserve(el);
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

    document.querySelectorAll('.project-card, .section-label').forEach(el => obs.observe(el));
    _observers.push(obs);

    const skillObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const tags = [...document.querySelectorAll('.skill-tag:not(.skill-tag--add)')];
        tags.forEach((tag, i) => _t(() => tag.classList.add('gl-revealed'), i * 45));
        skillObs.disconnect();
      });
    }, { threshold: 0.1 });

    const sc = document.querySelector('.skills-container');
    if (sc) skillObs.observe(sc);
    _observers.push(skillObs);
  }

  /* ── Mouse tracking ── */
  function initMouseTracking() {
    _on(window, 'mousemove', (e) => { _mouseX = e.clientX; _mouseY = e.clientY; }, { passive: true });
  }

  /* ── Resize ── */
  let _resizeTimer;
  function initResize() {
    _on(window, 'resize', () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(resizeCanvas, 200);
    });
  }

  /* ── Mutation observer ── */
  function initMutationObserver() {
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (!grid) return;
    const obs = new MutationObserver(() => {
      _t(() => {
        initRefractionFilter();
        initIridescentShimmer();
        initDepthCards();
      }, 80);
    });
    obs.observe(grid, { childList: true });
    _observers.push(obs);
  }

  /* ════════════════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════════════════ */

  function init() {
    if (_active) return;
    _active = true;

    requestAnimationFrame(() => {
      initCanvas();
      initMouseTracking();
      initResize();
      initChromaticAberration();
      initRefractionFilter();
      initIridescentShimmer();
      initDepthCards();
      runCardPhysics();
      initCursor();
      initReveal();
      initMutationObserver();
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    _timeouts.forEach(clearTimeout); _timeouts = [];
    _listeners.forEach(({ el, ev, fn }) => el.removeEventListener(ev, fn));
    _listeners = [];
    _observers.forEach(o => o.disconnect?.()); _observers = [];
    if (_frameId) { cancelAnimationFrame(_frameId); _frameId = null; }
    clearTimeout(_resizeTimer);

    /* DOM */
    document.getElementById('gl-canvas')?.remove();
    document.getElementById('gl-filters')?.remove();
    document.getElementById('gl-prism')?.remove();
    document.getElementById('gl-reveal-style')?.remove();
    document.getElementById('gl-ca-style')?.remove();

    /* Trail dots */
    document.querySelectorAll('div').forEach(el => {
      if (el.style.mixBlendMode === 'screen' && el.style.borderRadius === '50%' && !el.id) el.remove();
    });

    document.body.classList.remove('gl-cursor-active');

    /* Hero CA */
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (nameEl?.dataset?.glCA) {
      nameEl.querySelectorAll('.gl-ca-r, .gl-ca-b').forEach(el => el.remove());
      delete nameEl.dataset.glCA;
    }

    /* Reset cards */
    document.querySelectorAll('.project-card').forEach(card => {
      card.classList.remove('gl-revealed', 'gl-depth-1', 'gl-depth-2', 'gl-depth-3');
      card.querySelectorAll('.gl-refract, .gl-iris').forEach(el => el.remove());
      card.style.transform  = '';
      card.style.boxShadow  = '';
      card.style.transition = '';
      card.style.filter     = '';
      delete card.dataset.glDepth;
      delete card.dataset.glIris;
    });

    /* Reset labels & skills */
    document.querySelectorAll('.section-label, .skill-tag').forEach(el => {
      el.classList.remove('gl-revealed');
      el.style.opacity = '';
      el.style.transform = '';
      el.style.filter  = '';
    });
  }

  window.GlassFX2 = { init, destroy };
  window.GlassFX  = { init, destroy }; /* alias */

})();
