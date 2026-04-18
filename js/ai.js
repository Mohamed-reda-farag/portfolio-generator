/**
 * js/ai.js — Portfolio Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Responsibilities:
 *  1. يستخدم window.GitHub (من github.js) لجلب البيانات
 *  2. يخزن generation record في Supabase DB
 *  3. يكلم Edge Function (generate) بالـ GitHub data
 *  4. يعرض progress real-time بـ Supabase Realtime
 *  5. يحفظ النتيجة في sessionStorage للـ Step 4 (portfolio.html)
 *  6. Error handling واضح للمستخدم مع toast notifications
 *
 * Dependencies (loaded before this file in HTML):
 *  - js/github.js          → window.GitHub
 *  - Supabase JS SDK       → window.supabase (from CDN)
 *
 * Script order in HTML:
 *  <script src="js/github.js"></script>
 *  <script src="js/ai.js"></script>   ← هنا
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  "use strict";

  // ─── Config ─────────────────────────────────────────────────────────────────

  const CONFIG = {
    SUPABASE_URL:        window.SUPABASE_URL      || "",
    SUPABASE_ANON_KEY:   window.SUPABASE_ANON_KEY || "",
    EDGE_FUNCTION_URL:   "", // يُحسب تلقائياً من SUPABASE_URL
    SESSION_KEY:         "pg_portfolio_draft",
    GENERATION_TIMEOUT_MS: 45_000,               // 45 ثانية max
    PROGRESS_STEPS: [
      { pct: 5,   label: "Fetching your GitHub profile…",  duration: 300  },
      { pct: 20,  label: "Analyzing your repositories…",   duration: 800  },
      { pct: 40,  label: "Understanding your tech stack…", duration: 600  },
      { pct: 60,  label: "Generating your bio with AI…",   duration: 1000 },
      { pct: 75,  label: "Writing project descriptions…",  duration: 800  },
      { pct: 88,  label: "Polishing your skills section…", duration: 500  },
      { pct: 95,  label: "Almost ready…",                  duration: 400  },
      { pct: 100, label: "Portfolio generated! 🎉",        duration: 200  },
    ],
  };

  // ─── State ──────────────────────────────────────────────────────────────────

  let _supabaseClient  = null;
  let _realtimeChannel = null;
  // [FIX] _progressTimer بدل _progressInterval — بيستخدم setTimeout مش setInterval
  let _progressTimer   = null;
  let _currentStepIndex = 0;
  let _progressEl      = null;
  let _progressLabelEl = null;
  let _isGenerating    = false;

  // ─── Supabase client (lazy init) ────────────────────────────────────────────

  function getSupabaseClient() {
    if (_supabaseClient) return _supabaseClient;

    if (window._supabaseClient) {
      _supabaseClient = window._supabaseClient;
      CONFIG.EDGE_FUNCTION_URL = `${CONFIG.SUPABASE_URL}/functions/v1/generate`;
      return _supabaseClient;
    }

    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      // [FIX] validation مبكرة — بدل الـ URL الفاضي الصامت
      console.warn("[AI] SUPABASE_URL أو SUPABASE_ANON_KEY مش موجودين — offline mode.");
      return null;
    }

    if (!window.supabase?.createClient) {
      console.warn("[AI] Supabase SDK not loaded.");
      return null;
    }

    _supabaseClient = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );

    CONFIG.EDGE_FUNCTION_URL = `${CONFIG.SUPABASE_URL}/functions/v1/generate`;
    return _supabaseClient;
  }

  // ─── Progress Bar Helpers ────────────────────────────────────────────────────

  function findProgressElements() {
    _progressEl      = document.querySelector("[data-progress-bar]");
    _progressLabelEl = document.querySelector("[data-progress-label]");
  }

  function setProgress(pct, label) {
    if (_progressEl) {
      _progressEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      _progressEl.setAttribute("aria-valuenow", pct);
    }
    if (_progressLabelEl && label) {
      _progressLabelEl.textContent = label;
    }
  }

  /**
   * يشغل الـ progress steps التلقائية (simulation).
   * [FIX] بيستخدم clearTimeout بدل clearInterval — لأن المتغير setTimeout handle
   */
  function startProgressSimulation() {
    _currentStepIndex = 0;
    // [FIX] clearTimeout بدل clearInterval
    clearTimeout(_progressTimer);

    function advanceStep() {
      if (_currentStepIndex >= CONFIG.PROGRESS_STEPS.length) return;

      const step = CONFIG.PROGRESS_STEPS[_currentStepIndex];
      setProgress(step.pct, step.label);
      _currentStepIndex++;

      // وقف عند 95% — استنى الـ real response
      if (step.pct >= 95) return;

      // [FIX] clearTimeout بدل clearInterval، وحفظ الـ handle في _progressTimer
      clearTimeout(_progressTimer);
      _progressTimer = setTimeout(advanceStep, step.duration);
    }

    advanceStep();
  }

  function stopProgressSimulation() {
    // [FIX] clearTimeout بدل clearInterval
    clearTimeout(_progressTimer);
    _progressTimer = null;
  }

  function completeProgress() {
    stopProgressSimulation();
    const last = CONFIG.PROGRESS_STEPS[CONFIG.PROGRESS_STEPS.length - 1];
    setProgress(last.pct, last.label);
  }

  // ─── Supabase Realtime ───────────────────────────────────────────────────────

  /**
   * يشترك في تحديثات الـ generation من Supabase Realtime.
   * [FIX] الـ Realtime status لا يتعارض مع الـ simulation —
   *       "processing" لا يرجع الـ progress للخلف
   */
  function subscribeToGenerationUpdates(generationId) {
    const sb = getSupabaseClient();
    if (!sb || !generationId) return;

    _realtimeChannel = sb
      .channel(`generation:${generationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ai_generations",
          filter: `id=eq.${generationId}`,
        },
        (payload) => {
          const { status } = payload.new || {};
          console.log("[AI] Realtime update:", status);

          if (status === "processing") {
            // [FIX] نتحقق إن الـ current progress أقل من 60 قبل ما نغيّره
            // عشان نمنع الـ bar من الرجوع للخلف لو الـ simulation وصلت أبعد
            const currentPct = parseFloat(_progressEl?.style.width || "0");
            if (currentPct < 60) {
              setProgress(60, "AI is writing your portfolio…");
            }
          } else if (status === "completed") {
            completeProgress();
          } else if (status === "failed") {
            stopProgressSimulation();
            setProgress(0, "Generation failed.");
          }
        }
      )
      .subscribe();
  }

  function unsubscribeRealtime() {
    if (_realtimeChannel) {
      const sb = getSupabaseClient();
      if (sb) sb.removeChannel(_realtimeChannel);
      _realtimeChannel = null;
    }
  }

  // ─── DB Helpers ──────────────────────────────────────────────────────────────

  /**
   * يخزن record في ai_generations قبل الـ generation.
   * [FIX] بيخزّن summary بس بدل الـ githubData كاملة — يقلل الـ payload في DB
   */
  async function createGenerationRecord(userId, githubData) {
    const sb = getSupabaseClient();
    if (!sb) return null;

    const id = crypto.randomUUID();

    // [FIX] بنخزن summary بس مش الـ raw data كاملة (all_repos ممكن يكون 30 repo)
    const summary = {
      username:    githubData?.user?.login,
      total_repos: githubData?.total_repos,
      total_stars: githubData?.total_stars,
      top_repo_count: githubData?.top_repos?.length,
      fetched_at:  githubData?.fetched_at,
    };

    const { error } = await sb
      .from("ai_generations")
      .insert({
        id,
        user_id:     userId || null,
        status:      "pending",
        github_data: summary,
      });

    if (error) {
      console.warn("[AI] Could not create generation record:", error.message);
      return null;
    }

    return id;
  }

  // ─── Session Storage ──────────────────────────────────────────────────────────

  function savePortfolioDraft(data) {
    try {
      sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify({
        ...data,
        _savedAt: Date.now(),
        _version: "1.0",
      }));
    } catch (e) {
      console.warn("[AI] sessionStorage write failed:", e.message);
    }
  }

  function getPortfolioDraft() {
    try {
      const raw = sessionStorage.getItem(CONFIG.SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Draft صالح لـ 24 ساعة (كان 2 — زوّدناه لـ UX أفضل)
      if (Date.now() - parsed._savedAt > 24 * 60 * 60 * 1000) {
        sessionStorage.removeItem(CONFIG.SESSION_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function clearPortfolioDraft() {
    sessionStorage.removeItem(CONFIG.SESSION_KEY);
  }

  // ─── Error Messages ───────────────────────────────────────────────────────────

  const ERROR_MESSAGES = {
    RATE_LIMITED:
      "The AI is a bit busy right now. Please try again in 30 seconds.",
    AUTH_ERROR:
      "Server configuration issue. Please contact support.",
    PARSE_ERROR:
      "The AI response was unexpected. Please try again.",
    INVALID_STRUCTURE:
      "The AI returned an incomplete response. Please try again.",
    GROQ_ERROR:
      "The AI service is temporarily unavailable. Please try again.",
    NETWORK:
      "Network error — check your connection and try again.",
    TIMEOUT:
      "Generation timed out. GitHub or AI might be slow — please retry.",
    GITHUB_MISSING:
      "Could not find GitHub data. Please go back and fetch your GitHub profile first.",
    DEFAULT:
      "Something went wrong. Please try again.",
  };

  function getErrorMessage(code) {
    if (!code) return ERROR_MESSAGES.DEFAULT;
    const key = Object.keys(ERROR_MESSAGES).find((k) =>
      code.toUpperCase().includes(k)
    );
    return key ? ERROR_MESSAGES[key] : ERROR_MESSAGES.DEFAULT;
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────

  function showToast(message, type = "error") {
    if (typeof window.toast === "function") {
      window.toast(message, type);
    } else {
      // [FIX] حذف alert() — blocking ويكسر الـ UX. console فقط كـ fallback
      console[type === "error" ? "error" : "log"](`[Toast] ${message}`);
    }
  }

  // ─── Button State ─────────────────────────────────────────────────────────────

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.classList.add("loading");
      btn.textContent = "Generating…";
    } else {
      btn.disabled = false;
      btn.classList.remove("loading");
      btn.textContent = btn.dataset.originalText || "Generate Portfolio";
    }
  }

  // ─── Helper: sleep ────────────────────────────────────────────────────────────
  // مُعرَّفة محلياً داخل الـ IIFE لضمان توافرها بغض النظر عن ترتيب تحميل app.js.
  // window.sleep من app.js مطابقة لكن لا نعتمد عليها هنا.
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Core: Generate Portfolio ─────────────────────────────────────────────────

  /**
   * الدالة الرئيسية — تُستدعى من الـ form submit في index.html
   *
   * @param {object} options
   * @param {string} options.githubUsername  - من الـ form
   * @param {string} options.fullName        - من الـ form
   * @param {string} options.jobTitle        - من الـ form
   * @param {string} [options.theme]         - الـ theme المختارة (default: 'dark')
   * @param {HTMLElement} [options.submitBtn] - زر الـ submit للـ loading state
   * @param {string} [options.redirectUrl]   - الصفحة اللي يروح عليها بعد الـ generation
   * @returns {Promise<{success: boolean, data?: object, error?: string}>}
   */
  async function generatePortfolio({
    githubUsername,
    fullName,
    jobTitle = "Software Developer",
    theme = "dark",
    submitBtn = null,
    redirectUrl = "edit.html",
  } = {}) {
    if (_isGenerating) {
      console.warn("[AI] Generation already in progress.");
      return { success: false, error: "Already generating." };
    }

    if (!githubUsername) {
      showToast("Please enter a GitHub username.", "error");
      return { success: false, error: "Missing GitHub username." };
    }

    if (!window.GitHub?.fetchGitHubData) {
      showToast(ERROR_MESSAGES.GITHUB_MISSING, "error");
      return { success: false, error: "GitHub module not loaded." };
    }

    _isGenerating = true;
    setButtonLoading(submitBtn, true);
    findProgressElements();

    const progressContainer = document.querySelector("[data-progress-container]");
    if (progressContainer) {
      progressContainer.style.display = "block";
      progressContainer.setAttribute("aria-hidden", "false");
    }

    // [FIX] نبدأ الـ simulation من صفر ولا نتعارض معاه بـ manual setProgress
    // الـ simulation تتولى الـ progress من 5% → 95%
    // الـ manual setProgress بس بعد انتهاء الـ generation
    startProgressSimulation();

    try {
      // ── Step 1: جلب GitHub data ────────────────────────────────────────────
      // github.js لديها timeouts داخلية على كل request (API_TIMEOUT=5s, ghFetch=10s).
      // الـ GH_TIMEOUT_MS هو ceiling خارجي للعملية كاملة.
      const GH_TIMEOUT_MS = 30_000;
      let githubData;
      try {
        const ghAbort = new AbortController();
        const ghTimer = setTimeout(() => ghAbort.abort(), GH_TIMEOUT_MS);

        try {
          githubData = await Promise.race([
            window.GitHub.fetchGitHubData(githubUsername),
            new Promise((_, reject) => {
              ghAbort.signal.addEventListener("abort", () =>
                reject(new Error("TIMEOUT: GitHub fetch timed out."))
              );
            }),
          ]);
        } finally {
          // [FIX] finally يضمن clearTimeout سواء نجح الـ race أو فشل
          clearTimeout(ghTimer);
        }
      } catch (ghError) {
        const msg = ghError.message || "";
        if (msg.includes("NOT_FOUND")) {
          throw new Error("GitHub user not found. Please check the username.");
        }
        if (msg.includes("RATE_LIMITED")) {
          throw new Error("GitHub rate limit reached. Please try again in a few minutes.");
        }
        if (msg.includes("EMPTY_PROFILE")) {
          throw new Error("This GitHub account has no public repositories to analyze.");
        }
        throw ghError;
      }

      await sleep(200);

      // ── Step 2: تخزين generation record في DB ──────────────────────────────
      const sb = getSupabaseClient();
      let generationId = null;

      if (sb) {
        const currentUser = (await sb.auth.getUser())?.data?.user;
        generationId = await createGenerationRecord(
          currentUser?.id || null,
          githubData
        );
        if (generationId) {
          subscribeToGenerationUpdates(generationId);
        }
      }

      // ── Step 3: استدعاء Edge Function ──────────────────────────────────────
      const edgeUrl = CONFIG.EDGE_FUNCTION_URL ||
        `${CONFIG.SUPABASE_URL}/functions/v1/generate`;

      if (!edgeUrl || edgeUrl === '/functions/v1/generate') {
        throw new Error("AUTH_ERROR: Supabase URL not configured.");
      }

      const headers = { "Content-Type": "application/json" };

      if (sb) {
        const { data: sessionData } = await sb.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        headers["Authorization"] = accessToken
          ? `Bearer ${accessToken}`
          : `Bearer ${CONFIG.SUPABASE_ANON_KEY}`;
      } else {
        headers["Authorization"] = `Bearer ${CONFIG.SUPABASE_ANON_KEY}`;
      }

      // [FIX] AbortController للـ fetch timeout بدل Promise.race المتسرب
      const aiAbort  = new AbortController();
      const aiTimer  = setTimeout(
        () => aiAbort.abort(),
        CONFIG.GENERATION_TIMEOUT_MS
      );

      let response;
      try {
        response = await fetch(edgeUrl, {
          method: "POST",
          headers,
          signal: aiAbort.signal,
          body: JSON.stringify({
            githubData: {
              user: {
                ...githubData.user,
                languages: Object.fromEntries(
                  githubData.languages.map(l => [l.language, l.bytes])
                ),
              },
              repos: githubData.top_repos,
            },
            jobTitle,
            generationId,
          }),
        });
        clearTimeout(aiTimer);
      } catch (fetchError) {
        clearTimeout(aiTimer);
        if (fetchError.name === "AbortError") {
          throw new Error("TIMEOUT: AI generation timed out.");
        }
        throw new Error("NETWORK: Could not reach the generation server.");
      }

      // ── Step 4: Parse response ─────────────────────────────────────────────
      let responseData;
      try {
        responseData = await response.json();
      } catch {
        throw new Error("PARSE_ERROR: Server returned invalid response.");
      }

      if (!response.ok || !responseData.success) {
        const errorCode = responseData?.code || `HTTP_${response.status}`;
        throw new Error(`${errorCode}: ${responseData?.error || "Generation failed."}`);
      }

      const aiData = responseData.data;

      // ── Step 5: حفظ في sessionStorage ──────────────────────────────────────
      const portfolioDraft = {
        bio:            aiData.bio,
        skills:         aiData.skills,
        projects:       aiData.projects,
        githubUser:     githubData.user,
        githubRepos:    githubData.top_repos,
        fullName:       fullName || githubData.user.name || githubUsername,
        jobTitle,
        theme,
        githubUsername,
        generationId,
      };

      savePortfolioDraft(portfolioDraft);

      // ── Step 6: إنهاء الـ progress ──────────────────────────────────────────
      completeProgress();
      await sleep(600);

      unsubscribeRealtime();

      // ── Step 7: Redirect ────────────────────────────────────────────────────
      console.log("[AI] Generation complete! Redirecting to", redirectUrl);
      window.location.href = redirectUrl;
      // لا return هنا — الـ redirect يحصل فوراً والـ JS بيتوقف تدريجياً

    } catch (error) {
      stopProgressSimulation();
      unsubscribeRealtime();

      const errorMsg  = error.message || "";
      const errorCode = errorMsg.split(":")[0]?.trim();
      const userMessage = getErrorMessage(errorCode);

      console.error("[AI] Generation failed:", error);

      showToast(userMessage, "error");

      // [FIX] بنخفي الـ container مباشرة بدل ما نرجع progress للـ 0 أولاً
      const progressContainer = document.querySelector("[data-progress-container]");
      if (progressContainer) {
        setTimeout(() => {
          progressContainer.style.display = "none";
        }, 1500);
      }

      return { success: false, error: userMessage };

    } finally {
      _isGenerating = false;
      setButtonLoading(submitBtn, false);
    }
  }

  // ─── Auto-init: Form Listener ─────────────────────────────────────────────────

  function initFormListener() {
    const form = document.querySelector("[data-generate-form]");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const githubUsername = (
        form.querySelector("[data-field='github-username']")?.value ||
        form.querySelector("#input-github")?.value ||
        ""
      ).trim();

      const fullName = (
        form.querySelector("[data-field='name']")?.value ||
        form.querySelector("#input-name")?.value ||
        ""
      ).trim();

      const jobTitle = (
        form.querySelector("[data-field='job-title']")?.value ||
        form.querySelector("#input-title")?.value ||
        ""
      ).trim();

      // [FIX] الأولوية من الأحدث للأقدم:
      // pg_intended_theme = Pro theme اختاره المستخدم من landing (الأحدث دائماً)
      // pg_selected_theme = theme عام
      // pg_theme          = free theme قديم (الأقدم — يُقرأ أخيراً)
      let theme = "dark";
      try {
        const savedTheme =
          sessionStorage.getItem("pg_intended_theme") ||
          sessionStorage.getItem("pg_selected_theme") ||
          sessionStorage.getItem("pg_theme");
        if (savedTheme) theme = savedTheme;
      } catch {}

      const submitBtn = form.querySelector("[type='submit']");

      await generatePortfolio({
        githubUsername,
        fullName,
        jobTitle,
        theme,
        submitBtn,
        redirectUrl: "edit.html",
      });
    });

    console.log("[AI] Form listener attached.");
  }

  // ─── Auto-init on DOMContentLoaded ───────────────────────────────────────────

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFormListener);
  } else {
    initFormListener();
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  window.AI = {
    generate:   generatePortfolio,
    getDraft:   getPortfolioDraft,
    clearDraft: clearPortfolioDraft,
    saveDraft:  savePortfolioDraft,
    SESSION_KEY: CONFIG.SESSION_KEY,
    get isGenerating() { return _isGenerating; },
  };

  console.log("[AI] ai.js loaded — window.AI ready.");
})();