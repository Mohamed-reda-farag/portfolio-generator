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
- **README Analyzer** — upload any README and generate bio, project descriptions, LinkedIn posts, and more (up to 3 uses)
- Inline editor — edit bio, skills, and project descriptions live
- 3 themes: Light, Dark, Minimal
- Public portfolio URL you can share
- CV Builder — ATS-optimised, Arabic & English, expanded skill categories
- Referral system — earn discounts by inviting friends
- LinkedIn Presence — GitHub Profile Score + Headline (limited)

### Early Access ⚡ *(first 50 users)*
- Full Pro access free for 30 days — no payment required

### Pro ⚡
- Everything in Free
- 8 exclusive themes: Glass 3D, Cyberpunk, Space, Blueprint, Editorial, Liquid, Noir, Terminal
- All future Pro themes
- **README Analyzer** — unlimited uses
- LinkedIn Presence — full report, all posts, AR/EN toggle, benchmark
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
├── readme-analyzer.html     # README Analyzer tool
├── linkedin.html            # LinkedIn Presence generator (DevPresence)
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
        ├── linkedin-generate/
        │   └── index.ts               # LinkedIn Presence Edge Function (Groq API)
        ├── readme-analyze/
        │   └── index.ts               # README Analyzer Edge Function (Groq API)
        ├── improve-text/
        │   └── index.ts               # AI text improvement for Portfolio Builder
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

> `function_type` values: `'portfolio'` | `'linkedin'`
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
- Tracked via the `early_adopter_counter` table
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

- AI-assisted writing on bio and skills steps via `improve-text` Edge Function
- Progress saved in `localStorage` — safe to refresh mid-flow
- Work experience and education stored in `portfolios.custom_sections` (JSONB)

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

Upload any `.md` file and select which outputs to generate:

| Output | Description |
|---|---|
| Professional Bio | 150–200 word developer bio |
| Project Description | Portfolio-ready project summary |
| LinkedIn Posts | 3 posts with hashtags |
| LinkedIn Presence Report | Score, keywords, benchmark, tips |
| Skills & Technologies | Extracted tech stack list |

- **Free users:** up to 3 analyses
- **Pro users:** unlimited
- All content generated in a single Groq API call for coherence and speed
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
```

**6. Deploy all Edge Functions**
```bash
supabase functions deploy generate
supabase functions deploy linkedin-generate
supabase functions deploy readme-analyze
supabase functions deploy improve-text
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
