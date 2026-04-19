/**
 * auth.js — window.Auth
 * GitHub OAuth عبر Supabase
 * Dependencies: Supabase JS SDK (global), window.SUPABASE_URL, window.SUPABASE_ANON_KEY
 */

;(function () {
  'use strict';

  // ─── Supabase client (shared with ai.js لو موجود) ─────────────────────────
  let _supabase = null;

  function getClient() {
    if (_supabase) return _supabase;
    if (window._supabaseClient) {
      _supabase = window._supabaseClient;
      return _supabase;
    }
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      console.error('[Auth] SUPABASE_URL أو SUPABASE_ANON_KEY مش موجودين');
      return null;
    }
    _supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    window._supabaseClient = _supabase; // share مع ai.js
    return _supabase;
  }

  // ─── State ─────────────────────────────────────────────────────────────────
  let _currentUser = null;
  let _listeners   = [];

  // ─── Core Auth Functions ───────────────────────────────────────────────────

  /**
   * تسجيل دخول بـ GitHub OAuth
   * @param {string} [redirectTo] - URL بعد الـ login (default: dashboard.html)
   */
  async function signIn(redirectTo) {
    const client = getClient();
    if (!client) return { error: 'Supabase client غير مهيأ' };

    const destination = redirectTo || _buildRelativeURL('dashboard.html');

    const { error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: destination,
        scopes: 'read:user user:email public_repo',
      },
    });

    if (error) {
      console.error('[Auth] signIn error:', error.message);
      return { error: error.message };
    }

    return { error: null };
  }

  /**
   * تسجيل خروج
   */
  async function signOut() {
    const client = getClient();
    if (!client) return;

    const { error } = await client.auth.signOut();
    if (error) console.error('[Auth] signOut error:', error.message);

    _currentUser = null;
    _notifyListeners(null);

    // Redirect للـ landing page
    window.location.href = _buildRelativeURL('index.html');
  }

  /**
   * جيب المستخدم الحالي (من الـ session أو null)
   * @returns {Promise<object|null>}
   */
  async function getUser() {
    if (_currentUser) return _currentUser;

    const client = getClient();
    if (!client) return null;

    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session) return null;

    _currentUser = _buildUserObject(session.user);
    return _currentUser;
  }

  /**
   * Subscribe على تغيير الـ auth state
   * @param {function} callback - بيتنادى بـ (user | null)
   * @returns {function} unsubscribe
   */
  function onAuthStateChange(callback) {
    _listeners.push(callback);

    const client = getClient();
    if (!client) return () => {};

    const { data: { subscription } } = client.auth.onAuthStateChange(
      (event, session) => {
        const user = session ? _buildUserObject(session.user) : null;
        _currentUser = user;
        _notifyListeners(user);
      }
    );

    // Cleanup function
    return () => {
      _listeners = _listeners.filter(l => l !== callback);
      subscription?.unsubscribe();
    };
  }

  // ─── Auto-fill Form ────────────────────────────────────────────────────────

  /**
   * لو المستخدم logged in:
   * - بيخفي حقول الاسم والـ job title
   * - بيحط الـ github_username تلقائياً
   * - بيحدث الـ Nav
   */
  async function setupIndexPageAuth() {
    const user = await getUser();

    _updateNav(user);

    if (!user) return;

    // إخفاء الحقول اللي بتيجي من OAuth
    const nameField   = document.querySelector('[data-field="name"]');
    const jobField    = document.querySelector('[data-field="job-title"]');
    const nameWrapper = nameField?.closest('.form-group') || nameField?.parentElement;
    const jobWrapper  = jobField?.closest('.form-group')  || jobField?.parentElement;

    if (nameWrapper) nameWrapper.style.display = 'none';
    if (jobWrapper)  jobWrapper.style.display  = 'none';

    // Auto-fill GitHub username
    const usernameInput = document.querySelector('[data-field="github-username"]');
    if (usernameInput && user.githubUsername) {
      usernameInput.value = user.githubUsername;
      usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // [FIX] جيب الـ jobTitle من Supabase DB (مش من OAuth metadata اللي دايماً فاضية)
    let jobTitleFromDB = '';
    try {
      const client = getClient();
      if (client) {
        const { data: userData } = await client
          .from('users')
          .select('job_title')
          .eq('id', user.id)
          .single();
        jobTitleFromDB = userData?.job_title || '';
      }
    } catch (err) {
      // Non-critical — fallback to empty string, لكن نسجّل للـ debug
      console.warn('[Auth] Could not fetch job_title from DB:', err?.message);
    }

    // حفظ بيانات المستخدم في sessionStorage عشان الـ AI يستخدمها
    sessionStorage.setItem('auth_user', JSON.stringify({
      name:           user.name,
      jobTitle:       jobTitleFromDB, // [FIX] من DB بدل OAuth metadata
      githubUsername: user.githubUsername,
    }));
  }

  /**
   * Redirect logic بعد الـ generation:
   * - logged in  → dashboard.html
   * - logged out → portfolio.html
   * [FIX] async — بنتأكد من الـ session الحالية بدل الاعتماد على _currentUser
   * اللي ممكن يكون null لو اتنادت قبل DOMContentLoaded init.
   */
  async function getPostGenerationRedirect() {
    const user = await getUser();
    return user
      ? _buildRelativeURL('dashboard.html')
      : _buildRelativeURL('portfolio.html');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function _buildUserObject(supabaseUser) {
    const meta = supabaseUser.user_metadata || {};
    return {
      id:             supabaseUser.id,
      email:          supabaseUser.email,
      name:           meta.full_name || meta.name || meta.user_name || '',
      githubUsername: meta.user_name  || meta.preferred_username || '',
      avatarUrl:      meta.avatar_url || `https://avatars.githubusercontent.com/${meta.user_name}`,
      // [FIX] jobTitle لا يُجلب من OAuth metadata (دايماً فاضية)
      // بيتجلب من Supabase DB في setupIndexPageAuth
      jobTitle: '',
    };
  }

  function _notifyListeners(user) {
    _listeners.forEach(fn => {
      try { fn(user); } catch (e) { console.error('[Auth] listener error:', e); }
    });
  }

  // [FIX] دمج _buildDashboardURL و_buildRelativeURL في helper واحد
  function _buildRelativeURL(page) {
    const origin = window.location.origin.replace('127.0.0.1', 'localhost');
    const base   = window.location.pathname.replace(/\/[^/]*$/, '/');
    return origin + base + page;
  }

  /** تحديث الـ Nav بناءً على الـ auth state */
  function _updateNav(user) {
    const signInBtn  = document.querySelector('[data-nav-signin]');
    const dashBtn    = document.querySelector('[data-nav-dashboard]');
    const avatarEl   = document.querySelector('[data-nav-avatar]');
    const signOutBtn = document.querySelector('[data-nav-signout]');

    if (user) {
      signInBtn?.classList.add('hidden');
      dashBtn?.classList.remove('hidden');
      signOutBtn?.classList.remove('hidden');

      if (avatarEl) {
        avatarEl.src = user.avatarUrl;
        avatarEl.alt = user.name;
        avatarEl.classList.remove('hidden');
      }
    } else {
      signInBtn?.classList.remove('hidden');
      dashBtn?.classList.add('hidden');
      signOutBtn?.classList.add('hidden');
      avatarEl?.classList.add('hidden');
    }
  }

  // ─── Dashboard Page Init ───────────────────────────────────────────────────

  /**
   * يُستخدم في dashboard.html
   * بيجلب كل portfolios المستخدم من Supabase
   */
  async function getDashboardData() {
    const client = getClient();
    if (!client) return { user: null, portfolios: [] };

    const user = await getUser();
    if (!user) return { user: null, portfolios: [] };

    const { data: portfolios, error } = await client
      .from('portfolios')
      .select(`
        id,
        slug,
        theme,
        is_published,
        updated_at,
        bio,
        projects ( id, github_repo_name, stars, language )
      `)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[Auth] getDashboardData error:', error.message);
      return { user, portfolios: [] };
    }

    return { user, portfolios: portfolios || [] };
  }

  /**
   * حذف portfolio بالكامل
   */
  async function deletePortfolio(portfolioId) {
    const client = getClient();
    if (!client) return { error: 'Client غير مهيأ' };

    const { error } = await client
      .from('portfolios')
      .delete()
      .eq('id', portfolioId);

    return { error: error?.message || null };
  }

  /**
   * Toggle published state
   */
  async function togglePublish(portfolioId, currentState) {
    const client = getClient();
    if (!client) return { error: 'Client غير مهيأ' };

    const { error } = await client
      .from('portfolios')
      .update({ is_published: !currentState })
      .eq('id', portfolioId);

    return { error: error?.message || null };
  }

  // ─── Auto-init ─────────────────────────────────────────────────────────────

  // [FIX] guard ضد double-init لو setupIndexPageAuth اتنادت يدوياً
  let _indexPageAuthDone = false;

  // بيتشغل تلقائياً على أي صفحة بيتحمل فيها auth.js
  document.addEventListener('DOMContentLoaded', async () => {
    const client = getClient();
    if (!client) return;

    // Initialize session
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      _currentUser = _buildUserObject(session.user);
    }

    // الصفحة الرئيسية
    if (document.querySelector('[data-page="index"]') && !_indexPageAuthDone) {
      _indexPageAuthDone = true;
      await setupIndexPageAuth();
    }

    // Dashboard — redirect لو مش logged in
    if (document.querySelector('[data-page="dashboard"]')) {
      // [FIX] لو في #access_token في الـ URL، ده معناه OAuth redirect جديد.
      // Supabase بياخد وقت يـ parse الـ hash ويحفظ الـ session —
      // نستنى الـ onAuthStateChange يـ fire بدل الـ check الفوري.
      const hasOAuthToken = window.location.hash.includes('access_token');

      if (hasOAuthToken) {
        // نستنى الـ SIGNED_IN event من Supabase (بيجي في ثوانٍ)
        const { data: { subscription } } = client.auth.onAuthStateChange((event, newSession) => {
          if (event === 'SIGNED_IN' && newSession) {
            _currentUser = _buildUserObject(newSession.user);
            subscription.unsubscribe();
            // نظّف الـ hash من الـ URL بدون reload
            window.history.replaceState(null, '', window.location.pathname);
            _updateNav(_currentUser);
          } else if (event === 'SIGNED_OUT' || !newSession) {
            subscription.unsubscribe();
            window.location.href = _buildRelativeURL('index.html');
          }
        });
      } else if (!_currentUser) {
        window.location.href = _buildRelativeURL('index.html');
        return;
      } else {
        _updateNav(_currentUser);
      }
    }
  });

  // ─── Public API ────────────────────────────────────────────────────────────
  window.Auth = {
    signIn,
    signOut,
    getUser,
    onAuthStateChange,
    getDashboardData,
    deletePortfolio,
    togglePublish,
    getPostGenerationRedirect,
    // [FIX] setupIndexPageAuth محمية بـ guard ضد double-init
    setupIndexPageAuth: async () => {
      if (_indexPageAuthDone) return;
      _indexPageAuthDone = true;
      await setupIndexPageAuth();
    },
  };

})();