/**
 * space.js (v2) — Stellar Voyage Effects
 * Exposed as: window.SpaceFX2  (also aliased as window.SpaceFX)
 *
 * ── Layer 1: STARFIELD (3 parallax canvases) ──────────────────
 *   FAR   — 800 tiny stars, parallax 0.04x scroll
 *   MID   — 400 medium stars, parallax 0.10x scroll
 *   NEAR  — 150 bright stars, parallax 0.22x scroll
 *   Each star has: x,y,size,brightness,color,twinklePhase
 *
 * ── Layer 2: NEBULA CANVAS ────────────────────────────────────
 *   Soft radial blobs painted on canvas, slow drift animation
 *   Colors: Orion orange, Pillars blue, Crab violet, Eta gold
 *
 * ── Layer 3: WARP SPEED ───────────────────────────────────────
 *   On scroll: stars become streaks proportional to scroll velocity
 *   Each star streak = line from center, length = velocity
 *   Duration of warp effect: lingers 600ms after scroll stops
 *
 * ── Layer 4: HUD (HTML) ───────────────────────────────────────
 *   Mission control bar: coordinates, signal, mission name
 *   Live velocity readout during warp
 *
 * ── Layer 5: TARGETING RETICLE CURSOR ────────────────────────
 *   SVG reticle that rotates slowly
 *   Distance readout shows px from center of viewport
 *   Expands on interactive elements
 *
 * ── Layer 6: CARD HOLOGRAPHIC TILT ───────────────────────────
 *   Spring-based tilt toward cursor
 *   Chromatic aberration shifts inside card on tilt
 *
 * ── Layer 7: COORDINATE ANNOTATIONS ─────────────────────────
 *   Hero: RA/Dec coordinates flanking the name
 *   Cards: object classification labels (REPO-001 etc.)
 *
 * ── Layer 8: REVEAL ANIMATIONS ───────────────────────────────
 *   Cards materialize from void with scale + fade
 */

