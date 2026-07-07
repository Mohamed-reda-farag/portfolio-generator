/**
 * github.js — Portfolio Generator
 * GitHub REST API v3 integration
 *
 * Responsibilities:
 *  - Fetch user profile
 *  - Fetch public repositories (paginated)
 *  - Fetch README content per repo
 *  - Extract languages breakdown
 *  - Smart sorting algorithm (priority score)
 *  - Rate limit detection & handling
 *  - Full error taxonomy
 *
 * [FIXED] مشكلة "العالق على نفس الريبو" — السبب الجذري كان: كل النداءات هنا
 * كانت من غير أي مصادقة ("No auth token required — public data only")،
 * وده بيحطها تحت حد GitHub الرسمي لغير المُصادَق عليهم: 60 نداء/ساعة للـ IP
 * الواحد. تشغيلة واحدة من fetchGitHubData() كانت بتعمل ~42 نداء (بروفايل +
 * قايمة repos + حتى 20 candidate × 2 نداء)، يعني ~70% من الحد كامل في
 * تشغيلة واحدة — وأي تشغيلة تانية (retry أو مستخدم تاني على نفس الشبكة)
 * كانت بتضرب 429/403، واللي كان بيُبلّع بصمت كـ "الريبو ده مفهوش بيانات"
 * بدل ما يوضّح إنه rate-limit. الحل (3 أجزاء):
 *  1. تقليل عدد الـ candidates من 20 لـ 8 — يقلل النداءات لحد ~18/تشغيلة.
 *  2. لو حصل rate-limit فعلاً، نوقف باقي الـ batches فورًا (نوفّر الباقي من
 *     الميزانية) ونرجّع النتيجة مع علم rate_limited=true بدل ما نكمل
 *     نضرب الحد بصمت — وreadme-analyzer.js بيعرض تنبيه واضح للمستخدم.
 *  3. كل النداءات دلوقتي بتعدّي عبر edge function (`github-proxy`) بيحمل
 *     GitHub token من جانب السيرفر — فبيرفع الحد لـ 5000/ساعة (مُصادَق
 *     عليه). ملحوظة: الحد ده بقى budget مشترك بين كل مستخدمي الموقع مش
 *     لكل IP لوحده — كافي جدًا للاستخدام العادي، بس تحت ضغط استخدام كبير
 *     ومتزامن ممكن يوصل له تأثير (نادر جدًا مقارنة بـ 60/ساعة القديمة).
 *  4. [FIXED لاحقًا] السبب الجذري الفعلي اللي فضل مخفي رغم الإصلاحات فوق:
 *     fetchGitHubData() كانت بتتخطى محاولة جلب README خالص لأي candidate
 *     من غير "description" ومن غير نجوم على GitHub (شرط "توفير وقت" قديم)
 *     — فمشاريع شخصية حقيقية بمعاها README كامل كانت بتتحط null من غير
 *     ما نسأل GitHub أصلاً. اتشال الشرط ده؛ نجيب README لكل candidate
 *     (أصلاً محدودين بـ MAX_CANDIDATES) من غير تصفية إضافية.
 *
 * API base (عبر الـ proxy): https://api.github.com
 */

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────── */
const MAX_REPOS_FETCH   = 100;   // GitHub API max per page
const MAX_REPOS_SHOWN   = 6;     // Portfolio limit
const MAX_CANDIDATES    = 8;     // [FIXED] كان 20 — قللناه عشان نقلل النداءات لكل تشغيلة
const README_TIMEOUT    = 5_000; // ms — skip README if slow
const CACHE_TTL         = 5 * 60 * 1000; // 5 min in-memory cache
const GITHUB_PROXY_FN   = 'github-proxy'; // [FIXED] اسم edge function اللي بتحمل الـ token

/* ─────────────────────────────────────────────────────────────────
   IN-MEMORY CACHE
   Prevents redundant API calls if user hits generate twice
───────────────────────────────────────────────────────────────── */
const _cache = new Map(); // key → { data, ts }

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

