# Portfolio Generator

> Turn your GitHub profile into a stunning developer portfolio in under 60 seconds. AI-powered. Zero design skills needed.

🔗 **Live:** [portfolio-generator-taupe.vercel.app](https://portfolio-generator-taupe.vercel.app)

---

## What is this?

Portfolio Generator takes your public GitHub repositories and uses AI to build a professional, fully editable portfolio website — in under a minute.

No templates to wrestle with. No design decisions to make. Just paste your GitHub username and hit generate.

Don't have a GitHub account? No problem — sign in with Google and build your portfolio manually, step by step.

---

## Features

### Free
- AI-generated portfolio from your GitHub repos
- **Manual Portfolio Builder** — 7-step guided builder (no GitHub required)
- **Google Sign-In** — create an account without a GitHub profile
- **Custom Projects** — add projects not on GitHub with manual descriptions
- **README Analyzer** — upload any README (or auto-generate from your GitHub repos) and get bio, project descriptions, skills, LinkedIn posts, and a full LinkedIn Presence report (up to 3 uses)
- Inline editor — edit bio, skills, and project descriptions live
- 3 themes: Light, Dark, Minimal
- Public portfolio URL you can share
- CV Builder — ATS-optimised, Arabic & English, expanded skill categories
- Referral system — earn discounts by inviting friends

### Early Access ⚡ *(first 50 users)*
- Full Pro access free for 30 days — no payment required

### Pro ⚡
- Everything in Free
- 8 exclusive themes: Glass 3D, Cyberpunk, Space, Blueprint, Editorial, Liquid, Noir, Terminal
- All future Pro themes
- **README Analyzer** — unlimited uses, full LinkedIn Presence report (AR/EN toggle, benchmark, all posts unlocked)
- Automatic theme restore on subscription renewal
- Monthly and yearly plans available

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JS |
| Auth & Database | Supabase (PostgreSQL + OAuth) |
| AI Generation | Groq API — Llama 4 Scout / Llama 3.3 70B |
| GitHub Data | GitHub REST API v3 |
| Animations | GSAP |
| PDF Export | html2pdf.js + jsPDF (Arabic font: Amiri) |
| Hosting | Vercel |
| Cron Scheduling | cron-job.org (free tier alternative to Supabase cron) |

---

## Project Structure

```
portfolio-generator/
├── index.html               # Landing page + generation form
├── edit.html                # Portfolio editor (inline editing)
├── portfolio.html           # Public portfolio view (by slug)
├── dashboard.html           # User dashboard
├── cv-builder.html          # ATS CV Builder (AR/EN, expanded skills)
├── portfolio-builder.html   # Manual step-by-step portfolio builder
├── readme-analyzer.html     # README Analyzer — uploads, GitHub auto-generate, LinkedIn Presence
├── pricing.html             # Pricing page
├── privacy.html             # Privacy Policy
├── terms.html               # Terms of Service
│
├── css/
│   ├── main.css             # Design system + variables
│   ├── dashboard.css        # Dashboard styles
│   ├── edit-ui.css          # Edit toolbar + theme panel
│   └── themes/
│       ├── light.css
│       ├── dark.css
│       ├── minimal.css
│       ├── glass3d.css      # Pro
│       ├── cyberpunk.css    # Pro
│       ├── space.css        # Pro
│       ├── blueprint.css    # Pro
│       ├── editorial.css    # Pro
│       ├── liquid.css       # Pro
│       ├── noir.css         # Pro
│       └── terminal.css     # Pro
│
├── js/
│   ├── app.js               # GSAP animations + toast system
│   ├── auth.js              # GitHub & Google OAuth via Supabase
│   ├── github.js            # GitHub API + smart sorting
│   ├── ai.js                # Edge Function call + progress bar
│   ├── portfolio.js         # Inline editing + theme switcher + paywall
│   ├── portfolio-builder.js # Manual builder logic + AI improve
│   ├── readme-analyzer.js   # README upload, analysis, render results
│   └── themes/              # Per-theme interactive effects
│       ├── blueprint.js
│       ├── cyberpunk.js
│       ├── editorial.js
│       ├── glass3d.js
│       ├── liquid.js
│       ├── noir.js
│       ├── space.js
│       └── terminal.js
│
└── supabase/
    └── functions/
        ├── generate/
        │   └── index.ts               # Portfolio Edge Function (Groq API)
        ├── readme-analyze/
        │   └── index.ts               # README Analyzer Edge Function — incl. LinkedIn Presence (Groq API)
        ├── improve-text/
        │   └── index.ts               # AI text improvement for Portfolio Builder (bio, skills, project_description)
        ├── github-proxy/
        │   └── index.ts               # GitHub API authenticated proxy — raises rate limit from 60/hr (unauthenticated, per-IP) to 5000/hr; allow-listed paths only
        └── check-expired-subscriptions/
            └── index.ts               # Daily cron — downgrades expired Pro users
```

---

## Database Schema

8 tables in Supabase:

```
users               — id, email, github_username (nullable), full_name, job_title,
                      is_pro, pro_plan, pro_expires_at, pro_since,
                      auth_provider ('github'|'google'), avatar_url,
                      is_early_adopter, early_adopter_expires_at,
                      readme_analyses_used,
                      referral_code, telegram_id

portfolios          — id, user_id, bio, skills[], theme, slug, is_published,
                      full_name, github_username, job_title,
                      linkedin_url, gmail_address,
                      last_pro_theme, default_free_theme,
                      photo_url, location,
                      custom_sections (jsonb)

projects            — id, portfolio_id, github_repo_name, repo_url,
                      ai_description, stars, language, topics,
                      sort_order, is_featured,
                      is_custom, external_url, custom_thumbnail_url,
                      image_url, image_urls

ai_generations      — id, user_id, status, github_data, tokens_used,
                      function_type, error_message, created_at, updated_at

readme_analyses     — id, user_id, outputs_requested[], tokens_used, created_at

early_adopter_counter — id, count, max_count

used_codes          — code, user_id, code_type, discount, used_at, user_agent

referrals           — id, referrer_id, referred_id, created_at
```

> `function_type` values: `'portfolio'` | `'readme'` | `'linkedin'` | `'bio'` | `'projects'`
> `auth_provider` values: `'github'` | `'google'`

---

## Payment & Activation System

Payments are handled manually via InstaPay / Vodafone Cash.

```
User sends payment screenshot to @medo_faraj on Telegram
              ↓
Admin reviews and confirms payment
              ↓
Admin generates HMAC activation code using local admin tool
              ↓
Code is sent to the user via Telegram
              ↓
User enters code on the website → Pro activated instantly
```

### Activation Code Structure

Codes use HMAC-SHA256 with a 48-hour rolling window:

```
GPORT  +  [HMAC prefix 4 chars]  +  [random suffix]
─────     ──────────────────────    ────────────────
fixed        rotates every 48h       unique per code

Monthly: 16 chars total
Yearly:  14 chars total
```

### Referral Discounts

| Referrals | Discount |
|---|---|
| 1 – 4 | 20% |
| 5 – 14 | 40% |
| 15+ | 60% |

---

## Early Access Program

The first 50 users to sign up receive **full Pro access free for 30 days**.

- A live counter on the landing page shows remaining spots
- Tracked via the `early_adopter_counter` table, incremented with an optimistic lock to stay accurate under concurrent signups
- Granted with a short delay after the user row is created, with a retry on read, to avoid a race condition where the grant could silently fail right after signup
- At expiry, the account reverts to Free automatically (theme fallback applies)

---

## Theme System

### Free Themes
`light` · `dark` · `minimal`

### Pro Themes
`glass3d` · `cyberpunk` · `space` · `blueprint` · `editorial` · `liquid` · `noir` · `terminal`

### Automatic Fallback
When a Pro subscription expires, the active Pro theme is saved and the portfolio switches to `dark` automatically. On renewal, the original Pro theme is restored without any action from the user.

---

## Manual Portfolio Builder

For users without a GitHub account (or those who prefer full control), the 7-step builder guides them through:

| Step | Content |
|---|---|
| 1 | Personal Info (name, title, bio, photo) |
| 2 | Skills & Technologies |
| 3 | Projects (using the Custom Project modal) |
| 4 | Work Experience |
| 5 | Education |
| 6 | Contact & Links |
| 7 | Theme selection & publish |

- AI-assisted writing via the `improve-text` Edge Function on bio, skills, and project description — each "Improve with AI" button stays disabled until a minimum threshold is met (30 characters for bio, 2+ skills, 20 characters for project description), so the AI only runs on content worth improving
- Progress saved in `localStorage` — safe to refresh mid-flow
- Work experience and education stored in `portfolios.custom_sections` (JSONB)

### Preview Before Publish
Finishing the wizard does **not** publish the portfolio immediately. Instead:

```
Step 7 "Review & Publish →"
        ↓
Portfolio created as a draft (is_published: false)
        ↓
Redirect to edit.html in Draft Review mode
        ↓
User sees the real, fully-styled portfolio (same view as the inline editor)
        ↓
"← Keep Editing"  or  "Publish Now 🚀"
        ↓
Only on confirmation: is_published → true, portfolio goes live
```

This gives manual-builder users the same visual confidence GitHub-flow users get for free — nobody publishes a portfolio they haven't actually seen.

---

## CV Builder

ATS-optimised CV builder with full Arabic and English support.

### Key Features
- **Bilingual:** full Arabic UI and PDF output (RTL layout, Amiri font via jsDelivr)
- **Real text PDF:** searchable and copy-pasteable — html2canvas is never used
- **Expanded skill categories** — 17 categories covering all professions:

| Category Group | Categories |
|---|---|
| Technical | Programming Languages, Frameworks & Libraries, Databases, DevOps & Cloud, Design & UI/UX |
| Business | Project Management, Marketing & SEO, Sales & CRM, Finance & Accounting, HR & Recruitment |
| Creative | Content & Copywriting, Video & Photography, Social Media |
| General | Languages, Soft Skills, Tools & Software |
| Custom | Other (free-text input) |

- **Email locked from session** — email is always read-only, populated from the authenticated session (GitHub or Google), preventing CV creation on behalf of others
- **GitHub field optional** — users without GitHub can build a full CV without errors

---

## README Analyzer

Upload one or more `.md` files (up to 5, added incrementally with "+ Add") — or, if you signed in with GitHub, auto-generate from your repos directly — and select which outputs to generate:

| Output | Scope | Description |
|---|---|---|
| Professional Bio | Combined | One 150–200 word bio synthesizing all uploaded projects/repos together |
| Project Descriptions | Per project | Independent portfolio-ready summary for each project, labeled by name |
| Skills & Technologies | Combined | One de-duplicated tech stack list across all projects |
| LinkedIn Posts | Per project | One post with hashtags for each project, labeled by name |
| LinkedIn Presence Report | Combined | One holistic score, keywords, benchmark, and tips across the whole portfolio |

### GitHub Auto-Generate
- **GitHub users:** an "Auto Generate from GitHub Repos" button pulls READMEs straight from your top repos (up to 3, each analyzed as an independent project) — no manual upload needed
- **Google users (no GitHub linked):** the same button prompts a "Connect GitHub" dialog, with manual upload always available as a fallback
- GitHub API calls go through the `github-proxy` Edge Function (server-side authenticated token) rather than the browser calling `api.github.com` directly — raises the rate limit from 60/hr (unauthenticated, per-IP) to 5,000/hr (shared across all users of the app). If the shared budget is exhausted mid-request, the tool stops early, returns whatever repos it already fetched, and shows a clear "partial results" warning instead of silently returning incomplete data

- This page is the single entry point for everything previously split across a separate LinkedIn Presence page — that page has been removed
- **Free users:** up to 3 analyses (counted per generation click, regardless of how many files/repos are included)
- **Pro users:** unlimited
- All content generated in a single Groq API call for coherence and speed — each project gets a fair, equal share of the content budget sent to the model, so no project is silently truncated in favor of another
- Results appear inline with Copy and Edit buttons per section
- Server-side usage enforcement in the Edge Function (defence in depth)

---

## Auth & User System

- **GitHub OAuth** — existing flow, auto-generates portfolio from repos
- **Google OAuth** — new flow, leads to Manual Portfolio Builder or GitHub link
- `_ensureUserRow()` runs on every `SIGNED_IN` event (upsert) — guarantees every `auth.user` has a corresponding `public.users` row regardless of provider or account age
- **RLS policy** on `public.users`: `USING (auth.uid() = id)`

### New User Flow (Google)

```
Sign in with Google
      ↓
Dashboard — provider choice:
  [ ✍️ Build Manually ] [ 🔗 Connect GitHub ]
      ↓
Build Manually → portfolio-builder.html (7 steps)
Connect GitHub → linkIdentity() → GitHub OAuth → auto-generate
```

### Identity Integrity

To prevent building a portfolio under someone else's identity, these fields are **never** taken as free text at the point of saving to the database — they're always re-derived from the verified session/DB row:

- `gmail_address` — always the authenticated session email (`auth.users.email`), fetched fresh at save time
- `github_username` — always `users.github_username`, which itself is only ever written by a real OAuth flow (`_ensureUserRow()` in `auth.js` or `connectGithub()` in `dashboard.html`), never by a manually-typed URL/handle

---

## Running Locally

### Prerequisites
- A Supabase project
- A GitHub OAuth App
- A Google OAuth App (for Google sign-in)
- A Groq API key

### Setup

**1. Clone the repo**
```bash
git clone https://github.com/Mohamed-reda-farag/portfolio-generator
cd portfolio-generator
```

**2. Run all migrations in order**
```sql
-- In Supabase SQL Editor, run in this order:
-- 1. GPORT_complete_migrations.sql               (base schema)
-- 2. 001_early_adopter_and_theme_fallback.sql
-- 3. migration_custom_projects.sql
-- 4. google_auth_migration.sql
-- 5. readme-analyzer-migration.sql
```

**3. Configure GitHub OAuth**

```
Homepage URL:            http://localhost:5500
Authorization callback:  https://YOUR_PROJECT.supabase.co/auth/v1/callback
```

**4. Configure Google OAuth**

Enable Google provider in Supabase Dashboard → Authentication → Providers, then add your Google OAuth credentials.

**5. Set Edge Function secrets**
```bash
supabase secrets set GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
# Optional: override the improve-text model
supabase secrets set GROQ_MODEL=llama-3.3-70b-versatile
# GitHub API proxy — classic PAT with no scopes needed (public data only);
# raises the GitHub rate limit from 60/hr (unauthenticated) to 5,000/hr
supabase secrets set GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxx
```

**6. Deploy all Edge Functions**
```bash
supabase functions deploy generate
supabase functions deploy readme-analyze
supabase functions deploy improve-text
supabase functions deploy github-proxy
supabase functions deploy check-expired-subscriptions
```

**7. Schedule the expiry check**

Supabase free tier does not support cron. Use [cron-job.org](https://cron-job.org) instead:

```
URL:      https://YOUR_PROJECT.supabase.co/functions/v1/check-expired-subscriptions
Schedule: Every day at 03:00
Headers:  Authorization: Bearer YOUR_SERVICE_ROLE_KEY
```

**8. Apply RLS policy**
```sql
CREATE POLICY "Users can read own row"
ON public.users
FOR SELECT
USING (auth.uid() = id);
```

**9. Serve locally**

Use any static server (e.g. Live Server in VS Code) on port 5500.

---

## Deployment

| Service | Purpose |
|---|---|
| Vercel | Static site hosting (auto-deploy on push) |
| Supabase | Database, auth, edge functions |
| cron-job.org | Daily subscription expiry check |

---

## Roadmap

- [ ] GitHub webhook — auto-update portfolio when new repo is pushed
- [ ] Custom domain support for Pro users
- [ ] Portfolio analytics (page views)
- [ ] Fawry / payment gateway integration
- [ ] Drag & drop project reordering

---

## License

This project is proprietary. All rights reserved.
Not open for redistribution or commercial use without written permission.

---

## Contact

**Portfolio Generator**
📧 [edumatesupport@gmail.com](mailto:edumatesupport@gmail.com)
🔗 [portfolio-generator-taupe.vercel.app](https://portfolio-generator-taupe.vercel.app)
