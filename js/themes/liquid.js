/**
 * liquid.js — Liquid Theme Effects
 * Exposed as: window.LiquidFX
 *
 * Layer 1 — WebGL Fluid Simulation
 *   Real fluid dynamics shader. Mouse disturbs the fluid.
 *   Violet + coral + cyan pigments bleed into each other.
 *
 * Layer 2 — Spring Physics System
 *   Every magnetic element has mass, stiffness, damping.
 *   Cards tilt toward cursor. Skills stretch to pointer.
 *   Buttons have overshoot bounce on hover.
 *
 * Layer 3 — Visual Polish
 *   Gradient hero name split per-word.
 *   Liquid cursor with trailing ink droplet.
 *   Floating blob orbs drifting behind content.
 *   Section reveal with dissolve-up animation.
 *   Featured card animated border morph.
 */

(function () {
  'use strict';

  let _active    = false;
  let _timeouts  = [];
  let _listeners = [];
  let _observers = [];
  let _rafIds    = [];

  /* ── Helpers ── */
  function _t(fn, ms)  { const id = setTimeout(fn, ms); _timeouts.push(id); return id; }
  function _raf(fn)    { const id = requestAnimationFrame(fn); _rafIds.push(id); return id; }
  function _on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    _listeners.push({ el, ev, fn });
  }

  /* ══════════════════════════════════════════════════════
     LAYER 1 — WebGL FLUID SIMULATION
     Based on Jos Stam's stable fluids, simplified for GPU.
     Fragment shader does advection + diffusion in one pass.
  ══════════════════════════════════════════════════════ */
  let _gl = null, _canvas = null;
  let _prog = null, _buf = null;
  let _texA = null, _texB = null;
  let _fbA = null, _fbB = null;
  let _fluidRaf = null;
  let _mouseX = 0, _mouseY = 0;
  let _prevMouseX = 0, _prevMouseY = 0;
  let _mouseVX = 0, _mouseVY = 0;

  const FLUID_VS = `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main(){
      v_uv = a_pos * .5 + .5;
      gl_Position = vec4(a_pos, 0., 1.);
    }
  `;

  const FLUID_FS = `
    precision mediump float;
    uniform sampler2D u_state;
    uniform vec2 u_res;
    uniform vec2 u_mouse;
    uniform vec2 u_vel;
    uniform float u_time;
    varying vec2 v_uv;

    vec3 hsl2rgb(vec3 c){
      vec3 rgb = clamp(abs(mod(c.x*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);
      return c.z+c.y*(rgb-.5)*(1.-abs(2.*c.z-1.));
    }

    void main(){
      vec2 px = 1. / u_res;
      vec2 uv = v_uv;

      // Sample neighbours
      vec4 cur  = texture2D(u_state, uv);
      vec4 up   = texture2D(u_state, uv + vec2(0, px.y));
      vec4 dn   = texture2D(u_state, uv - vec2(0, px.y));
      vec4 lt   = texture2D(u_state, uv - vec2(px.x, 0));
      vec4 rt   = texture2D(u_state, uv + vec2(px.x, 0));

      // Advect
      vec2 vel = cur.xy * .98;
      vec4 adv = texture2D(u_state, uv - vel * px * 18.);

      // Diffuse colour (z=hue, w=saturation)
      float diffH = (up.z + dn.z + lt.z + rt.z - 4.*cur.z) * .08;
      float diffW = (up.w + dn.w + lt.w + rt.w - 4.*cur.w) * .06;

      // Mouse splash
      float dist  = length(uv - u_mouse);
      float splash = exp(-dist * dist * 180.) * .7;
      vec2  pushV  = u_vel * splash;
      float pushH  = splash * .35;

      float hue = mod(adv.z + diffH + pushH + u_time * .003, 1.);
      float sat = clamp(adv.w + diffW + splash * .4, .5, 1.);
      vec2  nVel = adv.xy * .985 + pushV;

      // Velocity damping
      nVel *= .982;

      gl_FragColor = vec4(nVel, hue, sat);
    }
  `;

  const DISPLAY_FS = `
    precision mediump float;
    uniform sampler2D u_state;
    varying vec2 v_uv;

    vec3 hsl2rgb(vec3 c){
      vec3 rgb = clamp(abs(mod(c.x*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);
      return c.z+c.y*(rgb-.5)*(1.-abs(2.*c.z-1.));
    }

    void main(){
      vec4 s   = texture2D(u_state, v_uv);
      float hue = s.z;
      float sat = s.w;
      // Map hue 0-1 → violet(0.73) → coral(0.0) → cyan(0.52)
      float h = mix(.73, .52, smoothstep(.3, .7, hue));
      h = mix(h, .02, smoothstep(.7, .95, hue));
      vec3 col = hsl2rgb(vec3(h, sat, .35 + s.w * .20));
      // Deep background tint
      col = mix(vec3(.05, .04, .10), col, clamp(length(s.xy)*6. + s.w*.5, 0., 1.));
      gl_FragColor = vec4(col, 1.);
    }
  `;

  function _compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }

  function _program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, _compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, _compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    return p;
  }

  function _makeTex(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    /* Initialize with violet-tinted noise */
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i*4]   = (Math.random()-.5) * .02;  /* vx */
      data[i*4+1] = (Math.random()-.5) * .02;  /* vy */
      data[i*4+2] = .65 + Math.random() * .25; /* hue — violet range */
      data[i*4+3] = .55 + Math.random() * .35; /* sat */
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.FLOAT, data);
    return tex;
  }

  function _makeFB(gl, tex) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fb;
  }

  function initWebGL() {
    _canvas = document.createElement('canvas');
    _canvas.id = 'lq-canvas';
    document.body.insertBefore(_canvas, document.body.firstChild);

    _gl = _canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      powerPreference: 'default',
    });

    if (!_gl || !_gl.getExtension('OES_texture_float')) {
      /* No WebGL — CSS fallback already visible */
      _canvas.remove();
      _canvas = null;
      return false;
    }

    const ext = _gl.getExtension('OES_texture_float_linear');
    const W = Math.floor(window.innerWidth  / 3);
    const H = Math.floor(window.innerHeight / 3);

    _canvas.width  = W;
    _canvas.height = H;
    _canvas.style.cssText = `
      position:fixed; inset:0;
      width:100%; height:100%;
      z-index:0; pointer-events:none;
      opacity:0; transition:opacity 1.2s ease;
    `;

    const gl = _gl;
    _prog       = _program(gl, FLUID_VS, FLUID_FS);
    _displayProg = _program(gl, FLUID_VS, DISPLAY_FS);

    /* Fullscreen quad */
    _buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, _buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW);

    _texA = _makeTex(gl, W, H);
    _texB = _makeTex(gl, W, H);
    _fbA  = _makeFB(gl, _texA);
    _fbB  = _makeFB(gl, _texB);

    _t(() => { if (_canvas) _canvas.classList.add('lq-ready'); }, 200);
    return true;
  }

  let _displayProg = null;
  let _frame = 0;

  function renderFluid() {
    if (!_active || !_gl || !_canvas) return;
    _fluidRaf = requestAnimationFrame(renderFluid);

    const gl = _gl;
    const W  = _canvas.width;
    const H  = _canvas.height;
    _frame++;

    /* Velocity from mouse delta */
    _mouseVX = (_mouseX - _prevMouseX) * 0.5;
    _mouseVY = (_mouseY - _prevMouseY) * 0.5;
    _prevMouseX = _mouseX;
    _prevMouseY = _mouseY;

    /* Simulate pass: → _fbB */
    gl.useProgram(_prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, _fbB);
    gl.viewport(0, 0, W, H);

    const aPos = gl.getAttribLocation(_prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, _buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, _texA);
    gl.uniform1i(gl.getUniformLocation(_prog, 'u_state'), 0);
    gl.uniform2f(gl.getUniformLocation(_prog, 'u_res'),   W, H);
    gl.uniform2f(gl.getUniformLocation(_prog, 'u_mouse'), _mouseX / window.innerWidth, 1 - _mouseY / window.innerHeight);
    gl.uniform2f(gl.getUniformLocation(_prog, 'u_vel'),   _mouseVX * .012, -_mouseVY * .012);
    gl.uniform1f(gl.getUniformLocation(_prog, 'u_time'),  _frame);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    /* Swap */
    let tmp = _texA; _texA = _texB; _texB = tmp;
    tmp = _fbA; _fbA = _fbB; _fbB = tmp;

    /* Display pass: → screen */
    gl.useProgram(_displayProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);

    const aPos2 = gl.getAttribLocation(_displayProg, 'a_pos');
    gl.enableVertexAttribArray(aPos2);
    gl.vertexAttribPointer(aPos2, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, _texA);
    gl.uniform1i(gl.getUniformLocation(_displayProg, 'u_state'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /* ══════════════════════════════════════════════════════
     LAYER 2 — SPRING PHYSICS SYSTEM
  ══════════════════════════════════════════════════════ */

  /* Spring: { x, y, vx, vy, tx, ty, stiffness, damping } */
  function makeSpring(stiff = 0.14, damp = 0.72) {
    return { x:0, y:0, vx:0, vy:0, tx:0, ty:0, stiff, damp };
  }

  function tickSpring(s) {
    const ax = (s.tx - s.x) * s.stiff;
    const ay = (s.ty - s.y) * s.stiff;
    s.vx = (s.vx + ax) * s.damp;
    s.vy = (s.vy + ay) * s.damp;
    s.x += s.vx;
    s.y += s.vy;
  }

  /* ── Card magnetic tilt ── */
  const _cardSprings = new WeakMap();

  function applyCardMagnetism(card) {
    if (_cardSprings.has(card)) return;
    const sp = makeSpring(0.10, 0.75);
    _cardSprings.set(card, sp);

    function onMove(e) {
      if (!_active) return;
      const r  = card.getBoundingClientRect();
      const cx = r.left + r.width  / 2;
      const cy = r.top  + r.height / 2;
      const dx = (e.clientX - cx) / (r.width  / 2);
      const dy = (e.clientY - cy) / (r.height / 2);

      sp.tx = dy * 7;    /* rotateX */
      sp.ty = -dx * 7;   /* rotateY */

      /* Spotlight */
      const mx = ((e.clientX - r.left) / r.width)  * 100;
      const my = ((e.clientY - r.top)  / r.height) * 100;
      card.style.setProperty('--lq-mx', mx + '%');
      card.style.setProperty('--lq-my', my + '%');
    }

    function onLeave() {
      sp.tx = 0;
      sp.ty = 0;
    }

    card.addEventListener('mousemove',  onMove);
    card.addEventListener('mouseleave', onLeave);
    _listeners.push({ el: card, ev: 'mousemove',  fn: onMove  });
    _listeners.push({ el: card, ev: 'mouseleave', fn: onLeave });
  }

  function initCardMagnetism() {
    document.querySelectorAll('.project-card').forEach(applyCardMagnetism);
  }

  /* ── Skill tag spring bounce ── */
  const _skillSprings = new WeakMap();

  function applySkillSpring(tag) {
    if (_skillSprings.has(tag)) return;
    const sp = makeSpring(0.22, 0.60); /* bouncier */
    _skillSprings.set(tag, sp);

    function onEnter() { sp.tx = -3; sp.ty = -3; }
    function onLeave() { sp.tx = 0;  sp.ty = 0;  }

    tag.addEventListener('mouseenter', onEnter);
    tag.addEventListener('mouseleave', onLeave);
    _listeners.push({ el: tag, ev: 'mouseenter', fn: onEnter });
    _listeners.push({ el: tag, ev: 'mouseleave', fn: onLeave });
  }

  function initSkillSprings() {
    document.querySelectorAll('.skill-tag:not(.skill-tag--add)').forEach(applySkillSpring);
  }

  /* ── Physics loop ── */
  function runPhysics() {
    if (!_active) return;
    requestAnimationFrame(runPhysics);

    /* Cards */
    document.querySelectorAll('.project-card').forEach(card => {
      const sp = _cardSprings.get(card);
      if (!sp) return;
      tickSpring(sp);
      const dist = Math.hypot(sp.x, sp.y);
      if (dist < 0.01) {
        card.style.transform = '';
        card.style.boxShadow = '';
        return;
      }
      card.style.transform =
        `perspective(700px) rotateX(${sp.x}deg) rotateY(${sp.y}deg) translateZ(8px)`;
      card.style.boxShadow =
        `${-sp.y * 1.5}px ${-sp.x * 1.5}px 32px rgba(0,0,0,0.3),
         ${-sp.y * 3}px ${-sp.x * 3}px 60px rgba(124,58,237,0.15)`;
      card.style.transition = 'none'; /* spring owns this */
    });

    /* Skill tags — translate bounce */
    document.querySelectorAll('.skill-tag:not(.skill-tag--add)').forEach(tag => {
      const sp = _skillSprings.get(tag);
      if (!sp) return;
      tickSpring(sp);
      if (Math.hypot(sp.x, sp.y) < 0.01) {
        tag.style.transform = '';
        return;
      }
      tag.style.transform = `translate(${sp.y}px, ${sp.x}px) scale(${1 + Math.hypot(sp.x,sp.y)*0.012})`;
      tag.style.transition = 'none';
    });
  }

  /* ══════════════════════════════════════════════════════
     LAYER 3 — VISUAL POLISH
  ══════════════════════════════════════════════════════ */

  /* ── CSS Fallback blobs ── */
  function initBlobs() {
    if (document.querySelector('.lq-bg-fallback')) return;

    const fallback = document.createElement('div');
    fallback.className = 'lq-bg-fallback';
    document.body.insertBefore(fallback, document.body.firstChild);

    /* Extra drifting blobs */
    const configs = [
      { w:600, h:600, top:'-10%',  left:'-5%',   bg:'rgba(124,58,237,0.22)',  dur:'22s', delay:'0s' },
      { w:500, h:500, top:'50%',   left:'70%',   bg:'rgba(255,107,107,0.18)', dur:'18s', delay:'-8s' },
      { w:450, h:450, top:'20%',   left:'45%',   bg:'rgba(6,182,212,0.14)',   dur:'26s', delay:'-14s' },
      { w:350, h:350, top:'75%',   left:'10%',   bg:'rgba(245,158,11,0.12)',  dur:'20s', delay:'-6s' },
    ];

    configs.forEach((c, i) => {
      const blob = document.createElement('div');
      blob.className = 'lq-blob';
      blob.style.cssText = `
        width:${c.w}px; height:${c.h}px;
        top:${c.top}; left:${c.left};
        background:${c.bg};
        --blob-dur:${c.dur}; --blob-delay:${c.delay};
      `;
      document.body.appendChild(blob);
    });
  }

  /* ── Gradient hero name ── */
  function initHeroName() {
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (!nameEl || nameEl.dataset.lqSplit) return;
    nameEl.dataset.lqSplit = '1';

    const text  = nameEl.textContent.trim();
    const words = text.split(/\s+/);
    if (words.length < 2) {
      nameEl.classList.add('lq-word-1');
      return;
    }

    nameEl.innerHTML = words.map((w, i) =>
      `<span class="lq-word-${(i % 2) + 1}" style="display:inline-block;margin-right:0.25em">${w}</span>`
    ).join('');
  }

  /* ── Liquid cursor ── */
  function initCursor() {
    if (window.matchMedia('(pointer: coarse)').matches) return;

    const outer = document.createElement('div');
    outer.id = 'lq-cursor-outer';
    outer.style.cssText = `
      position:fixed; pointer-events:none; z-index:99999;
      width:36px; height:36px;
      border-radius:50%;
      border:1.5px solid rgba(124,58,237,0.6);
      transform:translate(-50%,-50%);
      transition:width .3s cubic-bezier(.34,1.56,.64,1),
                 height .3s cubic-bezier(.34,1.56,.64,1),
                 border-color .2s, opacity .2s;
      opacity:0;
      mix-blend-mode:screen;
    `;

    const dot = document.createElement('div');
    dot.id = 'lq-cursor-dot';
    dot.style.cssText = `
      position:fixed; pointer-events:none; z-index:100000;
      width:6px; height:6px;
      border-radius:50%;
      background:rgba(168,85,247,0.9);
      box-shadow:0 0 12px rgba(124,58,237,0.8);
      transform:translate(-50%,-50%);
      transition:width .18s, height .18s, opacity .18s;
      opacity:0;
    `;

    /* Ink trail — 4 droplets */
    const trail = Array.from({ length: 4 }, (_, i) => {
      const t = document.createElement('div');
      t.style.cssText = `
        position:fixed; pointer-events:none;
        z-index:99997;
        width:${5 - i}px; height:${5 - i}px;
        border-radius:50%;
        background:rgba(124,58,237,${0.25 - i*0.06});
        transform:translate(-50%,-50%);
        opacity:0;
        transition:opacity .1s;
      `;
      document.body.appendChild(t);
      return t;
    });

    document.body.appendChild(outer);
    document.body.appendChild(dot);
    document.body.classList.add('lq-cursor-active');

    let mx = 0, my = 0;
    let ox = 0, oy = 0;
    const trailPos = trail.map(() => ({ x:0, y:0 }));
    const LAGS = [0.10, 0.07, 0.05, 0.03];

    _on(document, 'mousemove', (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx+'px'; dot.style.top = my+'px';
      dot.style.opacity = '1';
      outer.style.opacity = '1';
      trail.forEach(t => t.style.opacity = '1');
    }, { passive: true });

    _on(document, 'mouseleave', () => {
      dot.style.opacity  = '0';
      outer.style.opacity = '0';
      trail.forEach(t => t.style.opacity = '0');
    });

    _on(document, 'mouseover', (e) => {
      const isI = e.target.matches('button,a,.project-card,.skill-tag,[contenteditable]');
      if (isI) {
        outer.style.width  = '52px';
        outer.style.height = '52px';
        outer.style.borderColor = 'rgba(168,85,247,0.8)';
        dot.style.width = dot.style.height = '10px';
      } else {
        outer.style.width = outer.style.height = '36px';
        outer.style.borderColor = 'rgba(124,58,237,0.6)';
        dot.style.width = dot.style.height = '6px';
      }
    });

    /* Smooth outer ring + trail */
    (function loop() {
      if (!_active) return;
      requestAnimationFrame(loop);

      ox += (mx - ox) * 0.12;
      oy += (my - oy) * 0.12;
      outer.style.left = ox + 'px';
      outer.style.top  = oy + 'px';

      /* Ink trail follows with increasing lag */
      trailPos.forEach((pos, i) => {
        const prev = i === 0 ? { x: mx, y: my } : trailPos[i - 1];
        pos.x += (prev.x - pos.x) * LAGS[i];
        pos.y += (prev.y - pos.y) * LAGS[i];
        trail[i].style.left = pos.x + 'px';
        trail[i].style.top  = pos.y + 'px';
      });
    })();
  }

  /* ── Section reveal — dissolve up ── */
  function initReveal() {
    const style = document.createElement('style');
    style.id = 'lq-reveal-style';
    style.textContent = `
      [data-theme="liquid"] .project-card,
      .theme-liquid .project-card {
        opacity: 0;
        transform: translateY(28px) scale(0.97);
        transition: opacity 0.65s ease,
                    transform 0.65s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="liquid"] .project-card.lq-revealed,
      .theme-liquid .project-card.lq-revealed {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      [data-theme="liquid"] .section-label,
      .theme-liquid .section-label {
        opacity: 0; transform: translateY(12px);
        transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.16,1,0.3,1);
      }
      [data-theme="liquid"] .section-label.lq-revealed,
      .theme-liquid .section-label.lq-revealed {
        opacity: 1; transform: translateY(0);
      }
    `;
    document.head.appendChild(style);

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el  = entry.target;
        const all = [...document.querySelectorAll('.project-card')];
        const i   = all.indexOf(el);
        const delay = el.classList.contains('project-card') ? (i % 3) * 110 : 0;
        setTimeout(() => el.classList.add('lq-revealed'), delay);
        obs.unobserve(el);
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -24px 0px' });

    document.querySelectorAll('.project-card, .section-label').forEach(el => obs.observe(el));
    _observers.push(obs);
  }

  /* ── Skills stagger ── */
  function initSkillReveal() {
    const style = document.getElementById('lq-skill-style') || document.createElement('style');
    style.id = 'lq-skill-style';
    style.textContent = `
      [data-theme="liquid"] .skill-tag:not(.skill-tag--add),
      .theme-liquid .skill-tag:not(.skill-tag--add) {
        opacity:0; transform:scale(0.85);
        transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }
      [data-theme="liquid"] .skill-tag.lq-revealed,
      .theme-liquid .skill-tag.lq-revealed {
        opacity:1; transform:scale(1);
      }
    `;
    document.head.appendChild(style);

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const tags = [...document.querySelectorAll('.skill-tag:not(.skill-tag--add)')];
        tags.forEach((tag, i) => setTimeout(() => tag.classList.add('lq-revealed'), i * 50));
        obs.disconnect();
      });
    }, { threshold: 0.1 });

    const container = document.querySelector('.skills-container');
    if (container) obs.observe(container);
    _observers.push(obs);
  }

  /* ── Featured card blob border ── */
  function initFeaturedBorder() {
    const featured = document.querySelector('.project-card--featured');
    if (!featured || featured.dataset.lqBlob) return;
    featured.dataset.lqBlob = '1';

    let phase = 0;
    const SHAPES = [
      '60% 40% 55% 45% / 45% 55% 40% 60%',
      '50% 50% 45% 55% / 55% 45% 60% 40%',
      '40% 60% 50% 50% / 60% 40% 50% 50%',
      '55% 45% 60% 40% / 40% 60% 45% 55%',
      '45% 55% 40% 60% / 50% 50% 55% 45%',
    ];

    function morphBorder() {
      if (!_active || !featured.closest('[data-theme="liquid"], .theme-liquid')) return;
      phase = (phase + 1) % SHAPES.length;
      featured.style.borderRadius = SHAPES[phase];
      featured.style.transition = 'border-radius 3s cubic-bezier(0.45,0,0.55,1)';
      setTimeout(morphBorder, 3000);
    }
    morphBorder();
  }

  /* ── Mouse tracking ── */
  function initMouseTracking() {
    _on(window, 'mousemove', (e) => {
      _mouseX = e.clientX;
      _mouseY = e.clientY;
    }, { passive: true });
  }

  /* ── Mutation observer ── */
  function initMutationObserver() {
    const grid = document.querySelector('.projects-grid, [data-projects-grid]');
    if (!grid) return;
    const obs = new MutationObserver(() => {
      _t(() => { initCardMagnetism(); initSkillSprings(); }, 80);
    });
    obs.observe(grid, { childList: true });
    _observers.push(obs);
  }

  /* ══════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════ */
  function init() {
    if (_active) return;
    _active = true;

    requestAnimationFrame(() => {
      initBlobs();
      initHeroName();
      initCursor();
      initReveal();
      initSkillReveal();
      initFeaturedBorder();
      initMouseTracking();
      initCardMagnetism();
      initSkillSprings();
      runPhysics();

      /* WebGL — try; fallback already showing */
      _t(() => {
        if (!_active) return;
        const ok = initWebGL();
        if (ok) renderFluid();
      }, 100);

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

    if (_fluidRaf) { cancelAnimationFrame(_fluidRaf); _fluidRaf = null; }

    /* WebGL cleanup */
    if (_gl) {
      if (_prog)        _gl.deleteProgram(_prog);
      if (_displayProg) _gl.deleteProgram(_displayProg);
      if (_texA) _gl.deleteTexture(_texA);
      if (_texB) _gl.deleteTexture(_texB);
      if (_fbA)  _gl.deleteFramebuffer(_fbA);
      if (_fbB)  _gl.deleteFramebuffer(_fbB);
      if (_buf)  _gl.deleteBuffer(_buf);
      _gl = null;
    }

    /* DOM */
    document.getElementById('lq-canvas')?.remove();
    document.getElementById('lq-cursor-outer')?.remove();
    document.getElementById('lq-cursor-dot')?.remove();
    document.getElementById('lq-reveal-style')?.remove();
    document.getElementById('lq-skill-style')?.remove();
    document.querySelectorAll('.lq-bg-fallback, .lq-blob').forEach(el => el.remove());
    document.querySelectorAll('#lq-cursor-dot, [id^="lq-trail"]').forEach(el => el.remove());
    document.querySelectorAll('[style*="lq-trail"]').forEach(el => el.remove());

    /* Find & remove ink trail dots (no id, created inline) */
    document.querySelectorAll('div').forEach(el => {
      if (el.style.zIndex === '99997' && el.style.borderRadius === '50%') el.remove();
    });

    document.body.classList.remove('lq-cursor-active');

    /* Reset hero name */
    const nameEl = document.querySelector('.portfolio-hero__name');
    if (nameEl?.dataset?.lqSplit) {
      const words = [...nameEl.querySelectorAll('[class^="lq-word"]')];
      nameEl.textContent = words.map(w => w.textContent).join(' ');
      delete nameEl.dataset.lqSplit;
    }

    /* Reset cards */
    document.querySelectorAll('.project-card').forEach(card => {
      card.classList.remove('lq-revealed');
      card.style.transform   = '';
      card.style.boxShadow   = '';
      card.style.transition  = '';
      card.style.borderRadius = '';
      delete card.dataset.lqBlob;
    });

    /* Reset skills */
    document.querySelectorAll('.skill-tag').forEach(tag => {
      tag.classList.remove('lq-revealed');
      tag.style.transform = '';
      tag.style.opacity   = '';
    });

    /* Reset labels */
    document.querySelectorAll('.section-label').forEach(el => {
      el.classList.remove('lq-revealed');
      el.style.opacity   = '';
      el.style.transform = '';
    });
  }

  window.LiquidFX = { init, destroy };

})();