/**
 * [FIXED] مكمّل لإصلاح مشكلة 2-ب — cacheGet() بيرجع null لحالتين مختلفتين:
 * "مفيش cache entry خالص" و"فيه entry بس قيمته null فعلاً" (زي repos من
 * غير README). fetchRepoReadme() كانت بتفرّق بينهم غلط (`cached !== null`)
 * فتعيد الطلب للشبكة تاني في كل مرة حتى لو النتيجة السلبية محفوظة فعلاً —
 * ده بيزوّد عدد الطلبات لـ raw.githubusercontent.com/api.github.com من غير
 * داعي، وهو نفس نوع الضغط اللي سبب مشكلة "العالق على نفس الريبو". الحل:
 * فحص وجود الـ entry بشكل مستقل عن قيمته.
 */
function cacheHas(key) {
  const entry = _cache.get(key);
  if (!entry) return false;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return false;
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────────
   ERROR TYPES
───────────────────────────────────────────────────────────────── */
class GitHubError extends Error {
  /**
   * @param {string} message   — human-readable
   * @param {string} code      — machine-readable key
   * @param {number} [status]  — HTTP status if applicable
   */
  constructor(message, code, status = null) {
    super(message);
    this.name   = 'GitHubError';
    this.code   = code;
    this.status = status;
  }
}

const GH_ERRORS = {
  NOT_FOUND:     (u) => new GitHubError(`GitHub user "${u}" not found. Check the username and try again.`, 'NOT_FOUND', 404),
  RATE_LIMITED:  (reset) => new GitHubError(`GitHub API rate limit reached. Try again after ${reset}.`, 'RATE_LIMITED', 429),
  EMPTY_PROFILE: (u) => new GitHubError(`"${u}" has no public repositories. Make some repos public first!`, 'EMPTY_PROFILE'),
  NETWORK:       () => new GitHubError('Network error. Check your connection and try again.', 'NETWORK'),
  SERVER:        (s) => new GitHubError(`GitHub API error (${s}). Try again in a moment.`, 'SERVER', s),
  FORBIDDEN:     () => new GitHubError('Access denied by GitHub API. Try again later.', 'FORBIDDEN', 403),
};

/* ─────────────────────────────────────────────────────────────────
   CORE FETCH WRAPPER
───────────────────────────────────────────────────────────────── */
/**
 * [FIXED] كانت بتعمل fetch() مباشر لـ api.github.com بدون أي مصادقة (حد
 * 60/ساعة للـ IP). دلوقتي بتعدّي عبر edge function (github-proxy) بيحمل
 * GitHub token من env، فالحد بقى 5000/ساعة. الـ proxy بيرجّع دايمًا HTTP
 * 200 مع envelope { status, headers, body } يعكس رد GitHub الحقيقي —
 * فمنطق فحص 429/403/404 هنا فضل زي ما هو تمامًا، بس بيقرأ من الـ envelope
 * بدل الرد المباشر.
 *
 * @param {string} path — مسار GitHub API بس (مثلاً "/users/torvalds")، من غير الدومين
 * @param {RequestInit} [options] — حاليًا مش مستخدمة (كل نداءاتنا GET)، سايبينها للتوافق المستقبلي
 * @param {number} [timeoutMs]
 * @returns {Promise<any>} الـ body المُفكّك (parsed JSON) من رد GitHub
 */
async function ghFetch(path, options = {}, timeoutMs = 10_000) {
  const sb = window._supabaseClient;
  if (!sb) throw GH_ERRORS.NETWORK();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let proxyResult;
  try {
    const { data, error } = await sb.functions.invoke(GITHUB_PROXY_FN, {
      body: { path },
    });
    if (error) throw error;
    proxyResult = data;
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError' || controller.signal.aborted) {
      throw new GitHubError('Request timed out. GitHub might be slow — try again.', 'TIMEOUT');
    }
    throw GH_ERRORS.NETWORK();
  } finally {
    clearTimeout(timer);
  }

  if (!proxyResult || typeof proxyResult.status !== 'number') {
    throw GH_ERRORS.NETWORK();
  }

  const { status, headers = {}, body } = proxyResult;

  // Rate limit check (نفس المنطق القديم بالضبط، بس من الـ envelope)
  if (status === 429 || status === 403) {
    const remaining = headers['x-ratelimit-remaining'];

    if (remaining === '0' || status === 429) {
      const resetTs = headers['x-ratelimit-reset'];
      const resetDate = resetTs
        ? new Date(parseInt(resetTs, 10) * 1000).toLocaleTimeString()
        : 'a few minutes';
      throw GH_ERRORS.RATE_LIMITED(resetDate);
    }

    throw GH_ERRORS.FORBIDDEN();
  }

  if (status === 404) return null; // Caller decides what 404 means
  if (status >= 500) throw GH_ERRORS.SERVER(status);
  if (status < 200 || status >= 300) throw GH_ERRORS.SERVER(status);

  return body;
}

