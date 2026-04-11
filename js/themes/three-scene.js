/**
 * three-scene.js — Three.js Space Particle System
 *
 * Lazy-loaded ONLY when user switches to 'space' theme.
 * Activated by: Portfolio.loadThemeScript('space') → SpaceFX.init()
 * Exposed as: window.SpaceFX
 *
 * Features:
 *  1. Starfield particle system (3000 stars, depth-sorted)
 *  2. Nebula cloud clusters (colored particle groups)
 *  3. Parallax on scroll
 *  4. Subtle auto-rotation
 *  5. Mouse parallax tilt
 *  6. Responsive — resizes with window
 *  7. Full cleanup on destroy()
 */

(function () {
  'use strict';

  let _scene, _camera, _renderer, _starField, _nebulaClouds;
  let _animFrameId = null;
  let _active = false;
  let _canvas = null;
  let _scrollY = 0;
  let _mouseX = 0, _mouseY = 0;

  /* ── Config ─────────────────────────────────────── */
  const CONFIG = {
    starCount:        3000,
    nebulaCount:      800,
    starSpread:       2000,
    nebulaSpread:     1200,
    cameraZ:          600,
    rotationSpeed:    0.00008,
    parallaxStrength: 0.00015,
    mouseStrength:    0.00008,
    starSizes:        [0.8, 1.2, 1.8],
    starColors: [
      0xffffff,   // white
      0xffe8c0,   // warm
      0xc0d8ff,   // cool blue
      0xa078ff,   // purple
      0x78d4ff,   // cyan
      0xffd87a,   // gold
    ],
    nebulaClusters: [
      { color: 0x6432c8, x: -400, y: 300,  z: -500, spread: 300, count: 200 },
      { color: 0x1e64dc, x:  500, y: -200, z: -600, spread: 250, count: 180 },
      { color: 0xb43c78, x:  -50, y: -400, z: -400, spread: 200, count: 180 },
      { color: 0xa078ff, x:  300, y:  200, z: -300, spread: 150, count: 120 },
      { color: 0x78d4ff, x: -300, y:  100, z: -700, spread: 220, count: 120 },
    ],
  };

  /* ── Wait for Three.js to be available ─────────── */
  function waitForThree(cb) {
    if (window.THREE) {
      cb();
      return;
    }

    // Load Three.js if not already present
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.onload = cb;
    script.onerror = () => console.error('[SpaceFX] Failed to load Three.js');
    document.head.appendChild(script);
  }

  /* ── Scene Setup ──────────────────────────────── */
  function buildScene() {
    const THREE = window.THREE;

    // Scene
    _scene = new THREE.Scene();

    // Camera
    _camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      5000
    );
    _camera.position.z = CONFIG.cameraZ;

    // Renderer
    _canvas = document.createElement('canvas');
    _canvas.id = 'space-canvas';

    _renderer = new THREE.WebGLRenderer({
      canvas: _canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
    });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(window.innerWidth, window.innerHeight);
    _renderer.setClearColor(0x000000, 0);

    // Insert canvas as first child of body
    document.body.insertBefore(_canvas, document.body.firstChild);

    buildStarField(THREE);
    buildNebulaClouds(THREE);
  }

  /* ── Star Field ───────────────────────────────── */
  function buildStarField(THREE) {
    const positions = new Float32Array(CONFIG.starCount * 3);
    const colors    = new Float32Array(CONFIG.starCount * 3);
    const sizes     = new Float32Array(CONFIG.starCount);

    const colorObjects = CONFIG.starColors.map(c => new THREE.Color(c));
    const spread = CONFIG.starSpread;

    for (let i = 0; i < CONFIG.starCount; i++) {
      const i3 = i * 3;
      // Distribute in sphere
      positions[i3]     = (Math.random() - 0.5) * spread * 2;
      positions[i3 + 1] = (Math.random() - 0.5) * spread * 2;
      positions[i3 + 2] = (Math.random() - 0.5) * spread * 2 - 200;

      // Random color with bias toward white
      const col = colorObjects[Math.random() < 0.6 ? 0 : Math.floor(Math.random() * colorObjects.length)];
      colors[i3]     = col.r;
      colors[i3 + 1] = col.g;
      colors[i3 + 2] = col.b;

      // Random size
      sizes[i] = CONFIG.starSizes[Math.floor(Math.random() * CONFIG.starSizes.length)];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Point material — use vertex colors, variable size
    const mat = new THREE.PointsMaterial({
      size: 1.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
    });

    _starField = new THREE.Points(geo, mat);
    _scene.add(_starField);
  }

  /* ── Nebula Clouds ────────────────────────────── */
  function buildNebulaClouds(THREE) {
    _nebulaClouds = new THREE.Group();

    CONFIG.nebulaClusters.forEach((cluster) => {
      const positions = new Float32Array(cluster.count * 3);
      const colors    = new Float32Array(cluster.count * 3);
      const col = new THREE.Color(cluster.color);

      for (let i = 0; i < cluster.count; i++) {
        const i3 = i * 3;
        // Gaussian-ish distribution around cluster center
        const r = cluster.spread;
        positions[i3]     = cluster.x + (Math.random() - 0.5) * r;
        positions[i3 + 1] = cluster.y + (Math.random() - 0.5) * r * 0.6;
        positions[i3 + 2] = cluster.z + (Math.random() - 0.5) * r * 0.4;

        // Add brightness variation
        const brightness = 0.3 + Math.random() * 0.7;
        colors[i3]     = col.r * brightness;
        colors[i3 + 1] = col.g * brightness;
        colors[i3 + 2] = col.b * brightness;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.PointsMaterial({
        size: 2.5 + Math.random() * 2,
        vertexColors: true,
        transparent: true,
        opacity: 0.35,
        sizeAttenuation: true,
        depthWrite: false,
        blending: window.THREE.AdditiveBlending,
      });

      _nebulaClouds.add(new THREE.Points(geo, mat));
    });

    _scene.add(_nebulaClouds);
  }

  /* ── Animation Loop ───────────────────────────── */
  function animate() {
    _animFrameId = requestAnimationFrame(animate);
    if (!_active) return;

    const time = Date.now() * 0.001;

    // Slow auto-rotation
    _starField.rotation.y += CONFIG.rotationSpeed;
    _starField.rotation.x += CONFIG.rotationSpeed * 0.4;

    // Nebula counter-rotation (creates depth illusion)
    _nebulaClouds.rotation.y -= CONFIG.rotationSpeed * 0.6;

    // Scroll parallax — move camera slightly
    const targetCamY = -_scrollY * CONFIG.parallaxStrength * 100;
    _camera.position.y += (targetCamY - _camera.position.y) * 0.05;

    // Mouse parallax
    const targetCamX = _mouseX * CONFIG.mouseStrength * 80;
    _camera.position.x += (targetCamX - _camera.position.x) * 0.04;

    // Subtle camera sway
    _camera.position.y += Math.sin(time * 0.2) * 0.3;
    _camera.lookAt(0, 0, 0);

    _renderer.render(_scene, _camera);
  }

  /* ── Event Handlers ───────────────────────────── */
  function onScroll() {
    _scrollY = window.scrollY;
  }

  function onMouseMove(e) {
    _mouseX = e.clientX - window.innerWidth / 2;
    _mouseY = e.clientY - window.innerHeight / 2;
  }

  function onResize() {
    if (!_renderer) return;
    _camera.aspect = window.innerWidth / window.innerHeight;
    _camera.updateProjectionMatrix();
    _renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ── CSS Parallax for hero content ───────────── */
  function initHeroParallax() {
    const parallaxEls = document.querySelectorAll('[data-parallax]');
    if (!parallaxEls.length) return;

    function updateParallax() {
      const scrolled = window.scrollY;
      parallaxEls.forEach((el) => {
        const speed = parseFloat(el.dataset.parallax) || 0.3;
        el.style.transform = `translateY(${scrolled * speed}px)`;
      });
    }

    window.addEventListener('scroll', updateParallax, { passive: true });
    return updateParallax; // return for cleanup
  }

  /* ── Init CSS decorations ─────────────────────── */
  function initCSSDecorations() {
    // Add nebula layer div if missing
    if (!document.querySelector('.space-nebula-layer')) {
      const layer = document.createElement('div');
      layer.className = 'space-nebula-layer';
      document.body.insertBefore(layer, document.body.firstChild);
    }

    // Add star layer
    if (!document.querySelector('.space-stars')) {
      const stars = document.createElement('div');
      stars.className = 'space-stars';
      document.body.insertBefore(stars, document.body.firstChild);
    }

    // Add mid nebula
    if (!document.querySelector('.space-nebula-mid')) {
      const mid = document.createElement('div');
      mid.className = 'space-nebula-mid';
      document.body.appendChild(mid);
    }

    // Add shooting stars
    const shootCount = 3;
    for (let i = 0; i < shootCount; i++) {
      if (!document.querySelector(`.shooting-star[data-idx="${i}"]`)) {
        const star = document.createElement('div');
        star.className = 'shooting-star';
        star.dataset.idx = i;
        star.style.setProperty('--shoot-delay', `${i * 4 + 2}s`);
        star.style.top = `${10 + i * 15}%`;
        document.body.appendChild(star);
      }
    }

    // Add parallax targets to hero elements
    const heroContent = document.querySelector('.hero-content, .hero-copy, .hero');
    if (heroContent && !heroContent.dataset.parallax) {
      heroContent.dataset.parallax = '0.15';
    }
  }

  /* ── Public API ───────────────────────────────── */
  let _parallaxCleanup = null;
  let _boundScroll, _boundMouse, _boundResize;

  function init() {
    if (_active) return;
    _active = true;

    // Init CSS decorations first (they show while Three.js loads)
    initCSSDecorations();
    _parallaxCleanup = initHeroParallax();

    // Bind events
    _boundScroll = onScroll;
    _boundMouse  = onMouseMove;
    _boundResize = onResize;
    window.addEventListener('scroll', _boundScroll, { passive: true });
    window.addEventListener('mousemove', _boundMouse, { passive: true });
    window.addEventListener('resize', _boundResize);

    // Load Three.js & build scene
    waitForThree(() => {
      if (!_active) return; // user may have switched themes while loading
      buildScene();
      animate();
    });
  }

  function destroy() {
    if (!_active) return;
    _active = false;

    // Stop animation
    if (_animFrameId) {
      cancelAnimationFrame(_animFrameId);
      _animFrameId = null;
    }

    // Remove events
    window.removeEventListener('scroll', _boundScroll);
    window.removeEventListener('mousemove', _boundMouse);
    window.removeEventListener('resize', _boundResize);

    // Remove canvas
    if (_canvas && _canvas.parentNode) {
      _canvas.parentNode.removeChild(_canvas);
      _canvas = null;
    }

    // Dispose Three.js objects
    if (_renderer) {
      _renderer.dispose();
      _renderer = null;
    }

    if (_scene) {
      _scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      _scene = null;
    }

    _starField    = null;
    _nebulaClouds = null;
    _camera       = null;

    // Remove CSS decoration elements
    ['.space-nebula-layer', '.space-stars', '.space-nebula-mid', '.shooting-star']
      .forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));

    // Remove parallax transforms
    document.querySelectorAll('[data-parallax]').forEach(el => {
      el.style.transform = '';
    });
  }

  window.SpaceFX = { init, destroy };
})();