(function () {
  'use strict';

  let _active    = false;
  let _timeouts  = [];
  let _listeners = [];
  let _observers = [];

  const VOID    = '#000008';
  const BLUE    = '#4fc3f7';
  const GOLD    = '#fff176';
  const VIOLET  = '#ce93d8';
  const ORION   = '#ff6b35';
  const WHITE   = '#e8f4ff';

  function _t(fn, ms)  { const id = setTimeout(fn, ms); _timeouts.push(id); }
  function _on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    _listeners.push({ el, ev, fn });
  }
  function _isActive() {
    return document.body.getAttribute('data-theme') === 'space'
        || document.documentElement.getAttribute('data-theme') === 'space';
  }

  /* ════════════════════════════════════════════════════════
     LAYER 1 + 2: STARFIELD + NEBULA
  ════════════════════════════════════════════════════════ */

  let _farCanvas, _midCanvas, _nearCanvas, _nebulaCanvas;
  let _farCtx, _midCtx, _nearCtx, _nebulaCtx;
  let _farStars = [], _midStars = [], _nearStars = [];
  // _scrollY / warp state removed — starfield is scroll-independent
  let _frameId   = null;
  let _mouseX = 0, _mouseY = 0;
  let _time = 0;

  /* Nebula blobs */
  const NEBULAE = [
    { x:.15, y:.20, r:.30, color:[255,107,53],   opacity:.18, phase:0,    speed:.0004 },
    { x:.78, y:.65, r:.28, color:[79,195,247],    opacity:.16, phase:2.1,  speed:.0003 },
    { x:.45, y:.80, r:.25, color:[206,147,216],   opacity:.14, phase:4.2,  speed:.0005 },
    { x:.85, y:.20, r:.22, color:[255,241,118],   opacity:.12, phase:1.5,  speed:.0003 },
    { x:.30, y:.50, r:.20, color:[79,195,247],    opacity:.10, phase:3.3,  speed:.0004 },
  ];

  const STAR_COLORS = [
    WHITE, WHITE, WHITE, WHITE, WHITE,  /* mostly white */
    '#ffd0b0', '#d0e8ff', '#ffe0a0',    /* warm / cool / gold */
    BLUE, VIOLET, GOLD,
  ];

  function _makeStars(count, minSize, maxSize, extra) {
    const W = window.innerWidth, H = window.innerHeight;
    return Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      size: minSize + Math.random() * (maxSize - minSize),
      brightness: 0.4 + Math.random() * 0.6,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.4 + Math.random() * 1.2,
      shimmerAmp:   Math.random() < 0.15 ? 0.3 + Math.random() * 0.4 : 0, /* 15% of stars flash */
      shimmerOffset: Math.random() * Math.PI * 2,
      ...(extra || {}),
    }));
  }

  function _makeCanvas(id) {
    const c = document.createElement('canvas');
    c.id = id;
    c.className = 'sp-layer';
    c.width  = window.innerWidth;
    c.height = window.innerHeight;
    document.body.insertBefore(c, document.body.firstChild);
    return c;
  }

  function initStarfield() {
    _nebulaCanvas = _makeCanvas('sp-nebula');
    _farCanvas    = _makeCanvas('sp-stars-far');
    _midCanvas    = _makeCanvas('sp-stars-mid');
    _nearCanvas   = _makeCanvas('sp-stars-near');
    // _warpCanvas removed — no more scroll-streak effect

    _nebulaCtx = _nebulaCanvas.getContext('2d');
    _farCtx    = _farCanvas.getContext('2d');
    _midCtx    = _midCanvas.getContext('2d');
    _nearCtx   = _nearCanvas.getContext('2d');

    // More stars for a richer idle field
    _farStars  = _makeStars(1100, 0.3, 0.9);
    _midStars  = _makeStars(500,  0.6, 1.4);
    _nearStars = _makeStars(180,  1.0, 2.5, { hasCross: true });

    // Randomise twinkle phase so stars don't all pulse in sync
    [..._farStars, ..._midStars, ..._nearStars].forEach(s => {
      s.twinklePhase = Math.random() * Math.PI * 2;
    });

    startRenderLoop();
  }

  /* ── RENDER LOOP ── */
  function startRenderLoop() {
    _time = 0;
    (function loop() {
      if (!_active) return;
      _frameId = requestAnimationFrame(loop);
      _time += 0.016;

      // No scroll-velocity or warp effect — stars twinkle independently of scroll
      drawNebula();
      drawStarLayer(_farCtx,  _farCanvas,  _farStars,  0, 0.04);
      drawStarLayer(_midCtx,  _midCanvas,  _midStars,  0, 0.10);
      drawStarLayer(_nearCtx, _nearCanvas, _nearStars, 0, 0.22);
    })();
  }

  /* ── NEBULA ── */
  function drawNebula() {
    const W = _nebulaCanvas.width, H = _nebulaCanvas.height;
    _nebulaCtx.clearRect(0, 0, W, H);

    NEBULAE.forEach(n => {
      n.phase += n.speed;
      const px = W * n.x + Math.sin(n.phase) * W * 0.04;
      const py = H * n.y + Math.cos(n.phase * 0.7) * H * 0.04;
      const r  = Math.min(W, H) * n.r;

      const g = _nebulaCtx.createRadialGradient(px, py, 0, px, py, r);
      const [cr,cg,cb] = n.color;
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${n.opacity})`);
      g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${n.opacity * 0.4})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');

      _nebulaCtx.beginPath();
      _nebulaCtx.arc(px, py, r, 0, Math.PI * 2);
      _nebulaCtx.fillStyle = g;
      _nebulaCtx.fill();
    });
  }

  /* ── STAR LAYER ── */
  function drawStarLayer(ctx, canvas, stars, offsetY, parallaxRatio) {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    stars.forEach(s => {
      /* Multi-frequency twinkle: base + fast shimmer for occasional flashes */
      s.twinklePhase += s.twinkleSpeed * 0.016;
      const base    = 0.55 + 0.45 * Math.sin(s.twinklePhase);
      const shimmer = s.shimmerAmp * Math.max(0, Math.sin(s.twinklePhase * 3.7 + s.shimmerOffset));
      const twinkle = Math.min(1, base + shimmer);
      const alpha   = s.brightness * twinkle;

      /* Position — no scroll offset, static starfield */
      const y = s.y;

      /* Mouse parallax — subtle depth effect retained */
      const mx = (_mouseX - W/2) * parallaxRatio * 0.015;
      const x  = s.x + mx;

      ctx.globalAlpha = alpha;
      ctx.fillStyle   = s.color;
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, Math.PI * 2);
      ctx.fill();

      /* Glow halo when a star is at peak brightness */
      if (alpha > 0.85) {
        ctx.globalAlpha = (alpha - 0.85) * 0.6;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, s.size * 3.5);
        grad.addColorStop(0, s.color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, s.size * 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      /* Cross flare for bright near-stars */
      if (s.hasCross && s.size > 1.5 && alpha > 0.7) {
        ctx.globalAlpha = alpha * 0.35;
        const len = s.size * 4;
        ctx.strokeStyle = s.color;
        ctx.lineWidth   = 0.5;
        ctx.beginPath();
        ctx.moveTo(x - len, y); ctx.lineTo(x + len, y);
        ctx.moveTo(x, y - len); ctx.lineTo(x, y + len);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  }


  /* ════════════════════════════════════════════════════════
     LAYER 4: HUD BAR
  ════════════════════════════════════════════════════════ */

  function initHUD() {
    if (document.querySelector('.sp-hud')) return;

    const nameEl = document.querySelector('.portfolio-hero__name');
    const name   = nameEl?.textContent?.trim().toUpperCase() || 'UNKNOWN';

    const ra  = `${(Math.random() * 24).toFixed(2)}h`;
    const dec = `+${(Math.random() * 90).toFixed(1)}°`;

    const hud = document.createElement('div');
    hud.className = 'sp-hud';
    hud.setAttribute('aria-hidden', 'true');
    hud.innerHTML = `
      <div class="sp-hud__left">
        <span>RA: ${ra}</span>
        <span>DEC: ${dec}</span>
        <span id="sp-vel">VEL: 0 ly/s</span>
      </div>
      <div class="sp-hud__center">${name} · DEEP SPACE PORTFOLIO</div>
      <div class="sp-hud__right">
        <span class="sp-hud__signal"></span>
        <span>SIGNAL NOMINAL</span>
      </div>
    `;

    const toolbar   = document.getElementById('edit-toolbar');
    const container = document.querySelector('.portfolio-container, .portfolio-page');
    if (toolbar?.nextSibling) {
      toolbar.parentNode.insertBefore(hud, toolbar.nextSibling);
    } else if (container) {
      container.parentNode.insertBefore(hud, container);
    }

    /* Velocity readout — gentle random fluctuation to feel alive */
    setInterval(() => {
      const el = document.getElementById('sp-vel');
      if (!el || !_active) return;
      const spd = (0.1 + Math.random() * 0.4).toFixed(1);
      el.textContent = `VEL: ${spd} ly/s`;
      el.style.color = `rgba(79,195,247,0.7)`;
    }, 2000);
  }

  /* ════════════════════════════════════════════════════════
     LAYER 5: TARGETING RETICLE CURSOR
  ════════════════════════════════════════════════════════ */

  function initCursor() {
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const reticle = document.createElement('div');
    reticle.id = 'sp-reticle';
    reticle.style.cssText = `
      position:fixed; pointer-events:none; z-index:99999;
      width:44px; height:44px;
      transform:translate(-50%,-50%) rotate(0deg);
      opacity:0; transition:opacity .2s, width .25s, height .25s;
    `;
    reticle.innerHTML = `
      <svg width="44" height="44" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg">
        <!-- outer ring -->
        <circle cx="22" cy="22" r="18" fill="none" stroke="${BLUE}" stroke-width="0.8" opacity="0.5"/>
        <!-- cross -->
        <line x1="22" y1="4"  x2="22" y2="14" stroke="${BLUE}" stroke-width="1" opacity="0.7"/>
        <line x1="22" y1="30" x2="22" y2="40" stroke="${BLUE}" stroke-width="1" opacity="0.7"/>
        <line x1="4"  y1="22" x2="14" y2="22" stroke="${BLUE}" stroke-width="1" opacity="0.7"/>
        <line x1="30" y1="22" x2="40" y2="22" stroke="${BLUE}" stroke-width="1" opacity="0.7"/>
        <!-- corner ticks -->
        <path d="M9,9 L9,15 M9,9 L15,9"   fill="none" stroke="${BLUE}" stroke-width="1.2"/>
        <path d="M35,9 L35,15 M35,9 L29,9" fill="none" stroke="${BLUE}" stroke-width="1.2"/>
        <path d="M9,35 L9,29 M9,35 L15,35" fill="none" stroke="${BLUE}" stroke-width="1.2"/>
        <path d="M35,35 L35,29 M35,35 L29,35" fill="none" stroke="${BLUE}" stroke-width="1.2"/>
        <!-- center dot -->
        <circle cx="22" cy="22" r="1.5" fill="${BLUE}" opacity="0.9"/>
      </svg>
    `;

    const coords = document.createElement('div');
    coords.id = 'sp-coords';
    coords.style.cssText = `
      position:fixed; pointer-events:none; z-index:99999;
      font-family:'Share Tech Mono',monospace;
      font-size:9px; letter-spacing:.12em;
      color:rgba(79,195,247,0.6);
      text-shadow:0 0 8px rgba(79,195,247,0.4);
      white-space:nowrap; opacity:0;
      transition:opacity .15s;
      background:rgba(0,0,8,0.6);
      padding:2px 6px;
    `;

    document.body.appendChild(reticle);
    document.body.appendChild(coords);
    document.body.classList.add('sp-cursor-active');

    let angle = 0;
    let rx = 0, ry = 0;

    _on(document, 'mousemove', (e) => {
      _mouseX = e.clientX; _mouseY = e.clientY;
      reticle.style.opacity = '1';
      coords.style.opacity  = '1';
    }, { passive: true });

    _on(document, 'mouseleave', () => {
      reticle.style.opacity = '0';
      coords.style.opacity  = '0';
    });

    _on(document, 'mouseover', (e) => {
      const isI = e.target.matches('button,a,.project-card,.skill-tag,[contenteditable]');
      reticle.style.width  = isI ? '60px' : '44px';
      reticle.style.height = isI ? '60px' : '44px';
    });

    (function rotateLoop() {
      if (!_active) return;
      requestAnimationFrame(rotateLoop);

      /* Smooth follow */
      rx += (_mouseX - rx) * 0.10;
      ry += (_mouseY - ry) * 0.10;
      reticle.style.left = rx + 'px';
      reticle.style.top  = ry + 'px';

      /* Rotate — speed up during warp */
      angle += 0.15; // constant rotation — no warp state
      reticle.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;

      /* Coordinates */
      const dx = Math.round(_mouseX - window.innerWidth  / 2);
      const dy = Math.round(_mouseY - window.innerHeight / 2);
      const dist = Math.round(Math.hypot(dx, dy));
      coords.style.left = (_mouseX + 28) + 'px';
      coords.style.top  = (_mouseY - 20) + 'px';
      coords.textContent = `${dx > 0 ? '+' : ''}${dx}, ${dy > 0 ? '+' : ''}${dy} · ${dist}px`;
    })();
  }

  /* ════════════════════════════════════════════════════════
     LAYER 6: HOLOGRAPHIC CARD TILT
  ════════════════════════════════════════════════════════ */

  const _cardSprings = new WeakMap();

  function makeSpring() {
    return { x:0, y:0, vx:0, vy:0, tx:0, ty:0 };
  }

  function applyCardTilt(card) {
    if (_cardSprings.has(card)) return;
    const sp = makeSpring();
    _cardSprings.set(card, sp);

    function onMove(e) {
      if (!_active) return;
      const r  = card.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width/2)  / (r.width/2);
      const dy = (e.clientY - r.top  - r.height/2) / (r.height/2);
      sp.tx = dy * 8;
      sp.ty = -dx * 8;

      /* Chromatic aberration CSS vars */
      card.style.setProperty('--sp-ca-x', (dx * 3).toFixed(1) + 'px');
      card.style.setProperty('--sp-ca-y', (dy * 2).toFixed(1) + 'px');
    }

    function onLeave() {
      sp.tx = 0; sp.ty = 0;
      card.style.removeProperty('--sp-ca-x');
      card.style.removeProperty('--sp-ca-y');
    }

    card.addEventListener('mousemove',  onMove);
    card.addEventListener('mouseleave', onLeave);
    _listeners.push({ el:card, ev:'mousemove',  fn:onMove  });
    _listeners.push({ el:card, ev:'mouseleave', fn:onLeave });
  }

  function initCardTilts() {
    document.querySelectorAll('.project-card').forEach(applyCardTilt);
  }

  /* Physics loop for cards */
  function runCardPhysics() {
    if (!_active) return;
    requestAnimationFrame(runCardPhysics);

    document.querySelectorAll('.project-card').forEach(card => {
      const sp = _cardSprings.get(card);
      if (!sp) return;

      const ax = (sp.tx - sp.x) * 0.12;
      const ay = (sp.ty - sp.y) * 0.12;
      sp.vx = (sp.vx + ax) * 0.72;
      sp.vy = (sp.vy + ay) * 0.72;
      sp.x += sp.vx;
      sp.y += sp.vy;

      if (Math.hypot(sp.x, sp.y) < 0.02) {
        card.style.transform = '';
        card.style.boxShadow = '';
        return;
      }

      card.style.transform =
        `perspective(800px) rotateX(${sp.x}deg) rotateY(${sp.y}deg) translateZ(10px)`;
      card.style.boxShadow =
        `${-sp.y*2}px ${-sp.x*2}px 40px rgba(0,0,20,.6),
         0 0 60px rgba(79,195,247,${Math.hypot(sp.x,sp.y)*0.012})`;
      card.style.transition = 'none';
    });
  }

  /* ════════════════════════════════════════════════════════
     LAYER 7: COORDINATE ANNOTATIONS
  ════════════════════════════════════════════════════════ */

  function initAnnotations() {
    /* Cards: REPO-001, REPO-002 */
    document.querySelectorAll('.project-card').forEach((card, i) => {
      if (card.dataset.spAnnotated) return;
      card.dataset.spAnnotated = '1';

      const label = document.createElement('div');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = `
        position:absolute; top:10px; right:12px;
        font-family:'Share Tech Mono',monospace;
        font-size:9px; letter-spacing:.12em;
        color:rgba(79,195,247,0.25);
        pointer-events:none; z-index:4;
        transition:color .3s;
      `;
      label.textContent = `REPO-${String(i+1).padStart(3,'0')}`;
      card.style.position = 'relative';
      card.appendChild(label);

      card.addEventListener('mouseenter', () => label.style.color = 'rgba(79,195,247,0.55)');
      card.addEventListener('mouseleave', () => label.style.color = 'rgba(79,195,247,0.25)');
    });
  }

  /* ════════════════════════════════════════════════════════
     LAYER 8: REVEAL
  ════════════════════════════════════════════════════════ */

  function initReveal() {
    const style = document.createElement('style');
    style.id = 'sp-reveal-style';
    style.textContent = `
      [data-theme="space"] .project-card,
      .theme-space .project-card {
        opacity:0; transform:translateY(30px) scale(0.96);
        transition:opacity .7s ease, transform .7s cubic-bezier(.16,1,.3,1);
      }
      [data-theme="space"] .project-card.sp-revealed,
      .theme-space .project-card.sp-revealed {
        opacity:1; transform:translateY(0) scale(1);
      }
      [data-theme="space"] .section-label,
      .theme-space .section-label {
        opacity:0; transform:translateX(-16px);
        transition:opacity .5s ease, transform .5s cubic-bezier(.16,1,.3,1);
      }
      [data-theme="space"] .section-label.sp-revealed,
      .theme-space .section-label.sp-revealed {
        opacity:1; transform:translateX(0);
      }
      [data-theme="space"] .skill-tag:not(.skill-tag--add),
      .theme-space .skill-tag:not(.skill-tag--add) {
        opacity:0; transform:scale(0.85);
        transition:opacity .4s ease, transform .4s cubic-bezier(.34,1.56,.64,1);
      }
      [data-theme="space"] .skill-tag.sp-revealed,
      .theme-space .skill-tag.sp-revealed {
        opacity:1; transform:scale(1);
      }
    `;
    document.head.appendChild(style);

    const cardObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el  = entry.target;
        const all = [...document.querySelectorAll('.project-card')];
        const i   = all.indexOf(el);
        _t(() => el.classList.add('sp-revealed'), (i % 3) * 100);
        cardObs.unobserve(el);
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

    document.querySelectorAll('.project-card, .section-label').forEach(el => cardObs.observe(el));
    _observers.push(cardObs);

    const skillObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const tags = [...document.querySelectorAll('.skill-tag:not(.skill-tag--add)')];
        tags.forEach((tag, i) => _t(() => tag.classList.add('sp-revealed'), i * 40));
        skillObs.disconnect();
      });
    }, { threshold: 0.1 });

    const sc = document.querySelector('.skills-container');
    if (sc) skillObs.observe(sc);
    _observers.push(skillObs);
  }

  /* ════════════════════════════════════════════════════════
     CANVAS RESIZE
  ════════════════════════════════════════════════════════ */

  let _resizeTimer;
  function onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      if (!_active) return;
      const W = window.innerWidth, H = window.innerHeight;
      [_farCanvas,_midCanvas,_nearCanvas,_nebulaCanvas].forEach(c => {
        if (!c) return;
        c.width = W; c.height = H;
      });
    }, 200);
  }

  /* ════════════════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════════════════ */

  function init() {
    if (_active) return;
    _active = true;

    requestAnimationFrame(() => {
      initStarfield();
      initHUD();
      initCursor();
      initCardTilts();
      runCardPhysics();
      initAnnotations();
      initReveal();

      _on(window, 'mousemove', (e) => { _mouseX = e.clientX; _mouseY = e.clientY; }, { passive: true });
      _on(window, 'resize', onResize);
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    _timeouts.forEach(clearTimeout); _timeouts = [];
    _listeners.forEach(({ el, ev, fn }) => el.removeEventListener(ev, fn));
    _listeners = [];
    _observers.forEach(o => o.disconnect?.()); _observers = [];
    if (_frameId)   { cancelAnimationFrame(_frameId); _frameId = null; }
    clearTimeout(_resizeTimer);

    ['sp-stars-far','sp-stars-mid','sp-stars-near','sp-nebula',
     'sp-reticle','sp-coords','sp-reveal-style'].forEach(id => {
      document.getElementById(id)?.remove();
    });

    document.querySelector('.sp-hud')?.remove();
    document.body.classList.remove('sp-cursor-active');

    document.querySelectorAll('.project-card').forEach(card => {
      card.classList.remove('sp-revealed');
      card.style.transform = '';
      card.style.boxShadow = '';
      card.style.transition = '';
      delete card.dataset.spAnnotated;
    });

    document.querySelectorAll('[id^="sp-repo-"]').forEach(el => el.remove());
    document.querySelectorAll('.section-label, .skill-tag').forEach(el => {
      el.classList.remove('sp-revealed');
      el.style.opacity = '';
      el.style.transform = '';
    });

    _farStars = []; _midStars = []; _nearStars = [];
    _farCanvas = _midCanvas = _nearCanvas = _nebulaCanvas = null;
  }

  window.SpaceFX2 = { init, destroy };
  window.SpaceFX  = { init, destroy }; /* backward compat alias */

})();