/* ─────────────────────────────────────────────────────────────────
   1. FETCH USER PROFILE
───────────────────────────────────────────────────────────────── */
/**
 * @param {string} username
 * @returns {Promise<GitHubUser>}
 *
 * @typedef {Object} GitHubUser
 * @property {string} login
 * @property {string} name
 * @property {string|null} bio
 * @property {string|null} avatar_url
 * @property {string|null} company
 * @property {string|null} location
 * @property {string|null} blog
 * @property {string|null} twitter_username
 * @property {number} public_repos
 * @property {number} followers
 * @property {number} following
 * @property {string} html_url
 * @property {string} created_at
 */
async function fetchUserProfile(username) {
  const cacheKey = `user:${username}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await ghFetch(`/users/${username}`);

  if (!data) throw GH_ERRORS.NOT_FOUND(username);

  const profile = {
    login:            data.login,
    name:             data.name || data.login,
    bio:              data.bio   || null,
    avatar_url:       data.avatar_url || null,
    company:          data.company   || null,
    location:         data.location  || null,
    blog:             data.blog      || null,
    twitter_username: data.twitter_username || null,
    public_repos:     data.public_repos || 0,
    followers:        data.followers    || 0,
    following:        data.following    || 0,
    html_url:         data.html_url,
    created_at:       data.created_at,
  };

  cacheSet(cacheKey, profile);
  return profile;
}

/* ─────────────────────────────────────────────────────────────────
   2. FETCH REPOSITORIES (paginated)
───────────────────────────────────────────────────────────────── */
/**
 * Fetches ALL public repos for a user (handles pagination).
 * GitHub API max = 100 per page.
 *
 * @param {string} username
 * @returns {Promise<RawRepo[]>}
 *
 * @typedef {Object} RawRepo
 * @property {number} id
 * @property {string} name
 * @property {string} full_name
 * @property {string} html_url
 * @property {string|null} description
 * @property {boolean} fork
 * @property {boolean} archived
 * @property {boolean} disabled
 * @property {boolean} private
 * @property {string|null} language
 * @property {number} stargazers_count
 * @property {number} forks_count
 * @property {number} open_issues_count
 * @property {number} size
 * @property {string[]} topics
 * @property {string} pushed_at
 * @property {string} updated_at
 * @property {string} created_at
 * @property {string} default_branch
 */
async function fetchUserRepos(username) {
  const cacheKey = `repos:${username}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let allRepos = [];
  let page = 1;

  // Paginate until we have everything or hit our fetch cap
  while (true) {
    const url = `/users/${username}/repos?type=public&sort=pushed&direction=desc&per_page=${MAX_REPOS_FETCH}&page=${page}`;
    const batch = await ghFetch(url);

    if (!batch || batch.length === 0) break;

    allRepos = allRepos.concat(batch);

    // GitHub paginates — stop if this page was partial
    if (batch.length < MAX_REPOS_FETCH) break;

    page++;

    // Safety cap — never exceed 300 repos
    if (allRepos.length >= 300) break;
  }

  cacheSet(cacheKey, allRepos);
  return allRepos;
}

