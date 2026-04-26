/**
 * portfolio.js — Step 5
 * Inline Editing + Theme Switcher + Edit Mode UI
 * + Pro Paywall with HMAC Activation Code Validation
 *
 * Depends on: window.AI (ai.js), window.GitHub (github.js)
 * Exposes: window.Portfolio
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════════════════════ */

  const THEMES = {
    free: [
      { id: 'light',    label: 'Light',    icon: '☀️' },
      { id: 'dark',     label: 'Dark',     icon: '🌙' },
      { id: 'minimal',  label: 'Minimal',  icon: '◻'  },
    ],
    pro: [
      { id: 'editorial', label: 'Editorial', icon: '📰' },
      { id: 'noir',      label: 'Noir',      icon: '◼'  },
      { id: 'blueprint', label: 'Blueprint', icon: '📐' },
      { id: 'terminal',  label: 'Terminal',  icon: '>_' },
      { id: 'liquid',    label: 'Liquid',    icon: '💧' },
      { id: 'glass3d',   label: 'Glass 3D',  icon: '💎' },
      { id: 'cyberpunk', label: 'Cyberpunk', icon: '⚡' },
      { id: 'space',     label: 'Space',     icon: '🚀' },
    ],
  };

  const MAX_UNDO = 20;
  const AUTOSAVE_DEBOUNCE = 600; // ms

  /* ═══════════════════════════════════════════════════════════════
     CODE VALIDATION
     ────────────────────────────────────────────────────────────
     التحقق من الكود يحصل كلياً server-side في Supabase (activate_pro).
     الـ client بيتحقق من الـ format الأساسي فقط (prefix + length)
     قبل ما يبعت للـ server — لتوفير request غير ضروري.
  ═══════════════════════════════════════════════════════════════ */

  const GPORT_PREFIX = 'GPORT';
  const CODE_LENGTHS = new Set([16, 14]); // 16=monthly, 14=yearly

  /**
   * تحقق سريع من الـ format فقط (offline — لا يغني عن server validation)
   * @param {string} code
   * @returns {{ valid: boolean, type?: string, error?: string }}
   */
  function _checkCodeFormat(code) {
    const clean = code.trim().toUpperCase();

    if (!clean.startsWith(GPORT_PREFIX)) {
      return { valid: false, error: 'Invalid code format' };
    }
    if (!CODE_LENGTHS.has(clean.length)) {
      return { valid: false, error: 'Invalid code length' };
    }
    return {
      valid: true,
      code:  clean,
      type:  clean.length === 14 ? 'yearly' : 'monthly',
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════════════════════════ */

  let _draft      = null;
  let _undoStack  = [];
  let _redoStack  = [];
  let _isPro      = false;  // يتحدد من Supabase في init()
  let _isSaving   = false;
  let _isPublished = false;

  /* ═══════════════════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════════════════ */

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function snapshot() { return JSON.stringify(_draft); }

  function pushUndo(before) {
    _undoStack.push(before);
    if (_undoStack.length > MAX_UNDO) _undoStack.shift();
    _redoStack = [];
    _updateUndoButtons();
  }

  function _updateUndoButtons() {
    const undoBtn = $('#toolbar-undo');
    const redoBtn = $('#toolbar-redo');
    if (undoBtn) undoBtn.disabled = _undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = _redoStack.length === 0;
  }

  function applyDraftToDom(draft) {
    const bioEl = $('[data-edit="bio"]');
    if (bioEl) bioEl.textContent = draft.bio || '';
    _renderSkillTags(draft.skills || []);
    _renderProjects(draft.projects || []);
    const titleEl = $('[data-edit="jobTitle"]');
    if (titleEl) titleEl.textContent = draft.jobTitle || '';
    const nameEl = $('[data-edit="name"]');
    if (nameEl) nameEl.textContent = draft.name || '';
    // Feature 1: Social Links
    const linkedinEl = $('[data-edit="linkedinUrl"]');
    if (linkedinEl) linkedinEl.textContent = draft.linkedinUrl || '';
    const gmailEl = $('[data-edit="gmailAddress"]');
    if (gmailEl) gmailEl.textContent = draft.gmailAddress || '';
    // Feature 2: Custom Sections
    _renderCustomSections(draft.custom_sections || []);
  }

  /* ═══════════════════════════════════════════════════════════════
     PRO STATUS — من Supabase
  ═══════════════════════════════════════════════════════════════ */

  /**
   * يجيب الـ Pro status من Supabase
   * بيتنادى في init() قبل ما يبني الـ toolbar
   */
  async function _loadProStatus() {
    try {
      const sb = window._supabaseClient;
      if (!sb) return false;

      // check_pro_status بتتحقق من الانتهاء تلقائياً
      const { data, error } = await sb.rpc('check_pro_status');
      if (error || !data) return false;

      const parsed = typeof data === 'string' ? JSON.parse(data) : data;

      // لو انتهى الاشتراك — نعرض toast للمستخدم
      if (parsed.expired) {
        setTimeout(() => {
          window.toast?.('Your Pro subscription has expired. Renew to continue using Pro themes.', 'warn');
        }, 2000);
      }

      return parsed.is_pro === true;

    } catch (err) {
      console.warn('[Portfolio] Could not load Pro status:', err);
      return false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     SKILLS RENDERING & EDITING
  ═══════════════════════════════════════════════════════════════ */

  function _renderSkillTags(skills) {
    const container = $('[data-skills-container]');
    if (!container) return;
    container.innerHTML = '';

    skills.forEach((skill, i) => {
      const tag = document.createElement('span');
      tag.className = 'skill-tag editable-tag';
      tag.setAttribute('data-skill-index', i);
      tag.setAttribute('contenteditable', 'true');
      tag.setAttribute('spellcheck', 'false');
      tag.setAttribute('aria-label', `Edit skill: ${skill}`);

      // Wrap label in <span> so CSS z-index:1 (targeting "span") lifts text above
      // the ::before fill animation used in editorial/noir/liquid ink-stamp effect
      const textSpan = document.createElement('span');
      textSpan.className = 'skill-tag__text';
      textSpan.textContent = skill;
      tag.appendChild(textSpan);

      tag.addEventListener('blur', () => _onSkillBlur(tag, i));
      tag.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); tag.blur(); }
        // Exclude the × button text when checking if tag is empty
        if (e.key === 'Backspace' && tag.textContent.replace('×', '').trim() === '') {
          e.preventDefault(); _removeSkill(i);
        }
      });

      const del = document.createElement('button');
      del.className = 'skill-tag__delete';
      del.setAttribute('aria-label', `Remove skill: ${skill}`);
      del.innerHTML = '×';
      del.addEventListener('click', () => _removeSkill(i));
      tag.appendChild(del);
      container.appendChild(tag);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'skill-tag skill-tag--add';
    addBtn.setAttribute('aria-label', 'Add new skill');
    addBtn.innerHTML = '<span>+</span> Add skill';
    addBtn.addEventListener('click', _addSkill);
    container.appendChild(addBtn);
  }

  function _onSkillBlur(el, index) {
    const before = snapshot();
    // Read from skill-tag__text span if present, fallback strips the × delete button
    const textEl = el.querySelector('.skill-tag__text');
    const val = (textEl ? textEl.textContent : el.textContent.replace('×', '')).trim();
    if (!val) { _removeSkill(index); return; }
    pushUndo(before);
    _draft.skills[index] = val;
    _scheduleAutosave();
  }

  function _removeSkill(index) {
    const before = snapshot();
    pushUndo(before);
    _draft.skills.splice(index, 1);
    _renderSkillTags(_draft.skills);
    _scheduleAutosave();
  }

  function _addSkill() {
    const before = snapshot();
    pushUndo(before);
    _draft.skills.push('New Skill');
    _renderSkillTags(_draft.skills);
    _scheduleAutosave();
    setTimeout(() => {
      const allTags = $$('.skill-tag.editable-tag');
      const lastTag = allTags[allTags.length - 1];
      if (lastTag) {
        lastTag.focus();
        const range = document.createRange();
        range.selectNodeContents(lastTag.firstChild || lastTag);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }, 50);
  }

  /* ═══════════════════════════════════════════════════════════════
     PROJECTS RENDERING & EDITING
  ═══════════════════════════════════════════════════════════════ */

  /* ── GitHub URL normalizer ─────────────────────────────────────
     Converts any GitHub blob/tree URL to a raw.githubusercontent.com URL
     so <img> tags can actually load the image.
     Handles:
       github.com/user/repo/blob/branch/path/img.png
       github.com/user/repo/raw/branch/path/img.png
     Already-raw URLs pass through unchanged.
  ─────────────────────────────────────────────────────────── */
  function _toRawGithubUrl(url) {
    if (!url) return url;
    url = url.trim();
    // Already a raw URL — pass through
    if (url.includes('raw.githubusercontent.com')) return url;
    // GitHub blob or raw path  →  raw.githubusercontent.com
    // https://github.com/USER/REPO/blob/BRANCH/PATH
    // https://github.com/USER/REPO/raw/BRANCH/PATH
    const match = url.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|raw)\/(.+)$/
    );
    if (match) {
      const [, user, repo, , rest] = match;
      return `https://raw.githubusercontent.com/${user}/${repo}/${rest}`;
    }
    // Not a GitHub URL — return as-is (could be Imgur, CDN, etc.)
    return url;
  }

    function _renderProjects(projects) {
    const grid = $('[data-projects-grid]');
    if (!grid) return;
    grid.innerHTML = '';
    projects.forEach((proj, i) => grid.appendChild(_buildProjectCard(proj, i)));
  }

  function _buildProjectCard(proj, index) {
    const card = document.createElement('article');
    card.className = `project-card${index === 0 ? ' project-card--featured' : ''}`;
    card.setAttribute('data-project-index', index);

    const langColor = _getLangColor(proj.language);

    card.innerHTML = `
      <div class="project-card__header">
        <div class="project-card__meta">
          ${proj.language ? `<span class="lang-dot" style="background:${langColor}" aria-label="${proj.language}"></span>
          <span class="project-card__lang">${proj.language}</span>` : ''}
          ${index === 0 ? '<span class="featured-badge">Featured</span>' : ''}
        </div>
        <div class="project-card__actions">
          <button class="icon-btn move-up-btn" data-index="${index}" title="Move up" aria-label="Move project up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn move-down-btn" data-index="${index}" title="Move down" aria-label="Move project down">↓</button>
          <a href="${proj.repo_url || '#'}" target="_blank" rel="noopener" class="icon-btn ext-link" aria-label="Open on GitHub">↗</a>
        </div>
      </div>

      <h3 class="project-card__name" contenteditable="true" spellcheck="false"
          data-edit="projectName" data-project-index="${index}"
          aria-label="Edit project name">${proj.github_repo_name || proj.name || ''}</h3>

      <p class="project-card__desc" contenteditable="true" spellcheck="false"
         data-edit="projectDesc" data-project-index="${index}"
         aria-label="Edit project description">${proj.ai_description || proj.description || ''}</p>

      <div class="project-card__footer">
        ${proj.stars ? `<span class="project-stat">⭐ ${proj.stars}</span>` : ''}
        ${(proj.topics || []).slice(0, 3).map(t => `<span class="topic-chip">${t}</span>`).join('')}
      </div>
    `;

    // Feature 3: أضف image block بعد الـ header مباشرةً
    const header = card.querySelector('.project-card__header');
    const imageBlock = _buildProjectImageBlock(proj, index, card);
    header.insertAdjacentElement('afterend', imageBlock);

    const nameEl = card.querySelector('[data-edit="projectName"]');
    nameEl.addEventListener('blur', () => {
      const before = snapshot(); pushUndo(before);
      _draft.projects[index].github_repo_name = nameEl.textContent.trim();
      _draft.projects[index].name = nameEl.textContent.trim();
      _scheduleAutosave();
    });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });

    const descEl = card.querySelector('[data-edit="projectDesc"]');
    descEl.addEventListener('blur', () => {
      const before = snapshot(); pushUndo(before);
      _draft.projects[index].ai_description = descEl.textContent.trim();
      _draft.projects[index].description = descEl.textContent.trim();
      _scheduleAutosave();
    });

    card.querySelector('.move-up-btn').addEventListener('click', () => _moveProject(index, -1));
    card.querySelector('.move-down-btn').addEventListener('click', () => _moveProject(index, 1));

    return card;
  }

  function _moveProject(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= _draft.projects.length) return;
    const before = snapshot(); pushUndo(before);
    const temp = _draft.projects[index];
    _draft.projects[index] = _draft.projects[newIndex];
    _draft.projects[newIndex] = temp;
    _renderProjects(_draft.projects);
    _scheduleAutosave();
  }

  /* ═══════════════════════════════════════════════════════════════
     FEATURE 3: PROJECT IMAGE URL — helper لـ _buildProjectCard
  ═══════════════════════════════════════════════════════════════ */

  const MAX_PROJECT_IMAGES = 4;

  function _buildProjectImageBlock(proj, index, card) {
    // imageUrls — normalise from legacy single string or new array
    if (!Array.isArray(proj.imageUrls)) {
      proj.imageUrls = proj.imageUrl ? [proj.imageUrl] : [];
    }

    const wrap = document.createElement('div');
    wrap.className = 'project-image-wrap';
    wrap.style.cssText = 'margin-bottom: var(--sp-3);';

    // ── رسم حقول الـ URL ────────────────────────────────────────
    const inputsContainer = document.createElement('div');
    inputsContainer.className = 'project-image-inputs';

    function _syncUrls() {
      const urls = [...inputsContainer.querySelectorAll('.project-image-input')]
        .map(el => _toRawGithubUrl(el.value.trim()))
        .filter(Boolean);
      _draft.projects[index].imageUrls = urls;
      _draft.projects[index].imageUrl  = urls[0] || null; // backward compat
      _scheduleAutosave();
    }

    function _buildInputRow(value = '') {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:6px;';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'project-image-input';
      input.placeholder = '🖼 Image URL (optional)';
      input.value = value;
      input.setAttribute('aria-label', 'Project image URL');
      input.style.cssText = `
        flex:1; background: var(--clr-bg-2);
        border: 1px dashed var(--clr-border-dim);
        border-radius: var(--radius-sm, 4px);
        padding: 6px 10px; font-size: var(--fs-xs);
        color: var(--clr-text-3); font-family: var(--font-body);
        outline: none; transition: border-color var(--dur-fast);
      `;
      input.addEventListener('focus', () => input.style.borderColor = 'var(--clr-accent)');
      input.addEventListener('blur',  () => input.style.borderColor = 'var(--clr-border-dim)');
      input.addEventListener('input', () => { pushUndo(snapshot()); _syncUrls(); });

      // زر الحذف (يظهر فقط للحقول غير الأولى)
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Remove image URL');
      removeBtn.style.cssText = `
        width:22px; height:22px; border-radius:50%;
        background: rgba(255,80,80,0.12); border: 1px solid rgba(255,80,80,0.25);
        color: rgba(255,100,100,0.8); font-size:14px; line-height:1;
        cursor:pointer; flex-shrink:0; display:flex;
        align-items:center; justify-content:center;
        transition: background var(--dur-fast);
      `;
      removeBtn.addEventListener('click', () => {
        row.remove();
        _syncUrls();
        _updateAddBtn();
      });

      row.appendChild(input);
      row.appendChild(removeBtn);
      return row;
    }

    // الحقول الموجودة أو حقل فارغ واحد
    const initUrls = proj.imageUrls.length ? proj.imageUrls : [''];
    initUrls.forEach(url => inputsContainer.appendChild(_buildInputRow(url)));

    // ── زر الإضافة ───────────────────────────────────────────────
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.innerHTML = '＋ Add image';
    addBtn.style.cssText = `
      font-size: var(--fs-xs); font-family: var(--font-body);
      color: var(--clr-accent); background: transparent;
      border: 1px dashed rgba(0,255,136,0.3);
      border-radius: var(--radius-sm, 4px);
      padding: 4px 10px; cursor: pointer; width: 100%;
      transition: all var(--dur-fast); margin-top: 2px;
    `;
    addBtn.addEventListener('click', () => {
      const count = inputsContainer.querySelectorAll('.project-image-input').length;
      if (count >= MAX_PROJECT_IMAGES) return;
      inputsContainer.appendChild(_buildInputRow(''));
      _updateAddBtn();
    });

    function _updateAddBtn() {
      const count = inputsContainer.querySelectorAll('.project-image-input').length;
      addBtn.style.display = count >= MAX_PROJECT_IMAGES ? 'none' : 'block';
    }
    _updateAddBtn();

    wrap.appendChild(inputsContainer);
    wrap.appendChild(addBtn);
    return wrap;
  }

  /* ═══════════════════════════════════════════════════════════════
     FEATURE 2: CUSTOM SECTIONS
  ═══════════════════════════════════════════════════════════════ */

  function _renderCustomSections(sections) {
    const container = $('[data-custom-sections]');
    if (!container) return;
    container.innerHTML = '';

    (sections || []).forEach((sec, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'custom-section-block';
      wrap.setAttribute('data-section-index', i);
      wrap.style.cssText = 'position: relative; padding: var(--sp-4); background: var(--clr-bg-3); border: 1px solid var(--clr-border-dim); border-radius: var(--radius-lg); margin-bottom: var(--sp-4);';

      // زرار حذف
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = 'Remove section';
      delBtn.setAttribute('aria-label', 'Remove section');
      delBtn.innerHTML = '×';
      delBtn.style.cssText = 'position: absolute; top: var(--sp-3); right: var(--sp-3); font-size: 1.1rem; line-height:1; opacity: 0.5;';
      delBtn.addEventListener('click', () => _removeCustomSection(i));
      delBtn.addEventListener('mouseenter', () => { delBtn.style.opacity = '1'; });
      delBtn.addEventListener('mouseleave', () => { delBtn.style.opacity = '0.5'; });

      // عنوان الـ section
      const titleEl = document.createElement('div');
      titleEl.className = 'section-label';
      titleEl.style.cssText = 'margin-bottom: var(--sp-4);';
      const titleSpan = document.createElement('span');
      titleSpan.setAttribute('contenteditable', 'true');
      titleSpan.setAttribute('spellcheck', 'false');
      titleSpan.setAttribute('aria-label', 'Edit section title');
      titleSpan.style.cssText = 'color: var(--clr-accent); font-family: var(--font-display); font-weight: 700; font-size: var(--fs-sm); outline: none; cursor: text; min-width: 60px; display: inline-block;';
      titleSpan.textContent = sec.title || 'Section Title';
      titleSpan.addEventListener('blur', () => {
        const before = snapshot(); pushUndo(before);
        _draft.custom_sections[i].title = titleSpan.textContent.trim() || 'Section Title';
        _scheduleAutosave();
      });
      titleSpan.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); titleSpan.blur(); } });
      titleEl.appendChild(titleSpan);
      titleEl.insertAdjacentHTML('beforeend', '<span style="flex:1;height:1px;background:var(--clr-border-dim);display:inline-block;vertical-align:middle;margin-left:var(--sp-4);"></span>');

      // محتوى الـ section
      const contentEl = document.createElement('div');
      contentEl.setAttribute('contenteditable', 'true');
      contentEl.setAttribute('spellcheck', 'false');
      contentEl.setAttribute('aria-label', 'Edit section content');
      contentEl.style.cssText = 'min-height: 60px; font-size: var(--fs-sm); color: var(--clr-text-2); line-height: var(--lh-loose); outline: none; cursor: text; white-space: pre-wrap;';
      contentEl.textContent = sec.content || '';
      contentEl.setAttribute('data-placeholder', 'Write your content here…');

      contentEl.addEventListener('blur', () => {
        const before = snapshot(); pushUndo(before);
        _draft.custom_sections[i].content = contentEl.textContent.trim();
        _scheduleAutosave();
      });

      // Placeholder CSS
      if (!document.getElementById('custom-section-placeholder-style')) {
        const style = document.createElement('style');
        style.id = 'custom-section-placeholder-style';
        style.textContent = `
          [data-placeholder]:empty::before {
            content: attr(data-placeholder);
            color: var(--clr-text-3);
            pointer-events: none;
            font-style: italic;
          }
        `;
        document.head.appendChild(style);
      }

      wrap.appendChild(delBtn);
      wrap.appendChild(titleEl);
      wrap.appendChild(contentEl);
      container.appendChild(wrap);
    });
  }

  function _addCustomSection() {
    const before = snapshot(); pushUndo(before);
    if (!_draft.custom_sections) _draft.custom_sections = [];
    _draft.custom_sections.push({ title: 'New Section', content: '' });
    _renderCustomSections(_draft.custom_sections);
    _scheduleAutosave();

    // Focus على عنوان الـ section الجديد
    setTimeout(() => {
      const sections = $$('[data-custom-sections] [data-section-index]');
      const last = sections[sections.length - 1];
      if (last) {
        const titleSpan = last.querySelector('[contenteditable]');
        if (titleSpan) {
          titleSpan.focus();
          const range = document.createRange();
          range.selectNodeContents(titleSpan);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }, 50);
  }

  function _removeCustomSection(index) {
    const before = snapshot(); pushUndo(before);
    _draft.custom_sections.splice(index, 1);
    _renderCustomSections(_draft.custom_sections);
    _scheduleAutosave();
  }

  /* ═══════════════════════════════════════════════════════════════
     CONTENTEDITABLE FIELDS
  ═══════════════════════════════════════════════════════════════ */

  function _initEditableFields() {
    $$('[data-edit]').forEach(el => {
      const field = el.getAttribute('data-edit');
      if (field === 'projectName' || field === 'projectDesc') return;

      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
      el.classList.add('is-editable');

      el.addEventListener('focus', () => el.classList.add('is-editing'));
      el.addEventListener('blur', () => {
        el.classList.remove('is-editing');
        const before = snapshot(); pushUndo(before);
        _draft[field] = el.textContent.trim();
        _scheduleAutosave();
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && field !== 'bio') { e.preventDefault(); el.blur(); }
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     AUTO-SAVE
  ═══════════════════════════════════════════════════════════════ */

  const _scheduleAutosave = debounce(() => {
    window.AI?.saveDraft?.(_draft);
    _showSaveIndicator('draft');
  }, AUTOSAVE_DEBOUNCE);

  function _showSaveIndicator(state) {
    const indicator = $('#save-indicator');
    if (!indicator) return;
    const messages = {
      draft: '✓ Draft saved', saving: '⟳ Saving...',
      published: '✓ Published!', error: '✗ Save failed',
    };
    indicator.textContent = messages[state] || '';
    indicator.className = `save-indicator save-indicator--${state}`;
    if (state === 'draft' || state === 'published') {
      setTimeout(() => { indicator.textContent = ''; indicator.className = 'save-indicator'; }, 2500);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     UNDO / REDO
  ═══════════════════════════════════════════════════════════════ */

  function undo() {
    if (_undoStack.length === 0) return;
    _redoStack.push(snapshot());
    _draft = JSON.parse(_undoStack.pop());
    applyDraftToDom(_draft);
    _scheduleAutosave();
    _updateUndoButtons();
  }

  function redo() {
    if (_redoStack.length === 0) return;
    _undoStack.push(snapshot());
    _draft = JSON.parse(_redoStack.pop());
    applyDraftToDom(_draft);
    _scheduleAutosave();
    _updateUndoButtons();
  }

  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    if (e.key === 'z' && e.shiftKey)  { e.preventDefault(); redo(); }
    if (e.key === 'y')                { e.preventDefault(); redo(); }
    if (e.key === 's')                { e.preventDefault(); saveDraft(); }
  });

  /* ═══════════════════════════════════════════════════════════════
     THEME SWITCHER
  ═══════════════════════════════════════════════════════════════ */

  function _buildThemePanel() {
    $('#theme-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'theme-panel';
    panel.className = 'theme-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Theme switcher');
    panel.setAttribute('aria-hidden', 'true');

    const currentTheme = _draft.theme || 'light';

    panel.innerHTML = `
      <div class="theme-panel__header">
        <span class="theme-panel__title">Choose Theme</span>
        <button class="theme-panel__close icon-btn" id="theme-panel-close" aria-label="Close theme panel">✕</button>
      </div>

      <div class="theme-panel__section">
        <span class="theme-panel__label">Free</span>
        <div class="theme-grid">
          ${THEMES.free.map(t => `
            <button class="theme-swatch ${t.id === currentTheme ? 'is-active' : ''}"
                    data-theme="${t.id}" aria-label="Select ${t.label} theme"
                    aria-pressed="${t.id === currentTheme}">
              <span class="theme-swatch__preview theme-swatch__preview--${t.id}"></span>
              <span class="theme-swatch__icon">${t.icon}</span>
              <span class="theme-swatch__label">${t.label}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="theme-panel__section">
        <span class="theme-panel__label">Pro ${_isPro ? '' : '<span class="pro-badge">PRO</span>'}</span>
        <div class="theme-grid">
          ${THEMES.pro.map(t => `
            <button class="theme-swatch ${t.id === currentTheme ? 'is-active' : ''}"
                    data-theme="${t.id}" data-is-pro="true"
                    aria-label="${t.label} theme — Pro preview"
                    aria-pressed="${t.id === currentTheme}">
              <span class="theme-swatch__preview theme-swatch__preview--${t.id}"></span>
              <span class="theme-swatch__icon">${t.icon}</span>
              <span class="theme-swatch__label">${t.label}</span>
              ${_isPro ? '' : '<span class="lock-icon" title="Preview free — Publish requires Pro" aria-hidden="true">👁</span>'}
            </button>
          `).join('')}
        </div>
      </div>

      ${!_isPro ? `
        <div class="theme-panel__upsell">
          <p>Unlock stunning 3D themes & more</p>
          <button class="btn btn--primary btn--sm" id="upgrade-btn">Upgrade to Pro →</button>
        </div>
      ` : ''}
    `;

    document.body.appendChild(panel);

    panel.querySelector('#theme-panel-close').addEventListener('click', closeThemePanel);

    $$('.theme-swatch', panel).forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(btn.getAttribute('data-theme'));
        closeThemePanel();
      });
    });

    panel.querySelector('#upgrade-btn')?.addEventListener('click', () => {
      closeThemePanel();
      _showProPaywall('upgrade');
    });

    panel.addEventListener('click', e => { if (e.target === panel) closeThemePanel(); });
  }

  function openThemePanel() {
    _buildThemePanel();
    const panel = $('#theme-panel');
    if (!panel) return;
    requestAnimationFrame(() => {
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      panel.querySelector('#theme-panel-close')?.focus();
    });
  }

  function closeThemePanel() {
    const panel = $('#theme-panel');
    if (!panel) return;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    setTimeout(() => panel.remove(), 300);
    $('#toolbar-theme-btn')?.focus();
  }

  function applyTheme(themeId) {
    if (!_draft) return;
    const before = snapshot(); pushUndo(before);
    _draft.theme = themeId;

    let link = $('#active-theme-css');
    if (!link) {
      link = document.createElement('link');
      link.id = 'active-theme-css';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = `css/themes/${themeId}.css`;

    document.body.className = document.body.className.replace(/\btheme-\S+/g, '').trim();
    document.body.classList.add(`theme-${themeId}`);
    document.documentElement.setAttribute('data-theme', themeId);
    document.body.setAttribute('data-theme', themeId);

    _setupProThemeElements(themeId);
    _scheduleAutosave();
    handleThemeScriptLifecycle(themeId);
    window.toast?.(`Theme changed to ${themeId}`, 'success');
  }

  /* ═══════════════════════════════════════════════════════════════
     EDIT TOOLBAR
  ═══════════════════════════════════════════════════════════════ */

  function _buildToolbar() {
    $('#edit-toolbar')?.remove();

    const toolbar = document.createElement('div');
    toolbar.id = 'edit-toolbar';
    toolbar.className = 'edit-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Portfolio editor toolbar');

    toolbar.innerHTML = `
      <div class="edit-toolbar__left">
        <div class="edit-toolbar__brand">
          <span class="edit-toolbar__logo">PG</span>
          <span class="edit-toolbar__label">Edit Mode</span>
        </div>
        <div class="edit-toolbar__history" role="group" aria-label="History">
          <button id="toolbar-undo" class="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>
          </button>
          <button id="toolbar-redo" class="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"/></svg>
          </button>
        </div>
        <span id="save-indicator" class="save-indicator" aria-live="polite"></span>
      </div>

      <div class="edit-toolbar__right">
        ${!_isPro ? `<span class="pro-status-badge pro-status-badge--free">Free Plan</span>` : `<span class="pro-status-badge pro-status-badge--pro">⚡ Pro</span>`}
        <button id="toolbar-theme-btn" class="btn btn--ghost btn--sm" aria-label="Change theme">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          Theme
        </button>
        <button id="toolbar-copylink-btn" class="btn btn--ghost btn--sm" aria-label="Copy portfolio link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          Copy Link
        </button>
        <button id="toolbar-save-btn" class="btn btn--ghost btn--sm" aria-label="Save draft">Save Draft</button>
        <button id="toolbar-publish-btn" class="btn btn--primary btn--sm" aria-label="Publish portfolio">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
          Publish
        </button>
      </div>
    `;

    document.body.prepend(toolbar);

    toolbar.querySelector('#toolbar-undo').addEventListener('click', undo);
    toolbar.querySelector('#toolbar-redo').addEventListener('click', redo);
    toolbar.querySelector('#toolbar-theme-btn').addEventListener('click', openThemePanel);
    toolbar.querySelector('#toolbar-save-btn').addEventListener('click', saveDraft);
    toolbar.querySelector('#toolbar-publish-btn').addEventListener('click', publish);
    toolbar.querySelector('#toolbar-copylink-btn').addEventListener('click', async () => {
      const draft = window.AI?.getDraft?.() || _draft;
      const slug  = draft?.githubUsername || draft?.githubUser?.login || '';
      const url   = slug
        ? `${window.location.origin}/portfolio.html?slug=${slug}`
        : window.location.origin + '/portfolio.html';
      try {
        await navigator.clipboard.writeText(url);
        const btn = document.getElementById('toolbar-copylink-btn');
        const orig = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        btn.style.color = 'var(--clr-accent)';
        setTimeout(() => { btn.innerHTML = orig; btn.style.color = ''; }, 2000);
      } catch {
        window.toast?.('Could not copy — ' + url, 'warn');
      }
    });

    _updateUndoButtons();
  }

  /* ═══════════════════════════════════════════════════════════════
     SAVE DRAFT & PUBLISH
  ═══════════════════════════════════════════════════════════════ */

  function saveDraft() {
    const PRO_THEMES = new Set(['glass3d', 'cyberpunk', 'space']);
    if (!_isPro && PRO_THEMES.has(_draft?.theme)) {
      _showProPaywall('save');
      return;
    }
    _showSaveIndicator('saving');
    window.AI?.saveDraft?.(_draft);
    setTimeout(() => _showSaveIndicator('draft'), 500);
  }

  async function publish() {
    if (_isSaving) return;
    _isSaving = true;

    const btn = $('#toolbar-publish-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }
    _showSaveIndicator('saving');

    const PRO_THEMES_SET = new Set(['glass3d', 'cyberpunk', 'space']);
    if (!_isPro && PRO_THEMES_SET.has(_draft?.theme)) {
      _showProPaywall('publish');
      if (btn) { btn.disabled = false; btn.textContent = 'Publish'; }
      _isSaving = false;
      return;
    }

    try {
      // ── DOM flush: sync any [data-edit] field that still has focus ──────────
      // Prevents gmail/linkedin/name from being NULL if user clicks Publish
      // while the cursor is still inside the field (blur never fired).
      document.querySelectorAll('[data-edit]').forEach(el => {
        const field = el.getAttribute('data-edit');
        if (!field || field === 'projectName' || field === 'projectDesc') return;
        const val = el.textContent.trim();
        if (val !== undefined && val !== null) _draft[field] = val;
      });

      const draft = window.AI?.getDraft?.() || _draft;
      const sb = window._supabaseClient || window.supabase;

      if (sb?.auth && draft) {
        const { data: authData } = await sb.auth.getUser();
        const userId = authData?.user?.id;

        if (userId) {
          // ── Slug: يتبنى من الـ GitHub username مع validation صارم ──────────
          const rawSlug = (draft.githubUsername || draft.githubUser?.login || '').toLowerCase();
          if (!rawSlug) {
            throw new Error('Cannot determine GitHub username for slug.');
          }
          // يسمح بـ alphanumeric وhyphens فقط — نفس قواعد GitHub usernames
          const slug = rawSlug
            .replace(/[^a-z0-9-]/g, '-')  // استبدل أي حرف غير مسموح
            .replace(/-+/g, '-')           // ازل hyphens متتالية
            .replace(/^-|-$/g, '')         // ازل hyphens في البداية والنهاية
            .slice(0, 39);                 // GitHub max username length

          await sb.from('users').upsert({
            id: userId, email: authData.user.email || '',
            github_username: draft.githubUsername || '',
            full_name: draft.fullName || draft.name || '',
            job_title: draft.jobTitle || '',
          }, { onConflict: 'id' });

          const { error: portError } = await sb.from('portfolios').upsert({
            user_id: userId, bio: draft.bio,
            skills: draft.skills || [], theme: draft.theme || 'dark',
            slug, is_published: true, updated_at: new Date().toISOString(),
            linkedin_url:    draft.linkedinUrl  || null,
            gmail_address:   draft.gmailAddress || null,
            custom_sections: draft.custom_sections || [],
            // Denormalized user fields — avoids RLS-blocked users table query
            // for anonymous visitors on the public portfolio page.
            full_name:       draft.fullName  || draft.name || '',
            github_username: draft.githubUsername || '',
            job_title:       draft.jobTitle  || '',
          }, { onConflict: 'user_id' });

          if (portError) throw portError;

          const { data: portData } = await sb
            .from('portfolios').select('id').eq('user_id', userId).single();

          if (portData?.id) {
            const projectsPayload = (draft.projects || []).map((p, i) => ({
              portfolio_id: portData.id,
              github_repo_name: p.github_repo_name || p.name || '',
              repo_url: p.repo_url || '',
              ai_description: p.ai_description || p.description || '',
              stars: p.stars || 0, language: p.language || null,
              topics: p.topics || [], sort_order: i, is_featured: i === 0,
              image_url:  (p.imageUrls && p.imageUrls[0]) || p.imageUrl || null,
              image_urls: p.imageUrls || (p.imageUrl ? [p.imageUrl] : []),
            }));
            await sb.from('projects').delete().eq('portfolio_id', portData.id);
            await sb.from('projects').insert(projectsPayload);
          }

        } else {
          window.AI?.saveDraft?.(draft);
          window.toast?.('Draft saved locally. Sign in to publish online.', 'warn');
          _isPublished = false;
          _showSaveIndicator('draft');
          if (btn) { btn.disabled = false; btn.textContent = 'Publish'; }
          _isSaving = false;
          return;
        }
      } else {
        window.AI?.saveDraft?.(draft);
      }

      _isPublished = true;
      _showSaveIndicator('published');
      window.toast?.('Portfolio published! 🎉 Redirecting to dashboard…', 'success');
      if (btn) { btn.textContent = '✓ Published'; btn.classList.add('is-published'); }

      setTimeout(() => {
        const dashUrl = window.location.origin
          + window.location.pathname.replace(/\/[^/]*$/, '/dashboard.html');
        window.location.href = dashUrl;
      }, 2000);

    } catch (err) {
      console.error('[Portfolio] publish error:', err);
      _showSaveIndicator('error');
      window.toast?.(`Publish failed: ${err.message}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Publish'; }
    } finally {
      _isSaving = false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     PRO PAYWALL MODAL
  ═══════════════════════════════════════════════════════════════ */

  async function _showProPaywall(action) {
    document.getElementById('pro-paywall-modal')?.remove();

    // ── جلب الـ discount ديناميكياً من Supabase ──────────────
    const ORIGINAL_PRICE = 200;
    let finalPrice  = ORIGINAL_PRICE;
    let discountPct = 0;
    try {
      const sb = window._supabaseClient;
      if (sb) {
        const { data: authData } = await sb.auth.getUser();
        const userId = authData?.user?.id;
        if (userId) {
          const { data: stats } = await sb.rpc('get_referral_stats', { p_user_id: userId });
          if (stats && stats.length > 0) {
            discountPct = stats[0].discount_tier ?? 0;
            finalPrice  = ORIGINAL_PRICE - Math.round(ORIGINAL_PRICE * discountPct / 100);
          }
        }
      }
    } catch (e) {
      console.warn('[Portfolio] Could not load discount:', e);
    }
    const priceDisplay = discountPct > 0
      ? '<strong style="color:#E8F0EB;">' + finalPrice + ' جنيه</strong> <span style="color:#4A5E52;text-decoration:line-through;font-size:0.75rem;">' + ORIGINAL_PRICE + '</span> <span style="color:#00FF88;font-size:0.72rem;">(خصم ' + discountPct + '%)</span>'
      : '<strong style="color:#E8F0EB;">' + ORIGINAL_PRICE + ' جنيه</strong>';

    const modal = document.createElement('div');
    modal.id = 'pro-paywall-modal';
    modal.style.cssText = `
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);
      animation: toast-in 0.25s ease;
    `;

    const themeName = _draft?.theme
      ? _draft.theme.charAt(0).toUpperCase() + _draft.theme.slice(1)
      : 'Pro';

    // نص تعليمات الدفع بناءً على الـ action
    const isUpgrade = action === 'upgrade';
    const actionText = action === 'publish' ? 'publish' : action === 'save' ? 'save' : 'upgrade';

    modal.innerHTML = `
      <div style="
        background: #0D1410; border: 1px solid rgba(0,255,136,0.2);
        border-radius: 20px; overflow: hidden;
        width: min(520px, 92vw); max-height: 90vh; overflow-y: auto;
        box-shadow: 0 32px 80px rgba(0,0,0,0.6);
        font-family: 'DM Mono', monospace;
      ">
        <!-- Preview strip -->
        <div style="
          height: 120px; position: relative; overflow: hidden;
          background: ${_draft?.theme === 'glass3d'
            ? 'linear-gradient(135deg, #070b14, #1a4aff44, #b088ff33)'
            : _draft?.theme === 'cyberpunk'
            ? 'linear-gradient(135deg, #020408, #00ffaa11)'
            : 'linear-gradient(135deg, #04040c, #a078ff22)'};
        ">
          <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 30px,rgba(255,255,255,0.015) 30px,rgba(255,255,255,0.015) 31px),repeating-linear-gradient(90deg,transparent,transparent 30px,rgba(255,255,255,0.015) 30px,rgba(255,255,255,0.015) 31px);"></div>
          <div style="position:absolute;bottom:16px;left:24px;font-family:'Syne',sans-serif;font-weight:800;font-size:1.4rem;color:rgba(255,255,255,0.12);letter-spacing:-0.03em;">${isUpgrade ? 'Portfolio Generator Pro' : themeName + ' Theme'}</div>
          <span style="position:absolute;top:16px;left:24px;background:linear-gradient(135deg,#00FF88,#00ccff);color:#080C0A;font-size:0.6rem;font-weight:700;letter-spacing:0.1em;padding:3px 10px;border-radius:4px;">PRO</span>
        </div>

        <!-- Body -->
        <div style="padding: 1.5rem;">
          <h3 style="font-family:'Syne',sans-serif;font-size:1.15rem;font-weight:700;color:#E8F0EB;margin:0 0 0.4rem;">
            ${isUpgrade ? 'Upgrade to Pro' : 'Unlock ' + themeName + ' Theme'}
          </h3>
          <p style="font-size:0.82rem;color:#8A9E90;line-height:1.6;margin:0 0 1.25rem;">
            ${isUpgrade
              ? 'Unlock all Pro themes and future features.'
              : `You're previewing a Pro theme. To ${actionText} with <strong style="color:#E8F0EB;">${themeName}</strong>, upgrade to Pro.`}
          </p>

          <!-- Payment Instructions -->
          <div style="background:rgba(0,255,136,0.04);border:1px solid rgba(0,255,136,0.12);border-radius:10px;padding:1rem;margin-bottom:1rem;">
            <p style="font-size:0.7rem;color:#4A5E52;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 0.75rem;">كيفية الترقية — خطوات بسيطة</p>

            <div style="display:flex;flex-direction:column;gap:0.6rem;">
              <div style="display:flex;gap:0.75rem;align-items:flex-start;">
                <span style="background:rgba(0,255,136,0.15);color:#00FF88;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;margin-top:1px;">1</span>
                <span style="font-size:0.8rem;color:#A8C0B0;line-height:1.5;">
                  حوّل ${priceDisplay} على InstaPay أو فودافون كاش
                  <br><span style="color:#00FF88;font-size:0.78rem;">📱 01095499556</span>
                </span>
              </div>
              <div style="display:flex;gap:0.75rem;align-items:flex-start;">
                <span style="background:rgba(0,255,136,0.15);color:#00FF88;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;margin-top:1px;">2</span>
                <span style="font-size:0.8rem;color:#A8C0B0;line-height:1.5;">
                  ابعت الـ screenshot على Telegram
                  <br><a href="https://t.me/GPORT_Payment_BOT" target="_blank" rel="noopener" style="color:#00FF88;font-size:0.78rem;text-decoration:none;">@GPORT_Payment_BOT →</a>
                </span>
              </div>
              <div style="display:flex;gap:0.75rem;align-items:flex-start;">
                <span style="background:rgba(0,255,136,0.15);color:#00FF88;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;margin-top:1px;">3</span>
                <span style="font-size:0.8rem;color:#A8C0B0;line-height:1.5;">
                  هيوصلك كود التفعيل — ادخله هنا وانت Pro! ⚡
                </span>
              </div>
            </div>
          </div>

          <!-- Activation Code Input -->
          <div style="background:rgba(0,255,136,0.03);border:1px solid rgba(0,255,136,0.1);border-radius:10px;padding:1rem;margin-bottom:1.25rem;">
            <label style="font-size:0.7rem;color:#4A5E52;letter-spacing:0.1em;text-transform:uppercase;display:block;margin-bottom:0.5rem;">
              كود التفعيل
            </label>
            <div style="display:flex;gap:8px;">
              <input id="paywall-code-input" type="text"
                placeholder="GPORT..."
                autocomplete="off" autocapitalize="characters" spellcheck="false"
                style="
                  flex:1;background:rgba(0,0,0,0.3);border:1px solid rgba(0,255,136,0.15);
                  border-radius:6px;padding:10px 12px;color:#E8F0EB;
                  font-family:'DM Mono',monospace;font-size:0.85rem;outline:none;
                  letter-spacing:0.05em;transition:border-color 0.2s;
                "
              />
              <button id="paywall-apply-btn" style="
                background:rgba(0,255,136,0.1);border:1px solid rgba(0,255,136,0.25);
                color:#00FF88;border-radius:6px;padding:10px 18px;
                font-family:'DM Mono',monospace;font-size:0.8rem;
                cursor:pointer;transition:all 0.2s;white-space:nowrap;
              ">Activate</button>
            </div>
            <p id="paywall-code-msg" style="font-size:0.72rem;margin:0.5rem 0 0;min-height:1.2em;line-height:1.4;"></p>
          </div>

          <!-- Close -->
          <button id="paywall-close-btn" style="
            width:100%;background:transparent;border:1px solid rgba(255,255,255,0.08);
            color:#4A5E52;border-radius:8px;padding:10px;
            font-family:'DM Mono',monospace;font-size:0.82rem;
            cursor:pointer;transition:border-color 0.2s;
          ">Maybe later — keep Free</button>

          ${action !== 'upgrade' ? `
          <p style="font-size:0.7rem;color:#3A4E42;text-align:center;margin:0.75rem 0 0;">
            Or switch to a free theme to ${actionText} without upgrading
          </p>` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close
    const closeModal = () => modal.remove();
    modal.querySelector('#paywall-close-btn').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    // Code input UX
    const codeInput = modal.querySelector('#paywall-code-input');
    const codeMsg   = modal.querySelector('#paywall-code-msg');
    const applyBtn  = modal.querySelector('#paywall-apply-btn');

    // Auto-uppercase أثناء الكتابة
    codeInput.addEventListener('input', () => {
      const pos = codeInput.selectionStart;
      codeInput.value = codeInput.value.toUpperCase();
      codeInput.setSelectionRange(pos, pos);
    });

    codeInput.addEventListener('focus', () => {
      codeInput.style.borderColor = 'rgba(0,255,136,0.4)';
    });
    codeInput.addEventListener('blur', () => {
      codeInput.style.borderColor = 'rgba(0,255,136,0.15)';
    });

    applyBtn.addEventListener('click', () => {
      _validateDiscountCode(codeInput.value, action, modal, codeMsg, applyBtn);
    });

    codeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') applyBtn.click();
    });

    // Focus الـ input
    setTimeout(() => codeInput.focus(), 100);
  }

  /* ═══════════════════════════════════════════════════════════════
     VALIDATE DISCOUNT CODE — HMAC + Supabase
  ═══════════════════════════════════════════════════════════════ */

  async function _validateDiscountCode(code, action, modal, msgEl, applyBtn) {
    if (!code || code.trim().length < 10) {
      _setCodeMsg(msgEl, 'error', 'Please enter your activation code.');
      return;
    }

    // Loading state
    applyBtn.disabled = true;
    applyBtn.textContent = '...';
    _setCodeMsg(msgEl, 'loading', 'Verifying code…');

    // 1. Format check فقط (offline) — التحقق الحقيقي server-side
    const formatResult = _checkCodeFormat(code);

    if (!formatResult.valid) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Activate';
      _setCodeMsg(msgEl, 'error', formatResult.error || 'Invalid code format.');
      _shakeInput(modal);
      return;
    }

    // 2. Supabase — تسجيل الكود وتفعيل Pro (يمنع إعادة الاستخدام)
    try {
      const sb = window._supabaseClient;
      if (!sb) throw new Error('Not connected');

      const { data, error } = await sb.rpc('activate_pro', {
        p_code:      formatResult.code,
        p_code_type: formatResult.type,
        p_discount:  0,
      });

      if (error) throw error;

      const parsed = typeof data === 'string' ? JSON.parse(data) : data;

      if (!parsed?.success) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Activate';
        const errMsg = parsed?.error === 'Code already used'
          ? 'This code has already been used.'
          : parsed?.error === 'Already Pro'
          ? 'Your account is already Pro! 🎉'
          : parsed?.error || 'Activation failed. Please try again.';
        _setCodeMsg(msgEl, 'error', errMsg);
        return;
      }

      // ✅ نجاح
      _isPro = true;

      // تحديث الـ UI
      _setCodeMsg(msgEl, 'success',
        result.type === 'yearly'
          ? '🎉 Code accepted! You\'re now Pro for a full year!'
          : '🎉 Code accepted! You\'re now Pro for a month!'
      );

      applyBtn.textContent = '✓ Activated!';
      applyBtn.style.background = 'rgba(0,255,136,0.2)';
      applyBtn.style.color = '#00FF88';

      // بعد لحظة: اغلق الـ modal وكمّل العملية
      setTimeout(async () => {
        modal.remove();
        window.toast?.('⚡ Pro activated! Continuing…', 'success');

        // أعد بناء الـ toolbar عشان يظهر Pro badge
        _buildToolbar();

        // كمّل الـ action الأصلي
        if (action === 'save')    saveDraft();
        if (action === 'publish') publish();

      }, 1500);

    } catch (err) {
      console.error('[Portfolio] activate_pro error:', err);
      applyBtn.disabled = false;
      applyBtn.textContent = 'Activate';
      _setCodeMsg(msgEl, 'error', 'Connection error. Please try again.');
    }
  }

  function _setCodeMsg(el, type, text) {
    const colors = {
      error:   '#FF4F4F',
      success: '#00FF88',
      loading: '#8A9E90',
    };
    el.style.color = colors[type] || '#8A9E90';
    el.textContent = text;
  }

  function _shakeInput(modal) {
    const input = modal.querySelector('#paywall-code-input');
    if (!input) return;
    input.style.borderColor = 'rgba(255,79,79,0.5)';
    input.animate([
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(0)' },
    ], { duration: 350, easing: 'ease-out' });
    setTimeout(() => { input.style.borderColor = 'rgba(0,255,136,0.15)'; }, 1000);
  }

  /* ═══════════════════════════════════════════════════════════════
     PRO THEME ELEMENT SETUP
  ═══════════════════════════════════════════════════════════════ */

  function _setupProThemeElements(themeId) {
    // ── Cleanup: شيل كل الـ elements الخاصة بكل theme ──────────
    // Editorial
    document.querySelector('.ed-ticker')?.remove();
    document.getElementById('ed-ink-cursor')?.remove();
    document.getElementById('ed-ink-ring')?.remove();
    // Noir
    document.querySelector('.nr-band')?.remove();
    document.getElementById('nr-cursor-ring')?.remove();
    document.getElementById('nr-cursor-dot')?.remove();
    document.body.classList.remove('nr-cursor-active');
    // Blueprint
    document.querySelector('.bp-titleblock')?.remove();
    document.getElementById('bp-h-line')?.remove();
    document.getElementById('bp-v-line')?.remove();
    document.getElementById('bp-cursor-dot')?.remove();
    document.getElementById('bp-coords')?.remove();
    document.querySelectorAll('.bp-brackets,.bp-dimensions').forEach(el => el.remove());
    document.body.classList.remove('bp-cursor-active');
    // Terminal
    document.querySelector('.tm-window')?.remove();
    document.querySelector('.tm-neofetch')?.remove();
    document.getElementById('tm-boot')?.remove();
    document.getElementById('tm-matrix')?.remove();
    document.getElementById('tm-name-cursor')?.remove();
    document.getElementById('tm-edit-cursor')?.remove();
    document.body.classList.remove('tm-cursor-active');
    // Liquid
    document.getElementById('lq-canvas')?.remove();
    document.getElementById('lq-cursor-outer')?.remove();
    document.getElementById('lq-cursor-dot')?.remove();
    document.querySelectorAll('.lq-bg-fallback,.lq-blob').forEach(el => el.remove());
    document.body.classList.remove('lq-cursor-active');
    // Glass3D v2
    document.getElementById('gl-canvas')?.remove();
    document.getElementById('gl-filters')?.remove();
    document.getElementById('gl-prism')?.remove();
    document.getElementById('gl-reveal-style')?.remove();
    document.getElementById('gl-ca-style')?.remove();
    document.body.classList.remove('gl-cursor-active');
    document.querySelectorAll('.gl-orb,.gl-bg').forEach(el => el.remove());
    // Cyberpunk v2
    ['cb-stream','cb-glitch-canvas','cb-reticle','cb-scan-label',
     'cb-reveal-style','cb-boot'].forEach(id => document.getElementById(id)?.remove());
    document.querySelectorAll(
      '.cb-alert,.cb-status,.cb-scanlines,.cb-grid-a,.cb-grid-b,.cb-grid-persp'
    ).forEach(el => el.remove());
    document.body.classList.remove('cb-cursor-active');
    document.body.style.filter = '';
    document.body.style.cursor = '';
    // Space v2
    ['sp-stars-far','sp-stars-mid','sp-stars-near','sp-warp','sp-nebula',
     'sp-reticle','sp-coords','sp-reveal-style'].forEach(id => document.getElementById(id)?.remove());
    document.querySelector('.sp-hud')?.remove();
    document.body.classList.remove('sp-cursor-active');
    // Legacy (backward compat)
    document.getElementById('glass-orb-3')?.remove();
    document.querySelector('.glass-particles')?.remove();
    document.querySelector('.space-nebula-layer')?.remove();
  }

  /* ═══════════════════════════════════════════════════════════════
     LANG COLORS
  ═══════════════════════════════════════════════════════════════ */

  const LANG_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5',
    Java: '#b07219', Rust: '#dea584', Go: '#00ADD8', Ruby: '#701516',
    PHP: '#4F5D95', C: '#555555', 'C++': '#f34b7d', 'C#': '#178600',
    Swift: '#ffac45', Kotlin: '#A97BFF', Dart: '#00B4AB',
    HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051',
    Vue: '#41b883', Svelte: '#ff3e00',
  };

  function _getLangColor(lang) { return LANG_COLORS[lang] || '#6b7280'; }

  /* ═══════════════════════════════════════════════════════════════
     EDITABLE HINTS
  ═══════════════════════════════════════════════════════════════ */

  function _addEditableHints() {
    $$('[contenteditable="true"]').forEach(el => {
      if (!el.getAttribute('data-hint-added')) {
        el.setAttribute('data-hint-added', 'true');
        el.setAttribute('title', 'Click to edit');
        const hint = document.createElement('span');
        hint.className = 'edit-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = 'Click to edit';
        el.parentElement?.appendChild(hint);
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════════ */

  async function init(options = {}) {
    // جلب الـ Pro status من Supabase أولاً
    _isPro = options.isPro ?? (await _loadProStatus());

    // Load draft
    _draft = window.AI?.getDraft?.() || options.draft || null;

    if (!_draft) {
      console.warn('[Portfolio] No draft found. Waiting for AI.generate()...');
      window.addEventListener('portfolio:draft-ready', (e) => {
        _draft = e.detail;
        _start();
      });
      return;
    }

    _start();
  }

  function _start() {
    if (_draft.theme) applyTheme(_draft.theme);
    applyDraftToDom(_draft);
    _buildToolbar();
    _initEditableFields();
    _addEditableHints();
    document.body.style.paddingTop = 'var(--toolbar-height, 56px)';
    console.log('[Portfolio] Edit mode initialized. Theme:', _draft.theme, '| Pro:', _isPro);
  }

  /* ═══════════════════════════════════════════════════════════════
     PRO THEME JS LIFECYCLE
  ═══════════════════════════════════════════════════════════════ */

  const PRO_THEME_SCRIPTS = {
    editorial: { src: 'js/themes/editorial.js',  global: 'EditorialFX', loaded: false },
    noir:      { src: 'js/themes/noir.js',        global: 'NoirFX',      loaded: false },
    blueprint: { src: 'js/themes/blueprint.js',   global: 'BlueprintFX', loaded: false },
    terminal:  { src: 'js/themes/terminal.js',    global: 'TerminalFX',  loaded: false },
    liquid:    { src: 'js/themes/liquid.js',       global: 'LiquidFX',   loaded: false },
    glass3d:   { src: 'js/themes/glass3d.js',     global: 'GlassFX',    loaded: false },
    cyberpunk: { src: 'js/themes/cyberpunk.js',   global: 'CyberpunkFX', loaded: false },
    space:     { src: 'js/themes/space.js',        global: 'SpaceFX',    loaded: false },
  };

  let _currentProFX = null;

  function loadThemeScript(themeName) {
    const config = PRO_THEME_SCRIPTS[themeName];
    if (!config || !config.src) return Promise.resolve(null);
    if (config.loaded && window[config.global]) return Promise.resolve(window[config.global]);

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = config.src; script.async = true; script.defer = true;
      script.onload = () => {
        config.loaded = true;
        const api = window[config.global];
        if (!api) { reject(new Error(`${config.global} not found`)); return; }
        resolve(api);
      };
      script.onerror = () => reject(new Error(`Failed to load ${config.src}`));
      document.head.appendChild(script);
    });
  }

  function deactivateCurrentProTheme() {
    if (!_currentProFX) return;
    try { _currentProFX.api?.destroy?.(); } catch (e) { console.warn(e); }
    _currentProFX = null;
  }

  async function activateProTheme(themeName) {
    deactivateCurrentProTheme();
    const config = PRO_THEME_SCRIPTS[themeName];
    if (!config || !config.src) return;
    try {
      const api = await loadThemeScript(themeName);
      if (!api) return;
      api.init();
      _currentProFX = { name: themeName, api };
    } catch (err) {
      console.error('[Portfolio] Error loading Pro theme:', err);
      window.toast?.('Could not load theme effects', 'error');
    }
  }

  const FREE_THEMES = new Set(['light', 'dark', 'minimal']);
  const PRO_THEMES  = new Set(['editorial','noir','blueprint','terminal','liquid','glass3d','cyberpunk','space']);

  async function handleThemeScriptLifecycle(themeName) {
    if (FREE_THEMES.has(themeName)) { deactivateCurrentProTheme(); return; }
    if (PRO_THEMES.has(themeName))  { await activateProTheme(themeName); return; }
    console.warn('[Portfolio] Unknown theme:', themeName);
  }

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════ */

  window.Portfolio = {
    init,
    applyTheme,
    openThemePanel,
    closeThemePanel,
    saveDraft,
    publish,
    undo,
    redo,
    getDraft:   () => _draft,
    isPro:      () => _isPro,
    loadThemeScript,
    activateProTheme,
    deactivateCurrentProTheme,
    handleThemeScriptLifecycle,
    // Feature 2: Custom Sections
    _addCustomSection,
  };

})();