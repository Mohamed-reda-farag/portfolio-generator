/**
 * portfolio-builder.js — window-scoped IIFE
 * منطق الـ 7-step wizard لصفحة portfolio-builder.html
 *
 * Depends on: Supabase JS SDK (global), auth.js (window.Auth, window._supabaseClient)
 */

;(function () {
  'use strict';

  const STORAGE_KEY  = 'pg_builder_draft_v1';
  const TOTAL_STEPS  = 7;
  const STEP_NAMES   = ['Personal Info', 'Skills', 'Projects', 'Experience', 'Education', 'Contact', 'Theme & Publish'];

  const SKILL_SUGGESTIONS = [
    'React', 'Node.js', 'Python', 'TypeScript', 'JavaScript', 'Vue.js',
    'Next.js', 'Tailwind CSS', 'PostgreSQL', 'MongoDB', 'Docker', 'AWS',
    'Git', 'GraphQL', 'Express', 'HTML/CSS',
  ];

  // نفس قائمة الـ themes في portfolio.js (THEMES.free / THEMES.pro)
  const FREE_THEMES = [
    { id: 'light',   label: 'Light',   icon: '☀️' },
    { id: 'dark',    label: 'Dark',    icon: '🌙' },
    { id: 'minimal', label: 'Minimal', icon: '◻'  },
  ];
  const PRO_THEMES = [
    { id: 'editorial', label: 'Editorial', icon: '📰' },
    { id: 'noir',      label: 'Noir',      icon: '◼'  },
    { id: 'blueprint', label: 'Blueprint', icon: '📐' },
    { id: 'terminal',  label: 'Terminal',  icon: '>_' },
    { id: 'liquid',    label: 'Liquid',    icon: '💧' },
    { id: 'glass3d',   label: 'Glass 3D',  icon: '💎' },
    { id: 'cyberpunk', label: 'Cyberpunk', icon: '⚡' },
    { id: 'space',     label: 'Space',     icon: '🚀' },
  ];

  function _defaultState() {
    return {
      step: 1,
      fullName: '', jobTitle: '', bio: '', photoUrl: '', location: '',
      skills: [],
      projects: [],
      experience: [],
      education: [],
      email: '', linkedinUrl: '', githubUrl: '', twitterUrl: '', websiteUrl: '',
      selectedTheme: 'dark', // مطابق لـ DEFAULT_FREE_THEME في portfolio.js
    };
  }

  let state          = _defaultState();
  let _currentUser    = null;
  let _isPro          = false;
  // Fix 1 — key مرتبط بالـ user ID (يُضبط في init() بعد getUser())
  let _storageKey     = STORAGE_KEY; // fallback للـ base key قبل التهيئة

  // ─── localStorage persistence ──────────────────────────────────
  function saveState() {
    try { localStorage.setItem(_storageKey, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(_storageKey);
      if (raw) state = Object.assign(_defaultState(), JSON.parse(raw));
    } catch (e) { /* ignore corrupt draft */ }
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }
  const debouncedSave = debounce(saveState, 400);

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // Fix 3 — protocol validation لـ URL fields (XSS prevention)
  function sanitizeUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  // ─── Helpers مطابقين لمنطق portfolio.js ────────────────────────

  /** نفس _slugify بتاع portfolio.js — لازم تطابق تمامًا */
  function _slugifyProject(str) {
    return 'custom-' + String(str || 'project')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50)
      || 'custom-project';
  }

  /** slug للـ portfolio نفسه (من full name) — بدون prefix */
  function _slugifyName(str) {
    return String(str || 'user')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      || 'user';
  }

  /** يحوّل GitHub URL أو @username لاسم username نضيف بس (مش URL كامل) */
  function _extractGithubUsername(input) {
    if (!input) return '';
    const trimmed = input.trim();
    const m = trimmed.match(/github\.com\/([A-Za-z0-9-]+)/i);
    if (m) return m[1];
    return trimmed.replace(/^@/, '');
  }

  /** نفس منطق display_name في portfolio.js/portfolio.html — اسم العرض
   * من name مباشرة، أو fallback من github_repo_name لو الاسم مش موجود */
  function _displayName(p) {
    return p.name
      || (p.github_repo_name ? p.github_repo_name.replace(/^custom-/, '') : '')
      || 'Untitled Project';
  }

  async function _generateUniqueSlug(sb, fullName) {
    const base = _slugifyName(fullName);
    let candidate = base;
    for (let i = 0; i < 5; i++) {
      const { data } = await sb.from('portfolios').select('id').eq('slug', candidate).maybeSingle();
      if (!data) return candidate;
      candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  function _buildCustomSections() {
    const sections = [];
    if (state.experience.length > 0) {
      sections.push({
        type: 'experience',
        title: 'Work Experience',
        items: state.experience.map(e => ({
          company: e.company,
          role: e.role,
          from: e.from,
          to: e.isPresent ? 'present' : e.to,
          description: e.description,
        })),
      });
    }
    if (state.education.length > 0) {
      sections.push({
        type: 'education',
        title: 'Education',
        items: state.education.map(ed => ({
          institution: ed.institution,
          degree: ed.degree,
          year: ed.year,
        })),
      });
    }
    // Fix 8 — احفظ twitterUrl/websiteUrl في custom_sections لعدم وجود columns لهما في portfolios
    if (state.twitterUrl || state.websiteUrl) {
      sections.push({
        type: 'contact_meta',
        twitter: state.twitterUrl || null,
        website: state.websiteUrl || null,
      });
    }
    return sections;
  }

  // ─── Loading overlay ────────────────────────────────────────────
  function showLoadingOverlay(text) {
    const t = $('loading-overlay-text');
    if (t) t.textContent = text || 'Working…';
    $('loading-overlay')?.classList.add('is-visible');
  }
  function hideLoadingOverlay() {
    $('loading-overlay')?.classList.remove('is-visible');
  }

  // ─── AI Improve (Bio / Skills) ──────────────────────────────────
  // ⚠️ تأكيد بعد مراجعة ai.js: مفيش Edge Function جاهزة لتحسين نص.
  // الموجود بس هو "generate" (في js/ai.js → window.AI.generate) وده
  // مخصص لتوليد portfolio كامل من GitHub data — contract مختلف تمامًا
  // ({githubData, jobTitle, generationId} → {success, data:{bio, skills, projects}})
  // ومش قابل لإعادة الاستخدام هنا من غير تعديل جوهري في الـ Edge Function نفسها.
  //
  // الكود تحت ده بيستدعي function اسمها "improve-text" مش موجودة لسه —
  // لازم تُنشأ من جديد على Supabase Edge Functions بالـ contract ده:
  //   input:  { fieldType: 'bio'|'skills', currentValue, context }
  //   output: { suggestion: string }  (أو { text } / { result })
  // غيّر اسم الـ function هنا (sb.functions.invoke) لو سميتها حاجة تانية.
  async function improveWithAI(fieldType, currentValue, context, onResult) {
    const sb = window._supabaseClient;
    if (!sb) {
      window.toast?.('AI service unavailable.', 'error');
      return;
    }
    try {
      const { data, error } = await sb.functions.invoke('improve-text', {
        body: { fieldType, currentValue, context },
      });
      if (error) throw error;
      const suggestion = data?.suggestion ?? data?.text ?? data?.result ?? null;
      if (!suggestion) throw new Error('Empty AI response');
      onResult(suggestion);
    } catch (err) {
      console.error('[Builder] improveWithAI error:', err);
      window.toast?.("AI suggestions aren't available right now.", 'error');
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP PANELS — HTML
  ═══════════════════════════════════════════════════════════════ */

  function _panel1() {
    return `
    <section class="step-panel" data-step="1">
      <h2 class="step-panel__title">Personal Info</h2>
      <p class="step-panel__sub">Tell us a bit about yourself.</p>

      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-fullname">Full Name <span class="req">*</span></label>
          <input id="f-fullname" class="input" data-field="fullName" type="text" placeholder="Jane Doe" autocomplete="name" />
        </div>
      </div>

      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-jobtitle">Job Title / Role <span class="req">*</span></label>
          <input id="f-jobtitle" class="input" data-field="jobTitle" type="text" placeholder="Frontend Developer" />
        </div>
      </div>

      <div class="field-row">
        <div class="field-label-row">
          <label class="input-label" for="f-bio">Bio / About Me</label>
          <button class="ai-improve-btn" id="bio-ai-btn" type="button">Improve with AI 🤖</button>
        </div>
        <textarea id="f-bio" class="textarea" data-field="bio" maxlength="500"
          placeholder="A short intro about who you are and what you do…"></textarea>
        <div class="char-counter" id="bio-counter">0 / 500</div>
        <div class="ai-suggestion-box" id="bio-ai-box">
          <div id="bio-ai-text"></div>
          <div class="ai-suggestion-box__actions">
            <button class="btn btn--primary btn--sm" id="bio-ai-accept" type="button">Accept</button>
            <button class="btn btn--ghost btn--sm" id="bio-ai-edit" type="button">Edit</button>
            <button class="btn btn--ghost btn--sm" id="bio-ai-reject" type="button">Reject</button>
          </div>
        </div>
      </div>

      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-photo">Profile Photo URL</label>
          <input id="f-photo" class="input" data-field="photoUrl" type="url" placeholder="https://example.com/photo.jpg" />
          <span class="input-hint">Optional — a square image works best.</span>
        </div>
      </div>

      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-location">Location</label>
          <input id="f-location" class="input" data-field="location" type="text" placeholder="Cairo, Egypt" />
        </div>
      </div>
    </section>`;
  }

  function _panel2() {
    return `
    <section class="step-panel" data-step="2">
      <h2 class="step-panel__title">Skills &amp; Technologies</h2>
      <p class="step-panel__sub">Add the skills you want to show off.</p>

      <div class="field-label-row" style="margin-bottom: var(--sp-2);">
        <label class="input-label">Your Skills</label>
        <button class="ai-improve-btn" id="skills-ai-btn" type="button">Improve with AI 🤖</button>
      </div>
      <div class="chip-list" id="skills-chip-list"></div>
      <div class="chip-input-row">
        <input id="skill-input" class="input" type="text" placeholder="Type a skill and press Enter" autocomplete="off" />
        <button class="btn btn--ghost btn--sm" id="skill-add-btn" type="button">+ Add</button>
      </div>

      <div class="suggestion-row" id="skill-suggestions"></div>
      <div class="suggestion-row" id="skill-ai-suggestions" style="margin-top: var(--sp-2);"></div>
    </section>`;
  }

  function _panel3() {
    return `
    <section class="step-panel" data-step="3">
      <h2 class="step-panel__title">Projects</h2>
      <p class="step-panel__sub">Showcase the projects you're proud of.</p>

      <div id="projects-list"></div>
      <button class="btn btn--ghost btn--sm" id="add-project-btn" type="button">+ Add Project</button>
    </section>`;
  }

  function _panel4() {
    return `
    <section class="step-panel" data-step="4">
      <h2 class="step-panel__title">Work Experience <span class="optional-tag">(optional)</span></h2>
      <p class="step-panel__sub">Add your previous roles, if you'd like.</p>

      <div id="experience-list"></div>
      <div id="experience-mini-form-wrap"></div>
      <button class="btn btn--ghost btn--sm" id="add-experience-btn" type="button">+ Add Position</button>
    </section>`;
  }

  function _panel5() {
    return `
    <section class="step-panel" data-step="5">
      <h2 class="step-panel__title">Education <span class="optional-tag">(optional)</span></h2>
      <p class="step-panel__sub">Add your academic background, if relevant.</p>

      <div id="education-list"></div>
      <div id="education-mini-form-wrap"></div>
      <button class="btn btn--ghost btn--sm" id="add-education-btn" type="button">+ Add Education</button>
    </section>`;
  }

  function _panel6() {
    return `
    <section class="step-panel" data-step="6">
      <h2 class="step-panel__title">Contact &amp; Links</h2>
      <p class="step-panel__sub">How should people get in touch?</p>

      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-email">Email <span class="req">*</span></label>
          <input id="f-email" class="input" data-field="email" type="email" placeholder="you@example.com" />
        </div>
      </div>
      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-linkedin">LinkedIn URL</label>
          <input id="f-linkedin" class="input" data-field="linkedinUrl" type="url" placeholder="https://linkedin.com/in/you" />
        </div>
      </div>
      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-github">GitHub URL</label>
          <input id="f-github" class="input" data-field="githubUrl" type="text" placeholder="https://github.com/you or just your-username" />
          <span class="input-hint">Optional — add this manually, or connect GitHub from your dashboard instead.</span>
        </div>
      </div>
      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-twitter">Twitter / X URL</label>
          <input id="f-twitter" class="input" data-field="twitterUrl" type="url" placeholder="https://x.com/you" />
        </div>
      </div>
      <div class="field-row">
        <div class="input-group">
          <label class="input-label" for="f-website">Personal Website</label>
          <input id="f-website" class="input" data-field="websiteUrl" type="url" placeholder="https://yoursite.com" />
        </div>
      </div>
    </section>`;
  }

  function _panel7() {
    return `
    <section class="step-panel" data-step="7">
      <h2 class="step-panel__title">Theme &amp; Publish</h2>
      <p class="step-panel__sub">Pick a look for your portfolio. You can change it anytime later.</p>

      <div class="theme-section-label">Free Themes</div>
      <div class="theme-grid" id="free-theme-grid"></div>

      <div id="pro-theme-wrap"></div>
    </section>`;
  }

  function buildPanels() {
    $('step-panels').innerHTML = [
      _panel1(), _panel2(), _panel3(), _panel4(), _panel5(), _panel6(), _panel7(),
    ].join('');

    wireGenericFields();
    populateStaticFields();
    wireStep1();
    wireStep2();
    wireStep3();
    wireStep4();
    wireStep5();
  }

  /* ═══════════════════════════════════════════════════════════════
     GENERIC FIELD BINDING (data-field=* inputs)
  ═══════════════════════════════════════════════════════════════ */

  function wireGenericFields() {
    $('step-panels').addEventListener('input', (e) => {
      const field = e.target.dataset.field;
      if (!field) return;
      state[field] = e.target.value;
      e.target.classList.remove('is-error');
      if (field === 'bio') updateBioCounter();
      debouncedSave();
    });
  }

  function populateStaticFields() {
    document.querySelectorAll('[data-field]').forEach(el => {
      const f = el.dataset.field;
      if (state[f] !== undefined) el.value = state[f];
    });
    updateBioCounter();
  }

  function updateBioCounter() {
    const len = (state.bio || '').length;
    const counter = $('bio-counter');
    if (!counter) return;
    counter.textContent = `${len} / 500`;
    counter.classList.toggle('is-near-limit', len > 450);
    // Fix 7 — زامن حالة زر الـ AI بعد كل ضغطة
    const bioBtn = $('bio-ai-btn');
    if (bioBtn && !bioBtn.textContent.includes('Thinking')) {
      bioBtn.disabled = len < MIN_BIO_CHARS;
    }
  }

  function focusField(name, message) {
    const el = document.querySelector(`[data-field="${name}"]`);
    el?.classList.add('is-error', 'is-shaking');
    el?.focus();
    setTimeout(() => el?.classList.remove('is-shaking'), 400);
    return { valid: false, message };
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP 1 — Personal Info (AI improve for bio)
  ═══════════════════════════════════════════════════════════════ */

  const MIN_BIO_CHARS = 30; // Fix 7 — حد أدنى لتفعيل زر الـ AI

  function wireStep1() {
    // Fix 7 — ضبط الحالة الأولية للزر بناءً على البيانات المحفوظة
    function syncBioAiBtn() {
      const btn = $('bio-ai-btn');
      if (btn) btn.disabled = (state.bio?.length || 0) < MIN_BIO_CHARS;
    }
    syncBioAiBtn();

    $('bio-ai-btn').addEventListener('click', async () => {
      const btn = $('bio-ai-btn');
      btn.disabled = true;
      btn.textContent = 'Thinking…';
      await improveWithAI(
        'bio',
        state.bio,
        { jobTitle: state.jobTitle, name: state.fullName, skills: state.skills },
        (suggestion) => {
          $('bio-ai-text').textContent = suggestion;
          $('bio-ai-box').classList.add('is-visible');
        }
      );
      // Fix 7 — أعد الزر بناءً على الحد الأدنى بعد انتهاء الطلب
      syncBioAiBtn();
      btn.textContent = 'Improve with AI 🤖';
    });

    $('bio-ai-accept').addEventListener('click', () => {
      const suggestion = $('bio-ai-text').textContent;
      state.bio = suggestion;
      $('f-bio').value = suggestion;
      updateBioCounter();
      $('bio-ai-box').classList.remove('is-visible');
      saveState();
      window.toast?.('Bio updated ✓', 'success');
    });

    $('bio-ai-edit').addEventListener('click', () => {
      const suggestion = $('bio-ai-text').textContent;
      state.bio = suggestion;
      $('f-bio').value = suggestion;
      updateBioCounter();
      $('bio-ai-box').classList.remove('is-visible');
      $('f-bio').focus();
      saveState();
    });

    $('bio-ai-reject').addEventListener('click', () => {
      $('bio-ai-box').classList.remove('is-visible');
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP 2 — Skills (chips + AI suggestions)
  ═══════════════════════════════════════════════════════════════ */

  const MIN_SKILLS_COUNT = 1; // Fix 7 — حد أدنى لتفعيل زر الـ AI في الـ skills

  function wireStep2() {
    $('skill-add-btn').addEventListener('click', addSkillFromInput);
    $('skill-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSkillFromInput(); }
    });

    $('skills-ai-btn').addEventListener('click', async () => {
      const btn = $('skills-ai-btn');
      btn.disabled = true;
      btn.textContent = 'Thinking…';
      await improveWithAI(
        'skills',
        state.skills.join(', '),
        { jobTitle: state.jobTitle },
        (suggestion) => {
          const list = Array.isArray(suggestion)
            ? suggestion
            : String(suggestion).split(',').map(s => s.trim()).filter(Boolean);
          renderAISkillSuggestions(list);
        }
      );
      // Fix 7 — أعد الزر بناءً على الحد الأدنى بعد انتهاء الطلب
      btn.disabled = state.skills.length < MIN_SKILLS_COUNT;
      btn.textContent = 'Improve with AI 🤖';
    });
  }

  function addSkill(skill) {
    const val = String(skill || '').trim();
    if (!val || state.skills.includes(val) || state.skills.length >= 20) return;
    state.skills.push(val);
    renderSkillsChips();
    saveState();
  }

  function addSkillFromInput() {
    addSkill($('skill-input').value);
    $('skill-input').value = '';
    $('skill-input').focus();
  }

  function renderSkillsChips() {
    const list = $('skills-chip-list');
    list.innerHTML = '';
    state.skills.forEach((s, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${escapeHtml(s)} <button aria-label="Remove ${escapeHtml(s)}">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        state.skills.splice(i, 1);
        renderSkillsChips();
        saveState();
      });
      list.appendChild(chip);
    });

    const sugWrap = $('skill-suggestions');
    sugWrap.innerHTML = '';
    SKILL_SUGGESTIONS.filter(s => !state.skills.includes(s)).slice(0, 10).forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'suggestion-chip';
      b.textContent = '+ ' + s;
      b.addEventListener('click', () => addSkill(s));
      sugWrap.appendChild(b);
    });

    // Fix 7 — زامن حالة زر الـ AI بعد كل تغيير في الـ skills
    const skillsBtn = $('skills-ai-btn');
    if (skillsBtn && !skillsBtn.textContent.includes('Thinking')) {
      skillsBtn.disabled = state.skills.length < MIN_SKILLS_COUNT;
    }
  }

  function renderAISkillSuggestions(list) {
    const wrap = $('skill-ai-suggestions');
    wrap.innerHTML = '';
    list.filter(s => !state.skills.includes(s)).forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'suggestion-chip';
      b.textContent = '✨ ' + s;
      b.addEventListener('click', () => { addSkill(s); b.remove(); });
      wrap.appendChild(b);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP 3 — Projects (نفس نظام Custom Project Modal بتاع portfolio.js)
  ═══════════════════════════════════════════════════════════════ */

  function wireStep3() {
    $('add-project-btn').addEventListener('click', showAddProjectModal);
  }

  function renderProjectsList() {
    const wrap = $('projects-list');
    wrap.innerHTML = '';
    if (state.projects.length === 0) {
      wrap.innerHTML = '<div class="empty-hint">No projects added yet. Click "+ Add Project" below to add your first one.</div>';
      return;
    }
    state.projects.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.setAttribute('data-project-index', i);
      card.innerHTML = `
        <button class="item-card__remove" aria-label="Remove project">×</button>
        <h4 class="item-card__title">${escapeHtml(_displayName(p))}</h4>
        ${p.language ? `<p class="item-card__sub">${escapeHtml(p.language)}</p>` : ''}
        <p class="item-card__desc">${escapeHtml(p.description || '')}</p>
        ${(p.technologies && p.technologies.length)
          ? `<div class="item-card__tags">${p.technologies.map(t => `<span class="item-card__tag">${escapeHtml(t)}</span>`).join('')}</div>`
          : ''}
      `;
      card.querySelector('.item-card__remove').addEventListener('click', () => {
        state.projects.splice(i, 1);
        renderProjectsList();
        saveState();
      });
      wrap.appendChild(card);
    });
  }

  function showAddProjectModal() {
    document.getElementById('add-project-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'add-project-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Add Project');
    modal.innerHTML = `
      <div class="cpm-box">
        <div class="cpm-header">
          <span class="cpm-title">🔧 Add Project</span>
          <button class="cpm-close" id="apm-close-btn" aria-label="Close" type="button">✕</button>
        </div>
        <div class="cpm-body">
          <div class="cpm-field">
            <label class="input-label" for="apm-name">Project Name <span class="req">*</span></label>
            <input id="apm-name" class="input" type="text" placeholder="e.g. My Awesome App" autocomplete="off" />
          </div>
          <div class="cpm-field">
            <label class="input-label" for="apm-desc">Description <span class="req">*</span></label>
            <textarea id="apm-desc" class="textarea" rows="3" placeholder="What does it do, what's the tech stack…"></textarea>
          </div>
          <div class="cpm-field">
            <label class="input-label" for="apm-url">Live Demo / External URL</label>
            <input id="apm-url" class="input" type="url" placeholder="https://myapp.com" autocomplete="off" />
          </div>
          <div class="cpm-field">
            <label class="input-label">Technologies Used</label>
            <div class="chip-list" id="apm-tech-list"></div>
            <div class="chip-input-row">
              <input id="apm-tech-input" class="input" type="text" placeholder="e.g. React" autocomplete="off" />
              <button id="apm-tech-add-btn" class="btn btn--ghost btn--sm" type="button">+ Add</button>
            </div>
          </div>
          <div class="cpm-field">
            <label class="input-label" for="apm-lang">Main Language</label>
            <input id="apm-lang" class="input" type="text" placeholder="e.g. JavaScript" autocomplete="off" />
          </div>
          <div class="cpm-footer">
            <button id="apm-cancel-btn" class="btn btn--ghost btn--sm" type="button">Cancel</button>
            <button id="apm-submit-btn" class="btn btn--primary btn--sm" type="button">+ Add Project</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const techList     = [];
    const nameInput     = modal.querySelector('#apm-name');
    const descTextarea  = modal.querySelector('#apm-desc');
    const urlInput      = modal.querySelector('#apm-url');
    const techInput     = modal.querySelector('#apm-tech-input');
    const techListEl    = modal.querySelector('#apm-tech-list');

    function renderTechChips() {
      techListEl.innerHTML = '';
      techList.forEach((t, i) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = `${escapeHtml(t)} <button aria-label="Remove ${escapeHtml(t)}">×</button>`;
        chip.querySelector('button').addEventListener('click', () => {
          techList.splice(i, 1);
          renderTechChips();
        });
        techListEl.appendChild(chip);
      });
    }
    function addTech() {
      const val = techInput.value.trim();
      if (!val || techList.includes(val) || techList.length >= 10) return;
      techList.push(val);
      techInput.value = '';
      renderTechChips();
      techInput.focus();
    }
    modal.querySelector('#apm-tech-add-btn').addEventListener('click', addTech);
    techInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTech(); }
    });

    function close() { modal.remove(); }
    modal.querySelector('#apm-close-btn').addEventListener('click', close);
    modal.querySelector('#apm-cancel-btn').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', function _esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', _esc); }
    });

    modal.querySelector('#apm-submit-btn').addEventListener('click', () => {
      const name = nameInput.value.trim();
      const desc = descTextarea.value.trim();

      let valid = true;
      if (!name) {
        nameInput.classList.add('is-error', 'is-shaking');
        setTimeout(() => nameInput.classList.remove('is-shaking'), 400);
        valid = false;
      }
      if (!desc) {
        descTextarea.classList.add('is-error', 'is-shaking');
        setTimeout(() => descTextarea.classList.remove('is-shaking'), 400);
        if (valid) descTextarea.focus();
        valid = false;
      }
      if (!valid) return;

      // نحسب github_repo_name فورًا (نفس _slugify بتاع portfolio.js) عشان
      // الـ display_name يبقى متسق لو احتجنا نعرضه تاني من غير حقل name
      state.projects.push({
        name: name,
        github_repo_name: _slugifyProject(name),
        description: desc,
        url: sanitizeUrl(urlInput.value.trim()), // Fix 3 — protocol validation
        technologies: [...techList],
        language: modal.querySelector('#apm-lang').value.trim() || null,
      });

      renderProjectsList();
      saveState();
      window.toast?.(`"${name}" added`, 'success');
      close();
    });

    setTimeout(() => nameInput.focus(), 50);
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP 4 — Work Experience (mini-form)
  ═══════════════════════════════════════════════════════════════ */

  function wireStep4() {
    $('add-experience-btn').addEventListener('click', showExperienceMiniForm);
  }

  function renderExperienceList() {
    const wrap = $('experience-list');
    wrap.innerHTML = '';
    if (state.experience.length === 0) {
      wrap.innerHTML = '<div class="empty-hint">No work experience added yet — totally optional.</div>';
      return;
    }
    state.experience.forEach((e, i) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      const range = `${e.from || '—'} – ${e.isPresent ? 'Present' : (e.to || '—')}`;
      card.innerHTML = `
        <button class="item-card__remove" aria-label="Remove">×</button>
        <h4 class="item-card__title">${escapeHtml(e.role || '')} · ${escapeHtml(e.company || '')}</h4>
        <p class="item-card__sub">${escapeHtml(range)}</p>
        <p class="item-card__desc">${escapeHtml(e.description || '')}</p>
      `;
      card.querySelector('.item-card__remove').addEventListener('click', () => {
        state.experience.splice(i, 1);
        renderExperienceList();
        saveState();
      });
      wrap.appendChild(card);
    });
  }

  function showExperienceMiniForm() {
    const wrap = $('experience-mini-form-wrap');
    wrap.innerHTML = `
      <div class="mini-form">
        <div class="mini-form__grid">
          <div class="input-group">
            <label class="input-label">Company Name</label>
            <input id="exp-company" class="input" type="text" placeholder="Google" />
          </div>
          <div class="input-group">
            <label class="input-label">Job Title</label>
            <input id="exp-role" class="input" type="text" placeholder="Frontend Developer" />
          </div>
          <div class="input-group">
            <label class="input-label">Start Date</label>
            <input id="exp-from" class="input" type="month" />
          </div>
          <div class="input-group">
            <label class="input-label">End Date</label>
            <input id="exp-to" class="input" type="month" />
          </div>
        </div>
        <div class="checkbox-row" style="margin-bottom: var(--sp-4);">
          <input id="exp-present" type="checkbox" />
          <label for="exp-present">I currently work here</label>
        </div>
        <div class="input-group" style="margin-bottom: var(--sp-4);">
          <label class="input-label">Brief Description</label>
          <textarea id="exp-desc" class="textarea" rows="2" placeholder="What did you work on?"></textarea>
        </div>
        <div class="mini-form__actions">
          <button class="btn btn--ghost btn--sm" id="exp-cancel-btn" type="button">Cancel</button>
          <button class="btn btn--primary btn--sm" id="exp-save-btn" type="button">Add Position</button>
        </div>
      </div>
    `;
    $('exp-present').addEventListener('change', (e) => {
      $('exp-to').disabled = e.target.checked;
      if (e.target.checked) $('exp-to').value = '';
    });
    $('exp-cancel-btn').addEventListener('click', () => { wrap.innerHTML = ''; });
    $('exp-save-btn').addEventListener('click', () => {
      const company = $('exp-company').value.trim();
      const role    = $('exp-role').value.trim();
      if (!company || !role) {
        window.toast?.('Company and job title are required.', 'error');
        return;
      }
      state.experience.push({
        company, role,
        from: $('exp-from').value || '',
        to: $('exp-to').value || '',
        isPresent: $('exp-present').checked,
        description: $('exp-desc').value.trim(),
      });
      renderExperienceList();
      saveState();
      wrap.innerHTML = '';
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP 5 — Education (mini-form)
  ═══════════════════════════════════════════════════════════════ */

  function wireStep5() {
    $('add-education-btn').addEventListener('click', showEducationMiniForm);
  }

  function renderEducationList() {
    const wrap = $('education-list');
    wrap.innerHTML = '';
    if (state.education.length === 0) {
      wrap.innerHTML = '<div class="empty-hint">No education added yet — totally optional.</div>';
      return;
    }
    state.education.forEach((ed, i) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <button class="item-card__remove" aria-label="Remove">×</button>
        <h4 class="item-card__title">${escapeHtml(ed.degree || '')}</h4>
        <p class="item-card__sub">${escapeHtml(ed.institution || '')}${ed.year ? ' · ' + escapeHtml(ed.year) : ''}</p>
      `;
      card.querySelector('.item-card__remove').addEventListener('click', () => {
        state.education.splice(i, 1);
        renderEducationList();
        saveState();
      });
      wrap.appendChild(card);
    });
  }

  function showEducationMiniForm() {
    const wrap = $('education-mini-form-wrap');
    wrap.innerHTML = `
      <div class="mini-form">
        <div class="mini-form__grid">
          <div class="input-group">
            <label class="input-label">Institution Name</label>
            <input id="edu-institution" class="input" type="text" placeholder="Cairo University" />
          </div>
          <div class="input-group">
            <label class="input-label">Degree / Field of Study</label>
            <input id="edu-degree" class="input" type="text" placeholder="Computer Science" />
          </div>
        </div>
        <div class="input-group" style="margin-bottom: var(--sp-4); max-width: 200px;">
          <label class="input-label">Graduation Year</label>
          <input id="edu-year" class="input" type="number" min="1950" max="2100" placeholder="2024" />
        </div>
        <div class="mini-form__actions">
          <button class="btn btn--ghost btn--sm" id="edu-cancel-btn" type="button">Cancel</button>
          <button class="btn btn--primary btn--sm" id="edu-save-btn" type="button">Add Education</button>
        </div>
      </div>
    `;
    $('edu-cancel-btn').addEventListener('click', () => { wrap.innerHTML = ''; });
    $('edu-save-btn').addEventListener('click', () => {
      const institution = $('edu-institution').value.trim();
      const degree       = $('edu-degree').value.trim();
      if (!institution || !degree) {
        window.toast?.('Institution and degree are required.', 'error');
        return;
      }
      state.education.push({ institution, degree, year: $('edu-year').value.trim() });
      renderEducationList();
      saveState();
      wrap.innerHTML = '';
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP 7 — Theme & Publish
  ═══════════════════════════════════════════════════════════════ */

  function renderThemeGrid() {
    const freeWrap = $('free-theme-grid');
    freeWrap.innerHTML = '';
    FREE_THEMES.forEach(t => freeWrap.appendChild(buildThemeCard(t, false)));

    const proWrapEl = $('pro-theme-wrap');
    if (_isPro) {
      proWrapEl.innerHTML = '<div class="theme-section-label">Pro Themes</div><div class="theme-grid" id="pro-theme-grid"></div>';
      const grid = $('pro-theme-grid');
      PRO_THEMES.forEach(t => grid.appendChild(buildThemeCard(t, true)));
    } else {
      proWrapEl.innerHTML = `
        <div class="theme-upsell">
          <p>🔒 Unlock 8 more Pro themes (Editorial, Noir, Cyberpunk &amp; more)</p>
          <a href="dashboard.html" class="btn btn--secondary btn--sm" style="text-decoration:none;">Upgrade to Pro →</a>
        </div>`;
    }
  }

  function buildThemeCard(theme, isPro) {
    const card = document.createElement('div');
    card.className = 'theme-card' + (state.selectedTheme === theme.id ? ' is-selected' : '');
    card.innerHTML = `
      ${isPro ? '<span class="theme-card__pro-tag">PRO</span>' : ''}
      <div class="theme-card__preview theme-card__preview--${isPro ? 'pro' : theme.id}">${theme.icon}</div>
      <div class="theme-card__label">${theme.label}</div>
    `;
    card.addEventListener('click', () => {
      if (isPro && !_isPro) {
        window.toast?.('Upgrade to Pro to use this theme.', 'warn');
        return;
      }
      state.selectedTheme = theme.id;
      saveState();
      renderThemeGrid();
    });
    return card;
  }

  /* ═══════════════════════════════════════════════════════════════
     STEPPER + NAVIGATION
  ═══════════════════════════════════════════════════════════════ */

  function renderStepper() {
    const el = $('stepper');
    el.innerHTML = '';
    STEP_NAMES.forEach((name, i) => {
      const n = i + 1;
      const isComplete = n < state.step;
      const stepEl = document.createElement('div');
      stepEl.className = 'stepper__step'
        + (n === state.step ? ' is-active' : '')
        + (isComplete ? ' is-complete is-clickable' : '');
      stepEl.innerHTML = `<span class="stepper__dot">${isComplete ? '✓' : n}</span><span class="stepper__label">${name}</span>`;
      if (isComplete) stepEl.addEventListener('click', () => goToStep(n));
      el.appendChild(stepEl);

      if (n < TOTAL_STEPS) {
        const line = document.createElement('div');
        line.className = 'stepper__line' + (isComplete ? ' is-complete' : '');
        el.appendChild(line);
      }
    });

    // mobile
    $('stepper-mobile-label').textContent = `Step ${state.step} of ${TOTAL_STEPS}`;
    $('stepper-mobile-name').textContent  = STEP_NAMES[state.step - 1];
    $('stepper-mobile-fill').style.width  = `${(state.step / TOTAL_STEPS) * 100}%`;
  }

  function validateStep(n) {
    if (n === 1) {
      if (!state.fullName.trim()) return focusField('fullName', 'Please enter your full name.');
      if (!state.jobTitle.trim()) return focusField('jobTitle', 'Please enter your job title.');
      return { valid: true };
    }
    if (n === 2) {
      if (state.skills.length === 0) return { valid: false, message: 'Add at least one skill to continue.' };
      return { valid: true };
    }
    if (n === 3 || n === 4 || n === 5) return { valid: true }; // اختياري
    if (n === 6) {
      const email = (state.email || '').trim();
      if (!email) return focusField('email', 'Email is required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return focusField('email', 'Please enter a valid email.');
      // Fix 4 — sanitize social/website URLs قبل الانتقال للـ Step 7
      if (state.linkedinUrl) state.linkedinUrl = sanitizeUrl(state.linkedinUrl) ?? '';
      if (state.websiteUrl)  state.websiteUrl  = sanitizeUrl(state.websiteUrl)  ?? '';
      if (state.twitterUrl)  state.twitterUrl  = sanitizeUrl(state.twitterUrl)  ?? '';
      saveState();
      return { valid: true };
    }
    if (n === 7) {
      if (!state.selectedTheme) return { valid: false, message: 'Please select a theme.' };
      return { valid: true };
    }
    return { valid: true };
  }

  function showStep(n) {
    document.querySelectorAll('.step-panel').forEach(p => {
      p.classList.toggle('is-active', Number(p.dataset.step) === n);
    });
    $('back-btn').style.visibility = n === 1 ? 'hidden' : 'visible';
    $('next-btn').textContent = n === TOTAL_STEPS ? 'Generate Portfolio 🚀' : 'Next →';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (n === 2) renderSkillsChips();
    if (n === 3) renderProjectsList();
    if (n === 4) renderExperienceList();
    if (n === 5) renderEducationList();
    if (n === 7) renderThemeGrid();
  }

  function goToStep(n) {
    if (n < 1 || n > TOTAL_STEPS) return;
    state.step = n;
    saveState();
    showStep(n);
    renderStepper();
  }

  function handleNextClick() {
    const { valid, message } = validateStep(state.step);
    if (!valid) {
      if (message) window.toast?.(message, 'error');
      return;
    }
    if (state.step === TOTAL_STEPS) {
      generateManualPortfolio();
      return;
    }
    goToStep(state.step + 1);
  }

  /* ═══════════════════════════════════════════════════════════════
     FINAL SAVE — Generate Portfolio
  ═══════════════════════════════════════════════════════════════ */

  async function generateManualPortfolio() {
    const sb = window._supabaseClient;
    if (!sb || !_currentUser) {
      window.toast?.('You need to be signed in.', 'error');
      return;
    }

    const nextBtn = $('next-btn');
    nextBtn.disabled = true;
    showLoadingOverlay('Checking your account…');

    try {
      // 1. تأكد إن المستخدم معندوش portfolio قبل كده
      const { data: existing } = await sb
        .from('portfolios')
        .select('id, slug')
        .eq('user_id', _currentUser.id)
        .maybeSingle();

      if (existing) {
        hideLoadingOverlay();
        nextBtn.disabled = false;
        window.toast?.('You already have a portfolio — taking you to the editor.', 'warn');
        setTimeout(() => { location.href = 'edit.html'; }, 900);
        return;
      }

      showLoadingOverlay('Creating your portfolio…');

      // 2. slug فريد من full name
      const slug = await _generateUniqueSlug(sb, state.fullName);
      const githubUsername = _extractGithubUsername(state.githubUrl);

      // 3. أنشئ الـ portfolio
      const { data: portfolio, error: pErr } = await sb
        .from('portfolios')
        .insert({
          user_id:          _currentUser.id,
          full_name:        state.fullName,
          job_title:        state.jobTitle,
          bio:              state.bio,
          skills:           state.skills,
          theme:            state.selectedTheme,
          slug:             slug,
          linkedin_url:     state.linkedinUrl || null,
          gmail_address:    state.email,
          github_username:  githubUsername || null, // Fix 5 — null لـ Google users بدل ''
          photo_url:        state.photoUrl || null,
          location:         state.location || null,
          is_published:     true,
          custom_sections:  _buildCustomSections(),
        })
        .select()
        .single();

      if (pErr) throw pErr;

      // 4. أنشئ الـ projects
      if (state.projects.length > 0) {
        showLoadingOverlay('Adding your projects…');
        const { error: projErr } = await sb.from('projects').insert(
          state.projects.map((p, i) => ({
            portfolio_id:      portfolio.id,
            github_repo_name:  p.github_repo_name || _slugifyProject(p.name),
            ai_description:    p.description,
            external_url:      p.url || null,
            topics:            p.technologies || [],
            language:          p.language || null,
            is_custom:         true,
            sort_order:        i,
          }))
        );
        // Fix 6 — rollback: احذف الـ portfolio لو الـ projects insert فشل
        if (projErr) {
          console.error('[Builder] projects insert error — rolling back portfolio:', projErr);
          await sb.from('portfolios').delete().eq('id', portfolio.id);
          hideLoadingOverlay();
          nextBtn.disabled = false;
          window.toast?.('Something went wrong saving your projects. Please try again.', 'error');
          return;
        }
      }

      // 5. نظّف الدرافت ورّوح للـ edit.html
      localStorage.removeItem(_storageKey);
      window.toast?.('Portfolio created! 🎉', 'success');
      setTimeout(() => { location.href = `edit.html?slug=${slug}`; }, 700);

    } catch (err) {
      console.error('[Builder] generateManualPortfolio error:', err);
      hideLoadingOverlay();
      nextBtn.disabled = false;

      // portfolios.user_id و portfolios.slug كلاهما UNIQUE في الـ DB —
      // لو حصل race condition (مثلاً double-submit) نتعامل معاه بلطف
      // بدل ما نعرض DB error خام للمستخدم
      if (err?.code === '23505') {
        localStorage.removeItem(_storageKey);
        window.toast?.('Looks like your portfolio was already created — opening it now.', 'warn');
        setTimeout(() => { location.href = 'edit.html'; }, 900);
        return;
      }

      window.toast?.('Failed to create portfolio: ' + (err.message || err), 'error');
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════════ */

  async function init() {
    if (!window.Auth) {
      console.error('[Builder] auth.js لم يتم تحميله');
      return;
    }

    _currentUser = await window.Auth.getUser();
    if (!_currentUser) {
      window.location.href = 'index.html';
      return;
    }

    // Fix 1 — اربط الـ key بالـ user ID قبل أي قراءة/كتابة للـ localStorage
    _storageKey = `${STORAGE_KEY}_${_currentUser.id}`;
    loadState();

    const sb = window._supabaseClient;
    if (sb) {
      const { data } = await sb.from('users').select('is_pro').eq('id', _currentUser.id).single();
      _isPro = data?.is_pro === true;
    }

    // تعبية مبدئية من بيانات تسجيل الدخول لو الحقول فاضية لسه
    if (!state.email && _currentUser.email) state.email = _currentUser.email;
    if (!state.fullName && _currentUser.name) state.fullName = _currentUser.name;

    buildPanels();
    renderStepper();
    showStep(state.step || 1);

    // Fix 2 — اقفل حقل الـ email للـ Google users (provider = 'google')
    if (_currentUser.app_metadata?.provider === 'google' || _currentUser.email?.endsWith('.google.com')) {
      const emailField = $('f-email');
      if (emailField) {
        emailField.setAttribute('readonly', 'true');
        emailField.classList.add('field--locked');
      }
    }

    $('back-btn').addEventListener('click', () => goToStep(state.step - 1));
    $('next-btn').addEventListener('click', handleNextClick);
  }

  document.addEventListener('DOMContentLoaded', init);

})();