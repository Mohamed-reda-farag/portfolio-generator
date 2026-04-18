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
 * No auth token required — public data only.
 * API base: https://api.github.com
 */

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────── */
const GH_BASE          = 'https://api.github.com';
const MAX_REPOS_FETCH  = 100;   // GitHub API max per page
const MAX_REPOS_SHOWN  = 6;     // Portfolio limit
const MAX_PAGES        = 3;     // [FIX] حد أقصى لعدد الصفحات — يمنع infinite loop
const API_TIMEOUT      = 5_000; // [FIX] اسم أوضح بدل README_TIMEOUT
const CACHE_TTL        = 5 * 60 * 1000; // 5 min in-memory cache

// [FIX] Sentinel value للتفريق بين "مش موجود في الـ cache" و"موجود وقيمته null"
const CACHE_NULL = Symbol('null');

/* ─────────────────────────────────────────────────────────────────
   IN-MEMORY CACHE
   Prevents redundant API calls if user hits generate twice
───────────────────────────────────────────────────────────────── */
const _cache = new Map(); // key → { data, ts }

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined; // [FIX] undefined = مش موجود في الـ cache
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return undefined;
  }
  // [FIX] لو المخزّن هو CACHE_NULL، ارجع null (README فعلاً فاضي)
  return entry.data === CACHE_NULL ? null : entry.data;
}

function cacheSet(key, data) {
  // [FIX] لو القيمة null، نخزّن CACHE_NULL عشان نفرّق بين "مش موجود" و"null حقيقي"
  _cache.set(key, { data: data === null ? CACHE_NULL : data, ts: Date.now() });
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
 * Wraps fetch with GitHub-specific error handling.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<any>} Parsed JSON
 */
async function ghFetch(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    ...options.headers,
  };

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new GitHubError('Request timed out. GitHub might be slow — try again.', 'TIMEOUT');
    }
    throw GH_ERRORS.NETWORK();
  } finally {
    // finally يشتغل في كل الحالات — catch وsuccess — كافي وحده
    clearTimeout(timer);
  }

  // Rate limit check (before reading body)
  if (response.status === 429 || response.status === 403) {
    const resetTs   = response.headers.get('X-RateLimit-Reset');
    const remaining = response.headers.get('X-RateLimit-Remaining');

    if (remaining === '0' || response.status === 429) {
      const resetDate = resetTs
        ? new Date(parseInt(resetTs, 10) * 1000).toLocaleTimeString()
        : 'a few minutes';
      throw GH_ERRORS.RATE_LIMITED(resetDate);
    }

    throw GH_ERRORS.FORBIDDEN();
  }

  if (response.status === 404) return null; // Caller decides what 404 means
  if (response.status >= 500) throw GH_ERRORS.SERVER(response.status);
  if (!response.ok) throw GH_ERRORS.SERVER(response.status);

  // Empty body (204 No Content etc.)
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new GitHubError('Unexpected response from GitHub API.', 'PARSE_ERROR');
  }
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
  if (cached !== undefined) return cached; // [FIX] undefined = مش في الـ cache

  const data = await ghFetch(`${GH_BASE}/users/${username}`);

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
  if (cached !== undefined) return cached; // [FIX] undefined = مش في الـ cache

  let allRepos = [];
  let page = 1;

  // [FIX] حد أقصى على عدد الصفحات — يمنع infinite loop لو GitHub رجّع بيانات غريبة
  while (page <= MAX_PAGES) {
    const url = `${GH_BASE}/users/${username}/repos?type=public&sort=pushed&direction=desc&per_page=${MAX_REPOS_FETCH}&page=${page}`;
    const batch = await ghFetch(url);

    if (!batch || batch.length === 0) break;

    allRepos = allRepos.concat(batch);

    // GitHub paginates — stop if this page was partial
    if (batch.length < MAX_REPOS_FETCH) break;

    // Safety cap — never exceed 300 repos
    if (allRepos.length >= 300) break;

    page++;
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
  if (cached !== undefined) return cached ?? {}; // [FIX] undefined = مش في الـ cache

  try {
    const data = await ghFetch(`${GH_BASE}/repos/${fullName}/languages`, {}, API_TIMEOUT);
    const result = data || {};
    cacheSet(cacheKey, result);
    return result;
  } catch {
    return {}; // Non-critical — degrade gracefully
  }
}

/* ─────────────────────────────────────────────────────────────────
   4. FETCH README (truncated)
   We only need the first ~500 chars for context
───────────────────────────────────────────────────────────────── */
/**
 * @param {string} fullName e.g. "torvalds/linux"
 * @param {string} defaultBranch e.g. "main"
 * @returns {Promise<string|null>}
 */
