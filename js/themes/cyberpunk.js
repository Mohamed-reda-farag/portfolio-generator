/**
 * cyberpunk.js (v2) — System Breach Effects
 * Exposed as: window.CyberFX2  (also aliased as window.CyberpunkFX)
 *
 * ── Layer 1: DATA STREAM CANVAS ───────────────────────────────
 *   Canvas 2D columns of falling hex + ASCII + symbols.
 *   3 layers: GREEN (primary), CYAN (decrypted), RED (corrupted).
 *   Columns have independent fall speeds and opacity decay.
 *   On scroll: speed multiplier increases — data floods in.
 *
 * ── Layer 2: SYSTEM BREACH BOOT SEQUENCE ─────────────────────
 *   Page starts hidden. Boot sequence plays:
 *   "ACCESS DENIED" → glitch → "OVERRIDE INITIATED" → "GRANTED"
 *   Content reveals after sequence completes.
 *
 * ── Layer 3: HEX DECODE on hero name ─────────────────────────
 *   Name text replaced by hex codes, then decoded char by char.
 *   "ALEX" → "41 4C 45 58" → scramble → "ALEX"
 *   Continuously re-glitches every 12-18s.
 *
 * ── Layer 4: NEURAL RETICLE CURSOR ───────────────────────────
 *   Square targeting reticle with corner brackets.
 *   On hover: SCANNING... → DECRYPTING... → ACCESSED
 *   Status text appears next to cursor, different per element type.
 *
 * ── Layer 5: GLITCH RAYS from featured card ──────────────────
 *   Featured card emits pixel-corruption rays to neighbors.
 *   Canvas overlay draws glitch artifacts between cards.
 *
 * ── Layer 6: CARD SCAN EFFECT ────────────────────────────────
 *   Each card gets a neon-bar + on hover: data-ID label.
 *   Cards reveal with a horizontal scan-line wipe.
 *
 * ── Layer 7: NEON CORNER BRACKETS injected per card ──────────
 *   JS ensures all current + future cards have brackets.
 *
 * ── Layer 8: RANDOM SYSTEM GLITCH ────────────────────────────
 *   Every 15-25s: full-screen red flash + distort effect.
 *   Lasts 200ms. Harmless. Keeps the system feeling alive.
 */