/* ─────────────────────────────────────────────────────────────────
   3. FETCH LANGUAGES BREAKDOWN
   Returns { JavaScript: 14500, Python: 8200, ... } per repo
───────────────────────────────────────────────────────────────── */
/**
 * @param {string} fullName e.g. "torvalds/linux"
 * @returns {Promise<Record<string, number>>}
 */
async function fetchRepoLanguages(fullName) {
  const cacheKey = `langs:${fullName}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const data = await ghFetch(`/repos/${fullName}/languages`, {}, README_TIMEOUT);
    const result = data || {};
    cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    // [FIXED] كنا نبلّع كل الأخطاء بصمت هنا — بما فيهم RATE_LIMITED، وده جزء
    // من سبب "العالق على نفس الريبو": الفشل بسبب الحد كان يبان زي "مفيش
    // بيانات" عادي. دلوقتي بنرفع RATE_LIMITED لفوق عشان fetchGitHubData
    // يوقف باقي الـ batches ويبلّغ المستخدم بوضوح؛ أي خطأ تاني (شبكة، إلخ)
    // لسه بيتلطف زي ما كان.
    if (err instanceof GitHubError && err.code === 'RATE_LIMITED') throw err;
    return {}; // Non-critical — degrade gracefully
  }
}

/* ─────────────────────────────────────────────────────────────────
   4. FETCH README (truncated)
   We only need the first ~500 chars for context
───────────────────────────────────────────────────────────────── */
/**
 * [FIXED] راجع شرح السبب الجذري الكامل في header الملف فوق (مشكلة
 * "العالق على نفس الريبو"). هنا تحديدًا: بنستخدم GitHub REST API endpoint
 * الرسمي لـ README (بدل تخمين raw.githubusercontent.com سابقًا) — أدق في
 * اكتشاف اسم/امتداد الملف الصحيح، وبيعدّي عبر ghFetch()/الـ proxy الموحّد.
 *
 * @param {string} fullName e.g. "torvalds/linux"
 * @returns {Promise<string|null>}
 */
async function fetchRepoReadme(fullName) {
  const cacheKey = `readme:${fullName}`;
  // [FIXED] راجع الشرح الكامل عند تعريف cacheHas() فوق
  if (cacheHas(cacheKey)) return cacheGet(cacheKey);

  try {
    const data = await ghFetch(`/repos/${fullName}/readme`, {}, README_TIMEOUT);

    if (!data || typeof data.content !== 'string') {
      cacheSet(cacheKey, null);
      return null;
    }

    // المحتوى base64 وممكن يكون متقسّم بأسطر جديدة — لازم تُشال قبل الـ decode
    const decoded = atob(data.content.replace(/\n/g, ''));
    // تحويل صحيح لأي حروف يونيكود (عربي/رموز) جوه الـ README
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    const text  = new TextDecoder('utf-8').decode(bytes);

    const clean = stripMarkdown(text).slice(0, 600).trim();
    cacheSet(cacheKey, clean || null);
    return clean || null;

  } catch (err) {
    // [FIXED] راجع نفس الشرح في fetchRepoLanguages — لازم نرفع RATE_LIMITED
    // لفوق بدل ما نكاشه كـ "مفيش readme" ونكمّل نضرب الحد بصمت.
    if (err instanceof GitHubError && err.code === 'RATE_LIMITED') throw err;
    cacheSet(cacheKey, null);
    return null;
  }
}

/**
 * Very basic markdown stripper for README preview.
 * Removes headers, links, images, code blocks, badges.
 * @param {string} md
 * @returns {string}
 */
function stripMarkdown(md) {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')          // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text only
    .replace(/```[\s\S]*?```/g, '')           // code blocks
    .replace(/`[^`]*`/g, '')                  // inline code
    .replace(/^#{1,6}\s+/gm, '')             // headers
    .replace(/^\s*[-*+]\s+/gm, '')           // list bullets
    .replace(/^\s*\d+\.\s+/gm, '')           // ordered lists
    .replace(/(\*\*|__)(.*?)\1/g, '$2')      // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')         // italic
    .replace(/^>\s+/gm, '')                  // blockquotes
    .replace(/\|.*?\|/g, '')                 // table rows
    .replace(/^[-=]{3,}/gm, '')             // HR / table separator
    .replace(/<!--[\s\S]*?-->/g, '')         // HTML comments
    .replace(/<[^>]+>/g, '')                 // HTML tags (badges etc.)
    .replace(/https?:\/\/\S+/g, '')          // bare URLs
    .replace(/\n{3,}/g, '\n\n')             // excess blank lines
    .trim();
}

/* ─────────────────────────────────────────────────────────────────
   5. SMART SORTING ALGORITHM
   Priority Score = stars × 2 + has_description(10) +
                    recently_updated(5) + has_topics(3) +
                    has_readme(2) - is_fork(8) - is_archived(15)
───────────────────────────────────────────────────────────────── */
/**
 * @param {ProcessedRepo} repo
 * @returns {number} priority score
 */
function calcPriorityScore(repo) {
  const now = Date.now();
  const pushedAt = new Date(repo.pushed_at).getTime();
  const monthsAgo = (now - pushedAt) / (1000 * 60 * 60 * 24 * 30);

  let score = 0;

  score += repo.stars * 2;                              // Stars are king
  score += repo.description  ? 10 : 0;                 // Has description
  score += monthsAgo <= 3    ? 8  : monthsAgo <= 12 ? 4 : 0; // Recently active
  score += repo.topics.length > 0 ? 3 : 0;             // Has topics/tags
  score += repo.readme       ? 2  : 0;                 // Has README
  score += repo.forks        > 0  ? 1 : 0;             // Others forked it
  score -= repo.fork         ? 8  : 0;                 // Penalize forks
  score -= repo.archived     ? 15 : 0;                 // Penalize archived

  return score;
}

/**
 * [FIXED] نفس أوزان calcPriorityScore بالظبط، بس شغالة على raw repo (زي ما
 * راجعة من GitHub REST مباشرة، قبل ما نجيب languages/readme) — عشان نقدر
 * نختار candidates الـ README-fetching بمعيار قريب جدًا من الترتيب النهائي
 * في processRepos()، بدل الاعتماد على النجوم بس. بونص الـ has_readme (+2)
 * اتشال هنا لأنه مش معروف أصلاً وقت اختيار الـ candidates (ده هو اللي
 * هنكتشفه بعدين)؛ الفرق ده صغير جدًا (+2 بس) ومش هيغيّر الترتيب العام.
 *
 * @param {RawRepo} rawRepo
 * @returns {number}
 */
function calcPreFetchScore(rawRepo) {
  const now = Date.now();
  const pushedAt = new Date(rawRepo.pushed_at).getTime();
  const monthsAgo = (now - pushedAt) / (1000 * 60 * 60 * 24 * 30);

  let score = 0;
  score += (rawRepo.stargazers_count || 0) * 2;
  score += rawRepo.description ? 10 : 0;
  score += monthsAgo <= 3 ? 8 : monthsAgo <= 12 ? 4 : 0;
  score += Array.isArray(rawRepo.topics) && rawRepo.topics.length > 0 ? 3 : 0;
  score += (rawRepo.forks_count || 0) > 0 ? 1 : 0;
  score -= rawRepo.fork     ? 8  : 0;
  score -= rawRepo.archived ? 15 : 0;

  return score;
}

/* ─────────────────────────────────────────────────────────────────
   6. FILTER & PROCESS REPOS
───────────────────────────────────────────────────────────────── */
/**
 * @typedef {Object} ProcessedRepo
 * @property {string}   name
 * @property {string}   full_name
 * @property {string}   html_url
 * @property {string}   description
 * @property {string|null} language        — primary language
 * @property {Record<string,number>} languages  — full breakdown
 * @property {number}   stars
 * @property {number}   forks
 * @property {string[]} topics
 * @property {string}   pushed_at
 * @property {string}   created_at
 * @property {boolean}  fork
 * @property {boolean}  archived
 * @property {string|null} readme
 * @property {number}   priority_score
 */

/**
 * Filter out forks, archived, private — then sort by priority score.
 * @param {RawRepo[]} rawRepos
 * @param {Map<string, string|null>} readmes
 * @param {Map<string, Record<string,number>>} languages
 * @returns {ProcessedRepo[]}
 */
function processRepos(rawRepos, readmes, languages) {
  return rawRepos
    .filter(r => !r.private && !r.disabled)  // Must be accessible
    .map(r => {
      const repo = {
        name:           r.name,
        full_name:      r.full_name,
        html_url:       r.html_url,
        description:    r.description || '',
        language:       r.language    || null,
        languages:      languages.get(r.full_name) || {},
        stars:          r.stargazers_count || 0,
        forks:          r.forks_count      || 0,
        topics:         Array.isArray(r.topics) ? r.topics : [],
        pushed_at:      r.pushed_at,
        created_at:     r.created_at,
        fork:           r.fork     || false,
        archived:       r.archived || false,
        readme:         readmes.get(r.full_name) || null,
        default_branch: r.default_branch || 'main',
      };

      repo.priority_score = calcPriorityScore(repo);
      return repo;
    })
    .sort((a, b) => b.priority_score - a.priority_score);
}

/* ─────────────────────────────────────────────────────────────────
   7. AGGREGATE LANGUAGE STATS
   Across all repos — for skills extraction
───────────────────────────────────────────────────────────────── */
/**
 * @param {ProcessedRepo[]} repos
 * @returns {{ language: string, bytes: number, percentage: number }[]}
 *   Sorted by total bytes descending
 */
function aggregateLanguages(repos) {
  const totals = {};

  repos.forEach(repo => {
    Object.entries(repo.languages).forEach(([lang, bytes]) => {
      totals[lang] = (totals[lang] || 0) + bytes;
    });
  });

  const grandTotal = Object.values(totals).reduce((s, b) => s + b, 0);
  if (!grandTotal) return [];

  return Object.entries(totals)
    .map(([language, bytes]) => ({
      language,
      bytes,
      percentage: Math.round((bytes / grandTotal) * 100),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

/* ─────────────────────────────────────────────────────────────────
   8. PROGRESS CALLBACK HELPER
───────────────────────────────────────────────────────────────── */
/**
 * @callback ProgressCallback
 * @param {number} percent  0-100
 * @param {string} message  Human-readable status
 */

/* ─────────────────────────────────────────────────────────────────
   9. MAIN EXPORT — fetchGitHubData
   Single entry point called by ai.js / portfolio.js
───────────────────────────────────────────────────────────────── */
/**
 * @typedef {Object} GitHubData
 * @property {GitHubUser}    user
 * @property {ProcessedRepo[]} top_repos      — top MAX_REPOS_SHOWN
 * @property {ProcessedRepo[]} all_repos      — all processed repos
 * @property {{ language: string, bytes: number, percentage: number }[]} languages
 * @property {number} total_stars
 * @property {number} total_repos
 * @property {string} fetched_at
 */

/**
 * Orchestrates all GitHub API calls with progress reporting.
 *
 * @param {string}           username
 * @param {ProgressCallback} [onProgress]
 * @returns {Promise<GitHubData>}
 */
async function fetchGitHubData(username, onProgress) {
  const progress = onProgress || (() => {});

  // Normalise username
  username = username.trim().replace(/^@/, '');

  // Validate: GitHub usernames are 1-39 chars, alphanumeric + hyphens only
  if (!username) {
    throw new GitHubError('Please enter a GitHub username.', 'INVALID_USERNAME');
  }
  if (username.length > 39) {
    throw new GitHubError('GitHub username is too long (max 39 characters).', 'INVALID_USERNAME');
  }
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(username)) {
    throw new GitHubError('Invalid GitHub username. Only letters, numbers, and hyphens are allowed.', 'INVALID_USERNAME');
  }

  // ── Step 1/4: User profile ─────────────────────────────
  progress(5, 'Fetching GitHub profile…');
  const user = await fetchUserProfile(username);
  // fetchUserProfile already throws NOT_FOUND if null

  if (user.public_repos === 0) {
    throw GH_ERRORS.EMPTY_PROFILE(username);
  }

  // ── Step 2/4: Repositories ────────────────────────────
  progress(20, `Found ${user.public_repos} repos — fetching details…`);
  const rawRepos = await fetchUserRepos(username);

  if (!rawRepos || rawRepos.length === 0) {
    throw GH_ERRORS.EMPTY_PROFILE(username);
  }

  // ── Step 3/4: Languages + READMEs (parallel, capped) ──
  progress(40, 'Analysing languages and READMEs…');

  // [FIXED] كان 20 — قللناها لـ MAX_CANDIDATES (8) عشان نقلل عدد النداءات لكل تشغيلة.
  //
  // [FIXED] سبب جذري جديد لمشكلة "العالق على نفس الريبو" — مستقل تمامًا عن
  // rate-limit، وبيفضل موجود حتى مع الـ proxy المُصادَق شغال 100%: كنا بنختار
  // الـ candidates (اللي هيتقرالها README) بترتيب stargazers_count بس، لكن
  // القائمة النهائية اللي المستخدم بيشوفها (top_repos) بترتّبها processRepos()
  // بمعيار مختلف تمامًا (calcPriorityScore — بيدي وزن كبير لـ description/
  // حداثة التحديث/topics، مش بس النجوم). فلو عند المستخدم ريبو واحد بس عالي
  // النجوم وباقي الريبوهات قليلة النجوم لكن حديثة/عندها description، الأخيرة
  // دي كانت بتطلع فوق في top_repos من غير README خالص (لأنها مكنتش من الـ
  // candidates)، وكان بيفضل ظاهر بس نفس الريبو عالي النجوم اللي فعلاً معاه
  // README — يعني "عالق على نفس الريبو" بغض النظر عن حالة الـ rate-limit.
  // الحل: نختار الـ candidates بنفس معيار calcPriorityScore (من غير بونص الـ
  // readme، لأنه مش معروف وقت الاختيار) عشان الريبوهات اللي هتفضل فعلاً في
  // top_repos النهائية تكون هي نفسها اللي اتقرا لها README.
  const candidates = [...rawRepos]
    .filter(r => !r.private && !r.disabled)
    .sort((a, b) => calcPreFetchScore(b) - calcPreFetchScore(a))
    .slice(0, MAX_CANDIDATES);

  // Fetch languages + READMEs in parallel batches of 5
  const BATCH_SIZE = 5;
  const readmeMap   = new Map();
  const languageMap = new Map();
  // [FIXED] بدل ما نبلّع rate-limit بصمت ونكمّل نضرب الحد batch بعد batch،
  // نوقف فورًا أول ما نكتشفه — بنوفّر الباقي من الميزانية، وبنعلّم النتيجة
  // كـ "جزئية" عشان readme-analyzer.js يوضّح للمستخدم إنها مش كل الـ repos.
  let rateLimited = false;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    if (rateLimited) break;

    const batch = candidates.slice(i, i + BATCH_SIZE);

    const batchProgress = 40 + Math.round((i / candidates.length) * 25);
    progress(batchProgress, `Reading repo ${i + 1}–${Math.min(i + BATCH_SIZE, candidates.length)} of ${candidates.length}…`);

    try {
      await Promise.all(batch.map(async (repo) => {
        // Languages
        const langs = await fetchRepoLanguages(repo.full_name);
        languageMap.set(repo.full_name, langs);

        // [FIXED] السبب الجذري الحقيقي والأخير لمشكلة "العالق على نفس
        // الريبو" — كان موجود من قبل كل إصلاحات rate-limit/candidates:
        // الشرط ده كان بيتجنّب حتى مجرد محاولة جلب الـ README لأي ريبو
        // ملوش "description" مكتوب على GitHub وعدد نجومه صفر — تحسين كان
        // القصد منه توفير نداءات، لكن نتيجته العملية: أي مشروع شخصي/جانبي
        // (زي أغلب مشاريع أي مطوّر — description فاضي، 0 نجوم، لكن معاه
        // README كامل ومكتوب كويس) كان بيتحط readme=null من غير ما
        // نتأكد أصلاً، حتى لو فعليًا عنده ملف README حقيقي على GitHub.
        // اتأكدنا من الداتا الفعلية: بالظبط الريبوهات اللي بالصدفة معاها
        // 0 نجوم/من غير description كانت هي اللي بترجع hasReadme=false —
        // مش لأنها فعلاً من غير README، لكن لأننا مكناش بنسأل GitHub خالص.
        // بما إن الـ candidates أصلاً محدودة بـ MAX_CANDIDATES (8) قبل
        // النقطة دي، مفيش داعي لطبقة تصفية تانية جوّاها — نجيب الـ README
        // لكل candidate من غير شرط إضافي.
        const readme = await fetchRepoReadme(repo.full_name);
        readmeMap.set(repo.full_name, readme);
      }));
    } catch (err) {
      if (err instanceof GitHubError && err.code === 'RATE_LIMITED') {
        rateLimited = true; // نوقف هنا بس — مش نرمي، عشان نكمل بأي نتايج جزئية موجودة
      } else {
        throw err; // أي خطأ تاني (شبكة، سيرفر...) لسه غير متوقع، نرفعه زي ما هو
      }
    }
  }

  // ── Step 4/4: Process + sort ──────────────────────────
  progress(70, 'Sorting and scoring repos…');

  const processedRepos = processRepos(rawRepos, readmeMap, languageMap);
  const topRepos = processedRepos.slice(0, MAX_REPOS_SHOWN);
  const aggregatedLangs = aggregateLanguages(processedRepos);
  const totalStars = processedRepos.reduce((s, r) => s + r.stars, 0);

  progress(85, 'GitHub data ready — starting AI generation…');

  return {
    user,
    top_repos:     topRepos,
    all_repos:     processedRepos,
    languages:     aggregatedLangs,
    total_stars:   totalStars,
    total_repos:   processedRepos.length,
    fetched_at:    new Date().toISOString(),
    // [FIXED] علم جديد — readme-analyzer.js بيقدر يعرض تنبيه واضح للمستخدم
    // لو النتيجة جزئية بسبب rate-limit، بدل ما تبان كأنها نتيجة كاملة عادية.
    rate_limited:  rateLimited,
  };
}

/* ─────────────────────────────────────────────────────────────────
   10. UTILITY — Check rate limit status (optional, for UI)
───────────────────────────────────────────────────────────────── */
/**
 * @returns {Promise<{ limit: number, remaining: number, reset: Date }|null>}
 */
async function checkRateLimit() {
  try {
    const data = await ghFetch(`/rate_limit`);
    if (!data?.rate) return null;
    return {
      limit:     data.rate.limit,
      remaining: data.rate.remaining,
      reset:     new Date(data.rate.reset * 1000),
    };
  } catch {
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────
   EXPORTS (vanilla module pattern — no bundler required)
───────────────────────────────────────────────────────────────── */
window.GitHub = {
  fetchGitHubData,
  fetchUserProfile,
  fetchUserRepos,
  fetchRepoLanguages,
  fetchRepoReadme,
  checkRateLimit,
  aggregateLanguages,
  GitHubError,
  GH_ERRORS,
  MAX_REPOS_SHOWN,
};