async function fetchRepoReadme(fullName, defaultBranch = 'main') {
  const cacheKey = `readme:${fullName}`;
  // [FIX] cacheGet بيرجع undefined لو مش موجود، null لو README فعلاً فاضي
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  // Try README.md in common case variations
  const candidates = [
    `https://raw.githubusercontent.com/${fullName}/${defaultBranch}/README.md`,
    `https://raw.githubusercontent.com/${fullName}/${defaultBranch}/readme.md`,
    `https://raw.githubusercontent.com/${fullName}/${defaultBranch}/README`,
  ];

  for (const url of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
      const res = await fetch(url, { signal: controller.signal });

      if (res.ok) {
        const text = await res.text();
        // Strip markdown syntax, keep plain text, truncate
        const clean = stripMarkdown(text).slice(0, 600).trim();
        cacheSet(cacheKey, clean);
        return clean;
      }
    } catch {
      // Try next candidate (AbortError = timeout, others = 404/network)
    } finally {
      // [FIX] finally يضمن clearTimeout في كل الحالات — success وerror وabort
      clearTimeout(timer);
    }
  }

  // [FIX] cacheSet(null) الآن بيخزّن CACHE_NULL — بيمنع re-fetch في كل مرة
  cacheSet(cacheKey, null);
  return null;
}

/**
 * Very basic markdown stripper for README preview.
 * Removes headers, links, images, code blocks, badges.
 * @param {string} md
 * @returns {string}
 */
function stripMarkdown(md) {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')           // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // [FIX] links → text (captured group صح)
    .replace(/```[\s\S]*?```/g, '')            // code blocks
    .replace(/`[^`]*`/g, '')                   // inline code
    .replace(/^#{1,6}\s+/gm, '')              // headers
    .replace(/^\s*[-*+]\s+/gm, '')            // list bullets
    .replace(/^\s*\d+\.\s+/gm, '')            // ordered lists
    .replace(/(\*\*|__)(.*?)\1/g, '$2')       // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')          // italic
    .replace(/^>\s+/gm, '')                   // blockquotes
    .replace(/\|.*?\|/g, '')                  // table rows
    .replace(/^[-=]{3,}/gm, '')              // HR / table separator
    .replace(/<!--[\s\S]*?-->/g, '')          // HTML comments
    .replace(/<[^>]+>/g, '')                  // HTML tags (badges etc.)
    .replace(/https?:\/\/\S+/g, '')           // bare URLs
    .replace(/\n{3,}/g, '\n\n')              // excess blank lines
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
        readme:         readmes.get(r.full_name) ?? null,
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

  // [FIX] نزوّد الـ candidates لـ 30 عشان الـ processRepos تاخد data كافية
  // وبنستخدم نفس الـ candidates في processRepos بدل rawRepos كاملة
  const candidates = [...rawRepos]
    .filter(r => !r.private && !r.disabled)
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 30);

  // Fetch languages + READMEs in parallel batches of 5
  const BATCH_SIZE = 5;
  const readmeMap   = new Map();
  const languageMap = new Map();

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    const batchProgress = 40 + Math.round((i / candidates.length) * 25);
    progress(batchProgress, `Reading repo ${i + 1}–${Math.min(i + BATCH_SIZE, candidates.length)} of ${candidates.length}…`);

    await Promise.all(batch.map(async (repo) => {
      // Languages
      const langs = await fetchRepoLanguages(repo.full_name);
      languageMap.set(repo.full_name, langs);

      // README (only for repos with descriptions — saves time)
      if (repo.description || repo.stargazers_count > 0) {
        const readme = await fetchRepoReadme(repo.full_name, repo.default_branch);
        readmeMap.set(repo.full_name, readme);
      } else {
        readmeMap.set(repo.full_name, null);
      }
    }));
  }

  // ── Step 4/4: Process + sort ──────────────────────────
  progress(70, 'Sorting and scoring repos…');

  // [FIX] بنعالج الـ candidates بس (اللي عندهم languages + readmes)
  // بدل rawRepos كاملة اللي الـ repos رقم 31+ مش عندهم data
  const processedRepos = processRepos(candidates, readmeMap, languageMap);
  const topRepos = processedRepos.slice(0, MAX_REPOS_SHOWN);
  const aggregatedLangs = aggregateLanguages(processedRepos);
  const totalStars = processedRepos.reduce((s, r) => s + r.stars, 0);

  progress(85, 'GitHub data ready — starting AI generation…');

  return {
    user,
    top_repos:   topRepos,
    all_repos:   processedRepos,
    languages:   aggregatedLangs,
    total_stars: totalStars,
    total_repos: processedRepos.length,
    fetched_at:  new Date().toISOString(),
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
    const data = await ghFetch(`${GH_BASE}/rate_limit`);
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