(function () {
  'use strict';

  let _active    = false;
  let _timeouts  = [];
  let _intervals = [];
  let _listeners = [];
  let _observers = [];

  const GREEN   = '#00ff41';
  const CYAN    = '#00d4ff';
  const RED     = '#ff003c';
  const YELLOW  = '#ffea00';
  const MAGENTA = '#ff00ff';

  const STREAM_CHARS =
    '0123456789ABCDEF' +
    '!@#$%^&*<>?/\\|{}[]' +
    '░▒▓█▌▐│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼' +
    '01アイウエオカキクケコ';

  function _t(fn, ms)   { const id = setTimeout(fn, ms); _timeouts.push(id); }
  function _iv(fn, ms)  { const id = setInterval(fn, ms); _intervals.push(id); }
  function _on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    _listeners.push({ el, ev, fn });
  }
  function _isActive() {
    return document.body.getAttribute('data-theme') === 'cyberpunk'
        || document.documentElement.getAttribute('data-theme') === 'cyberpunk';
  }

  /* ════════════════════════════════════════════════════════
     LAYER 1 — DATA STREAM CANVAS
  ════════════════════════════════════════════════════════ */

  let _streamCanvas, _streamCtx, _streamCols = [];
  let _streamRaf, _scrollY = 0, _scrollMult = 1;

  function initDataStream() {
    _streamCanvas = document.createElement('canvas');
    _streamCanvas.id = 'cb-stream';
    _streamCanvas.style.cssText =
      'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:.55;';
    document.body.insertBefore(_streamCanvas, document.body.firstChild);
    resizeStream();
    renderStream();
  }

  function resizeStream() {
    if (!_streamCanvas) return;
    _streamCanvas.width  = window.innerWidth;
    _streamCanvas.height = window.innerHeight;
    buildStreamCols();
  }

  function buildStreamCols() {
    const W = _streamCanvas.width;
    const colW = 18;
    const count = Math.floor(W / colW);
    _streamCols = Array.from({ length: count }, (_, i) => ({
      x: i * colW,
      y: Math.random() * _streamCanvas.height * -1,
      speed: 0.8 + Math.random() * 1.8,
      length: 8 + Math.floor(Math.random() * 20),
      type: Math.random() < 0.7 ? 'green' : Math.random() < 0.5 ? 'cyan' : 'red',
      chars: [],
      opacity: 0.3 + Math.random() * 0.6,
    }));
    /* Initialize chars */
    _streamCols.forEach(col => {
      col.chars = Array.from({ length: col.length },
        () => STREAM_CHARS[Math.floor(Math.random() * STREAM_CHARS.length)]);
    });
  }

  function renderStream() {
    if (!_active || !_streamCtx) return;
    _streamRaf = requestAnimationFrame(renderStream);

    const W = _streamCanvas.width, H = _streamCanvas.height;
    const charH = 18;

    /* Fade trail */
    _streamCtx.fillStyle = 'rgba(0,0,0,0.055)';
    _streamCtx.fillRect(0, 0, W, H);

    _streamCols.forEach(col => {
      const speed = col.speed * _scrollMult;
      col.y += speed;

      /* Randomize chars slightly */
      if (Math.random() < 0.08) {
        const idx = Math.floor(Math.random() * col.chars.length);
        col.chars[idx] = STREAM_CHARS[Math.floor(Math.random() * STREAM_CHARS.length)];
      }

      col.chars.forEach((ch, i) => {
        const yPos = col.y - i * charH;
        if (yPos < -charH || yPos > H + charH) return;

        /* Head = brighter */
        const isHead = i === 0;
        let color, alpha;

        if (col.type === 'green') {
          color = isHead ? '#ffffff' : GREEN;
          alpha = isHead ? 0.95 : col.opacity * (1 - i / col.length);
        } else if (col.type === 'cyan') {
          color = isHead ? '#aaffff' : CYAN;
          alpha = isHead ? 0.9 : col.opacity * 0.7 * (1 - i / col.length);
        } else {
          color = isHead ? '#ff8888' : RED;
          alpha = isHead ? 0.8 : col.opacity * 0.5 * (1 - i / col.length);
        }

        _streamCtx.globalAlpha = Math.max(0, alpha);
        _streamCtx.fillStyle   = color;
        _streamCtx.font        = `${charH - 2}px "Share Tech Mono", monospace`;
        _streamCtx.fillText(ch, col.x, yPos);
      });

      /* Reset col when it falls off screen */
      if (col.y - col.length * charH > H) {
        col.y = -charH * 2;
        col.speed  = 0.8 + Math.random() * 1.8;
        col.length = 8 + Math.floor(Math.random() * 20);
        col.type = Math.random() < 0.7 ? 'green' : Math.random() < 0.5 ? 'cyan' : 'red';
        col.opacity = 0.3 + Math.random() * 0.6;
      }
    });

    _streamCtx.globalAlpha = 1;
  }

  /* Scroll multiplier */
  function initScrollMult() {
    let lastY = 0;
    _on(window, 'scroll', () => {
      _scrollY = window.scrollY;
      const vel = Math.abs(_scrollY - lastY);
      lastY = _scrollY;
      _scrollMult = 1 + Math.min(vel * 0.12, 4);
      setTimeout(() => { _scrollMult = Math.max(1, _scrollMult - 0.2); }, 150);
    }, { passive: true });
  }

  /* ════════════════════════════════════════════════════════
     LAYER 2 — SYSTEM BREACH BOOT SEQUENCE
  ════════════════════════════════════════════════════════ */

  function initBootSequence(onComplete) {
    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');
    if (!container) { onComplete?.(); return; }

    container.style.opacity = '0';

    const overlay = document.createElement('div');
    overlay.id = 'cb-boot';
    overlay.style.cssText = `
      position:fixed;inset:0;
      background:#000;
      z-index:9997;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'Share Tech Mono',monospace;
      gap:8px;
    `;
    document.body.appendChild(overlay);

    const lines = [
      { text: 'INITIALIZING BREACH PROTOCOL...', color: GREEN,  delay: 0    },
      { text: 'SCANNING TARGET SYSTEM...', color: CYAN,   delay: 400  },
      { text: '██████████░░░░░░░░░░ 52%',  color: GREEN,  delay: 800  },
      { text: 'FIREWALL DETECTED — BYPASSING...', color: YELLOW, delay: 1100 },
      { text: '████████████████░░░░ 78%',  color: GREEN,  delay: 1400 },
      { text: '[ERROR] ACCESS DENIED', color: RED,    delay: 1700, big: true },
      { text: 'OVERRIDE CODE: 0x4741CB2F', color: YELLOW, delay: 2100 },
      { text: '████████████████████ 100%', color: GREEN,  delay: 2400 },
      { text: 'SYSTEM OVERRIDE SUCCESSFUL', color: MAGENTA, delay: 2800, big: true },
      { text: 'DECRYPTING PORTFOLIO DATA...', color: CYAN,   delay: 3200 },
      { text: '>>> ACCESS GRANTED <<<', color: GREEN,  delay: 3600, big: true },
    ];

    lines.forEach(line => {
      _t(() => {
        if (!_active) return;
        const el = document.createElement('div');
        el.style.cssText = `
          font-size:${line.big ? '16' : '12'}px;
          letter-spacing:${line.big ? '.22' : '.14'}em;
          color:${line.color};
          text-shadow:0 0 10px ${line.color}88;
          ${line.big ? `font-weight:700;` : ''}
          opacity:0;
          animation:none;
          transition:opacity .15s;
        `;
        el.textContent = line.text;
        overlay.appendChild(el);
        requestAnimationFrame(() => el.style.opacity = '1');
      }, line.delay);
    });

    /* Done */
    _t(() => {
      if (!_active) return;
      overlay.style.transition = 'opacity 0.4s ease';
      overlay.style.opacity = '0';
      container.style.transition = 'opacity 0.5s ease';
      container.style.opacity = '1';
      _t(() => { overlay.remove(); onComplete?.(); }, 450);
    }, 4200);
  }

  /* ════════════════════════════════════════════════════════
     LAYER 3 — HEX DECODE on hero name
  ════════════════════════════════════════════════════════ */

  function initHexDecode() {
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (!nameEl || nameEl.dataset.cbHex) return;
    nameEl.dataset.cbHex = '1';

    const original = nameEl.textContent.trim();

    /* Convert text to hex representation */
    function toHex(str) {
      return str.split('').map(c =>
        c === ' ' ? '   ' : c.charCodeAt(0).toString(16).toUpperCase().padStart(2,'0')
      ).join(' ');
    }

    const hexVersion = toHex(original);
    const scrambleChars = '0123456789ABCDEF';

    function scramble(str, progress) {
      return str.split('').map((ch, i) => {
        if (ch === ' ' || ch === '\n') return ch;
        if (i / str.length < progress) return ch;
        return scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
      }).join('');
    }

    function runDecode(from, to, duration, onDone) {
      let start = null;
      function frame(ts) {
        if (!_active) { nameEl.textContent = to; return; }
        if (!start) start = ts;
        const p = Math.min((ts - start) / duration, 1);
        /* Interpolate from hex → target characters */
        let output = '';
        const maxLen = Math.max(from.length, to.length);
        for (let i = 0; i < to.length; i++) {
          if (to[i] === ' ' || to[i] === '\n') { output += to[i]; continue; }
          if (p > i / to.length) output += to[i];
          else output += scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
        }
        nameEl.textContent = output;
        if (p < 1) requestAnimationFrame(frame);
        else { nameEl.textContent = to; onDone?.(); }
      }
      requestAnimationFrame(frame);
    }

    /* Phase 1: show hex */
    nameEl.textContent = hexVersion;
    nameEl.style.fontSize = 'clamp(1rem, 2.5vw, 2rem)';
    nameEl.style.letterSpacing = '.08em';

    /* Phase 2: decode to original */
    _t(() => {
      if (!_active) return;
      nameEl.style.fontSize = '';
      nameEl.style.letterSpacing = '';
      runDecode(hexVersion, original, 800, () => {
        scheduleGlitch();
      });
    }, 600);

    /* Schedule recurring glitch */
    function scheduleGlitch() {
      if (!_active) return;
      const delay = 12000 + Math.random() * 8000;
      _t(() => {
        if (!_active || !_isActive()) return;
        nameEl.classList.add('cb-glitching');
        nameEl.textContent = scramble(original, 0);
        _t(() => {
          runDecode('', original, 500, () => {
            nameEl.classList.remove('cb-glitching');
            scheduleGlitch();
          });
        }, 300);
      }, delay);
    }
  }

  /* ════════════════════════════════════════════════════════
     LAYER 4 — NEURAL RETICLE CURSOR
  ════════════════════════════════════════════════════════ */

  const SCAN_STATES = {
    default:     '',
    project:     'DECRYPTING DATA PACKET',
    skill:       'ANALYZING MODULE',
    button:      'AWAITING COMMAND INPUT',
    editable:    'WRITE ACCESS ENABLED',
    link:        'LINK DETECTED',
  };

  function initCursor() {
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const reticle = document.createElement('div');
    reticle.id = 'cb-reticle';
    reticle.style.cssText = `
      position:fixed; pointer-events:none; z-index:99999;
      width:36px; height:36px;
      transform:translate(-50%,-50%);
      opacity:0; transition:opacity .15s, width .2s, height .2s;
    `;
    reticle.innerHTML = `
      <svg width="36" height="36" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
        <!-- outer corners -->
        <path d="M2,10 L2,2 L10,2"   fill="none" stroke="${GREEN}" stroke-width="1.5" opacity=".9"/>
        <path d="M26,2 L34,2 L34,10" fill="none" stroke="${GREEN}" stroke-width="1.5" opacity=".9"/>
        <path d="M2,26 L2,34 L10,34" fill="none" stroke="${GREEN}" stroke-width="1.5" opacity=".9"/>
        <path d="M26,34 L34,34 L34,26" fill="none" stroke="${GREEN}" stroke-width="1.5" opacity=".9"/>
        <!-- cross -->
        <line x1="18" y1="2"  x2="18" y2="8"  stroke="${GREEN}" stroke-width=".8" opacity=".5"/>
        <line x1="18" y1="28" x2="18" y2="34" stroke="${GREEN}" stroke-width=".8" opacity=".5"/>
        <line x1="2"  y1="18" x2="8"  y2="18" stroke="${GREEN}" stroke-width=".8" opacity=".5"/>
        <line x1="28" y1="18" x2="34" y2="18" stroke="${GREEN}" stroke-width=".8" opacity=".5"/>
        <!-- center dot -->
        <rect x="16" y="16" width="4" height="4" fill="${GREEN}" opacity=".8"/>
      </svg>
    `;

    const scanLabel = document.createElement('div');
    scanLabel.id = 'cb-scan-label';
    scanLabel.style.cssText = `
      position:fixed; pointer-events:none; z-index:99999;
      font-family:'Share Tech Mono',monospace;
      font-size:9px; letter-spacing:.14em; text-transform:uppercase;
      color:${GREEN}; text-shadow:0 0 8px ${GREEN}88;
      opacity:0; white-space:nowrap;
      transition:opacity .15s;
      background:rgba(0,0,0,0.7);
      padding:2px 8px;
      border-left:2px solid ${GREEN};
    `;

    document.body.appendChild(reticle);
    document.body.appendChild(scanLabel);
    document.body.classList.add('cb-cursor-active');

    let rx = 0, ry = 0, mx = 0, my = 0;
    let scanTimeout;

    _on(document, 'mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      reticle.style.left = mx + 'px';
      reticle.style.top  = my + 'px';
      reticle.style.opacity = '1';
    }, { passive: true });

    _on(document, 'mouseleave', () => {
      reticle.style.opacity  = '0';
      scanLabel.style.opacity = '0';
    });

    _on(document, 'mouseover', (e) => {
      const el = e.target;
      let state = 'default';
      let color = GREEN;

      if (el.closest('.project-card'))        { state = 'project'; color = CYAN; }
      else if (el.closest('.skill-tag'))       { state = 'skill';   color = GREEN; }
      else if (el.matches('button, .btn--primary, .btn--ghost')) { state = 'button'; color = YELLOW; }
      else if (el.closest('[contenteditable]')) { state = 'editable'; color = MAGENTA; }
      else if (el.matches('a'))                { state = 'link';   color = CYAN; }

      const expanded = state !== 'default';
      reticle.style.width  = expanded ? '50px' : '36px';
      reticle.style.height = expanded ? '50px' : '36px';

      const svg = reticle.querySelector('svg');
      if (svg) svg.querySelectorAll('path, line, rect').forEach(el => {
        el.setAttribute('stroke', color);
        el.setAttribute('fill', el.tagName === 'rect' ? color : 'none');
      });

      /* Scan label */
      if (SCAN_STATES[state]) {
        clearTimeout(scanTimeout);
        scanLabel.textContent = 'SCANNING...';
        scanLabel.style.color = color;
        scanLabel.style.borderColor = color;
        scanLabel.style.textShadow = `0 0 8px ${color}88`;
        scanLabel.style.opacity = '1';
        scanLabel.style.left = (mx + 24) + 'px';
        scanLabel.style.top  = (my - 12) + 'px';

        scanTimeout = setTimeout(() => {
          if (!_active) return;
          scanLabel.textContent = SCAN_STATES[state];
          scanTimeout = setTimeout(() => { scanLabel.style.opacity = '0'; }, 1800);
        }, 400);
      } else {
        scanLabel.style.opacity = '0';
      }
    });

    /* Update label position */
    (function loop() {
      if (!_active) return;
      requestAnimationFrame(loop);
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
    })();
  }

  /* ════════════════════════════════════════════════════════
     LAYER 5 — GLITCH RAYS from featured card
  ════════════════════════════════════════════════════════ */

  let _glitchCanvas, _glitchCtx, _glitchRaf;

  function initGlitchRays() {
    _glitchCanvas = document.createElement('canvas');
    _glitchCanvas.id = 'cb-glitch-canvas';
    _glitchCanvas.style.cssText = `
      position:fixed;inset:0;width:100%;height:100%;
      z-index:2;pointer-events:none;
    `;
    _glitchCanvas.width  = window.innerWidth;
    _glitchCanvas.height = window.innerHeight;
    document.body.appendChild(_glitchCanvas);
    _glitchCtx = _glitchCanvas.getContext('2d');

    renderGlitchRays();
  }

  let _glitchPhase = 0;
  function renderGlitchRays() {
    if (!_active || !_glitchCtx) return;
    _glitchRaf = requestAnimationFrame(renderGlitchRays);

    const W = _glitchCanvas.width, H = _glitchCanvas.height;
    _glitchCtx.clearRect(0, 0, W, H);

    const featured = document.querySelector('.project-card--featured');
    if (!featured) return;

    _glitchPhase += 0.02;
    if (Math.random() > 0.06) return; /* rare glitches */

    const r   = featured.getBoundingClientRect();
    const cx  = r.left + r.width / 2 + window.scrollX;
    const cy  = r.top  + r.height / 2;

    /* 3-6 glitch rays */
    const rays = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < rays; i++) {
      const angle  = Math.random() * Math.PI * 2;
      const length = 80 + Math.random() * 200;
      const ex     = cx + Math.cos(angle) * length;
      const ey     = cy + Math.sin(angle) * length;

      /* Pixel corruption blocks along ray */
      const steps = 4 + Math.floor(Math.random() * 6);
      for (let s = 0; s < steps; s++) {
        const t  = s / steps;
        const bx = cx + (ex - cx) * t;
        const by = cy + (ey - cy) * t;
        const bw = 2 + Math.random() * 8;
        const bh = 1 + Math.random() * 3;

        _glitchCtx.globalAlpha = (1 - t) * 0.7 * Math.random();
        const colors = [YELLOW, RED, CYAN, GREEN, MAGENTA];
        _glitchCtx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        _glitchCtx.fillRect(bx, by, bw, bh);
      }
    }
    _glitchCtx.globalAlpha = 1;
  }

  /* ════════════════════════════════════════════════════════
     LAYER 6 — CARD ELEMENTS
  ════════════════════════════════════════════════════════ */

  function applyCardEffects(card, idx) {
    /* Neon bar */
    if (!card.querySelector('.cb-neon-bar')) {
      const bar = document.createElement('div');
      bar.className = 'cb-neon-bar';
      card.insertBefore(bar, card.firstChild);
    }

    /* Data ID label */
    if (!card.dataset.cbId) {
      card.dataset.cbId = '1';
      const label = document.createElement('div');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = `
        position:absolute; top:8px; right:10px;
        font-family:'Share Tech Mono',monospace;
        font-size:9px; letter-spacing:.12em;
        color:rgba(0,255,65,.22);
        pointer-events:none; z-index:4;
        transition:color .2s, text-shadow .2s;
      `;
      label.textContent = `0x${(idx + 1).toString(16).toUpperCase().padStart(4,'0')}`;
      card.style.position = 'relative';
      card.appendChild(label);

      card.addEventListener('mouseenter', () => {
        label.style.color = 'rgba(0,255,65,.65)';
        label.style.textShadow = '0 0 8px rgba(0,255,65,.4)';
      });
      card.addEventListener('mouseleave', () => {
        label.style.color = 'rgba(0,255,65,.22)';
        label.style.textShadow = '';
      });
    }
  }

  function initCardEffects() {
    document.querySelectorAll('.project-card').forEach((card, i) => applyCardEffects(card, i));
  }

  /* ════════════════════════════════════════════════════════
     LAYER 7 — SCANLINE OVERLAY
  ════════════════════════════════════════════════════════ */

  function initScanlines() {
    if (document.querySelector('.cb-scanlines')) return;
    const sl = document.createElement('div');
    sl.className = 'cb-scanlines';
    document.body.appendChild(sl);
  }

  /* ════════════════════════════════════════════════════════
     LAYER 8 — RANDOM SYSTEM GLITCH
  ════════════════════════════════════════════════════════ */

  function initSystemGlitch() {
    function glitch() {
      if (!_active || !_isActive()) return;

      const flash = document.createElement('div');
      flash.style.cssText = `
        position:fixed;inset:0;z-index:9999;pointer-events:none;
        background:${RED};opacity:.08;
        animation:none;
      `;
      document.body.appendChild(flash);

      /* Brief RGB shift on body */
      document.body.style.filter = 'hue-rotate(90deg) contrast(1.15)';
      _t(() => {
        document.body.style.filter = '';
        flash.remove();
      }, 80);

      scheduleGlitch();
    }

    function scheduleGlitch() {
      if (!_active) return;
      const delay = 15000 + Math.random() * 12000;
      _t(glitch, delay);
    }
    scheduleGlitch();
  }

  /* ════════════════════════════════════════════════════════
     LAYER 9 — CARD REVEAL — scan-line horizontal wipe
  ════════════════════════════════════════════════════════ */

  function initReveal() {
    const style = document.createElement('style');
    style.id = 'cb-reveal-style';
    style.textContent = `
      [data-theme="cyberpunk"] .project-card,
      .theme-cyberpunk .project-card {
        opacity:0;
        clip-path:inset(0 100% 0 0);
        transition:opacity .5s ease, clip-path .55s cubic-bezier(.16,1,.3,1);
      }
      [data-theme="cyberpunk"] .project-card.cb-revealed,
      .theme-cyberpunk .project-card.cb-revealed {
        opacity:1; clip-path:inset(0 0% 0 0);
      }
      [data-theme="cyberpunk"] .section-label,
      .theme-cyberpunk .section-label {
        opacity:0; transform:translateX(-12px);
        transition:opacity .4s ease, transform .4s cubic-bezier(.16,1,.3,1);
      }
      [data-theme="cyberpunk"] .section-label.cb-revealed,
      .theme-cyberpunk .section-label.cb-revealed {
        opacity:1; transform:translateX(0);
      }
      [data-theme="cyberpunk"] .skill-tag:not(.skill-tag--add),
      .theme-cyberpunk .skill-tag:not(.skill-tag--add) {
        opacity:0; transform:scale(0.88);
        transition:opacity .35s ease, transform .35s cubic-bezier(.34,1.56,.64,1);
      }
      [data-theme="cyberpunk"] .skill-tag.cb-revealed,
      .theme-cyberpunk .skill-tag.cb-revealed {
        opacity:1; transform:scale(1);
      }
    `;
    document.head.appendChild(style);

    function observeElements(elements) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const el  = entry.target;
          const all = [...document.querySelectorAll('.project-card')];
          const i   = all.indexOf(el);
          const d   = el.classList.contains('project-card') ? (i % 3) * 90 : 0;
          _t(() => el.classList.add('cb-revealed'), d);
          obs.unobserve(el);
        });
      }, { threshold: 0.05, rootMargin: '0px 0px -16px 0px' });

      elements.forEach(el => obs.observe(el));
      _observers.push(obs);
    }

    // Observe elements already in DOM at init time
    const existing = [...document.querySelectorAll('.project-card, .section-label')];
    if (existing.length) observeElements(existing);

    // Watch for cards added after async data fetch
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (grid) {
      const gridObs = new MutationObserver((mutations) => {
        const newCards = [];
        mutations.forEach(m => m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.classList.contains('project-card')) newCards.push(node);
        }));
        if (newCards.length) observeElements(newCards);
      });
      gridObs.observe(grid, { childList: true });
      _observers.push(gridObs);
    }

    const skillObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const tags = [...document.querySelectorAll('.skill-tag:not(.skill-tag--add)')];
        tags.forEach((tag, i) => _t(() => tag.classList.add('cb-revealed'), i * 35));
        skillObs.disconnect();
      });
    }, { threshold: 0.1 });

    const sc = document.querySelector('.skills-container');
    if (sc) skillObs.observe(sc);
    _observers.push(skillObs);
  }

  /* ═══ HUD BARS ═══ */
  function initHUDBars() {
    if (document.querySelector('.cb-alert')) return;

    const nameEl = document.querySelector('.portfolio-hero__name');
    const name   = nameEl?.textContent?.trim().toUpperCase() || 'UNKNOWN';

    const alert = document.createElement('div');
    alert.className = 'cb-alert';
    alert.innerHTML = `<span class="cb-alert__text">⚠ UNAUTHORIZED ACCESS DETECTED — SYSTEM OVERRIDE IN PROGRESS ⚠</span>`;

    const status = document.createElement('div');
    status.className = 'cb-status';
    status.innerHTML = `
      <div class="cb-status__cell">
        <span class="cb-status__dot"></span>
        <span>BREACH</span>
      </div>
      <div class="cb-status__cell">
        <span>TARGET:</span>
        <span class="cb-status__val">${name}</span>
      </div>
      <div class="cb-status__cell">
        <span>PACKETS:</span>
        <span class="cb-status__val" id="cb-packets">0</span>
      </div>
      <div class="cb-status__cell">
        <span>DECRYPT:</span>
        <span class="cb-status__warn" id="cb-decrypt">74%</span>
      </div>
      <div class="cb-status__cell" style="margin-left:auto">
        <span id="cb-time" class="cb-status__val"></span>
      </div>
    `;

    const toolbar   = document.getElementById('edit-toolbar');
    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');

    const insertAfter = toolbar?.nextSibling
      ? () => toolbar.parentNode.insertBefore(alert, toolbar.nextSibling)
      : () => container?.parentNode.insertBefore(alert, container);

    insertAfter();
    alert.parentNode.insertBefore(status, alert.nextSibling);

    /* Live counters */
    let packets = 0;
    _iv(() => {
      packets += Math.floor(Math.random() * 48) + 8;
      const el = document.getElementById('cb-packets');
      if (el) el.textContent = packets.toLocaleString();
    }, 200);

    _iv(() => {
      const el = document.getElementById('cb-decrypt');
      if (el) {
        const pct = 74 + Math.floor(Math.random() * 26);
        el.textContent = pct + '%';
        el.style.color = pct >= 100 ? '#00ff41' : '#ffea00';
      }
    }, 1500);

    _iv(() => {
      const el = document.getElementById('cb-time');
      if (el) {
        const now = new Date();
        el.textContent = [now.getHours(),now.getMinutes(),now.getSeconds()]
          .map(v=>String(v).padStart(2,'0')).join(':');
      }
    }, 1000);
  }

  /* ═══ MUTATION OBSERVER ═══ */
  function initMutationObserver() {
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (!grid) return;
    const obs = new MutationObserver((mutations) => {
      const addedCards = [];
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.classList.contains('project-card')) {
            addedCards.push(node);
          }
        });
      });
      if (addedCards.length) {
        _t(() => addedCards.forEach((card, i) => applyCardEffects(card, i)), 60);
      }
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

    /* Grid layers — CSS-only, inject divs */
    if (!document.querySelector('.cb-grid-a')) {
      const ga = document.createElement('div');
      ga.className = 'cb-grid-layer cb-grid-a';
      const gb = document.createElement('div');
      gb.className = 'cb-grid-layer cb-grid-b';
      const gp = document.createElement('div');
      gp.className = 'cb-grid-persp';
      document.body.insertBefore(ga, document.body.firstChild);
      document.body.insertBefore(gb, document.body.firstChild);
      document.body.appendChild(gp);
    }

    initDataStream();
    initScrollMult();
    initScanlines();
    initGlitchRays();

    initBootSequence(() => {
      if (!_active) return;
      requestAnimationFrame(() => {
        initHUDBars();
        initHexDecode();
        initCursor();
        initCardEffects();
        initReveal();
        initSystemGlitch();
        initMutationObserver();

        _streamCtx = _streamCanvas?.getContext('2d');
      });
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    _timeouts.forEach(clearTimeout);   _timeouts = [];
    _intervals.forEach(clearInterval); _intervals = [];
    _listeners.forEach(({ el, ev, fn }) => el.removeEventListener(ev, fn));
    _listeners = [];
    _observers.forEach(o => o.disconnect?.()); _observers = [];

    if (_streamRaf) { cancelAnimationFrame(_streamRaf); _streamRaf = null; }
    if (_glitchRaf) { cancelAnimationFrame(_glitchRaf); _glitchRaf = null; }

    ['cb-stream','cb-glitch-canvas','cb-reticle','cb-scan-label',
     'cb-reveal-style','cb-boot'].forEach(id => document.getElementById(id)?.remove());

    document.querySelectorAll(
      '.cb-alert,.cb-status,.cb-scanlines,.cb-grid-a,.cb-grid-b,.cb-grid-persp'
    ).forEach(el => el.remove());

    document.body.classList.remove('cb-cursor-active');
    document.body.style.filter = '';

    /* Reset hero name */
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (nameEl?.dataset?.cbHex) {
      nameEl.classList.remove('cb-glitching');
      delete nameEl.dataset.cbHex;
    }

    /* Reset cards */
    document.querySelectorAll('.project-card').forEach(card => {
      card.classList.remove('cb-revealed');
      card.style.opacity = '';
      card.style.clipPath = '';
      card.style.transition = '';
      card.querySelector('.cb-neon-bar')?.remove();
      delete card.dataset.cbId;
    });

    document.querySelectorAll('.section-label, .skill-tag').forEach(el => {
      el.classList.remove('cb-revealed');
      el.style.opacity = '';
      el.style.transform = '';
    });

    const container = document.querySelector('.portfolio-container, .portfolio-wrapper');
    if (container) { container.style.opacity = '1'; container.style.transition = ''; }
  }

  window.CyberFX2    = { init, destroy };
  window.CyberpunkFX = { init, destroy }; /* alias */

})();