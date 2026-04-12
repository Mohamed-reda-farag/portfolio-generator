# Portfolio Generator

> Turn your GitHub profile into a stunning developer portfolio in under 60 seconds. AI-powered. Zero design skills needed.

🔗 **Live:** [portfolio-generator-taupe.vercel.app](https://portfolio-generator-taupe.vercel.app)

---

## What is this?

Portfolio Generator takes your public GitHub repositories and uses AI to build a professional, fully editable portfolio website — in under a minute.

No templates to wrestle with. No design decisions to make. Just paste your GitHub username and hit generate.

---

## Features

### Free
- AI-generated portfolio from your GitHub repos
- Inline editor — edit bio, skills, and project descriptions live
- 3 themes: Light, Dark, Minimal
- Public portfolio URL you can share
- CV Builder (8-step, ATS-optimised)
- Referral system — earn discounts by inviting friends

### Pro ⚡
- Everything in Free
- 3 exclusive themes: Glass 3D, Cyberpunk, Space
- All future Pro themes
- Monthly and yearly plans available

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JS |
| Auth & Database | Supabase (PostgreSQL + OAuth) |
| AI Generation | Groq API — Llama 4 Scout |
| GitHub Data | GitHub REST API v3 |
| Animations | GSAP |
| PDF Export | html2pdf.js |
| Hosting | Vercel |
| Payment Bot | Telegram Bot (Python) + Railway |

---

## Project Structure

```
portfolio-generator/
├── index.html          # Landing page + generation form
├── edit.html           # Portfolio editor (inline editing)
├── portfolio.html      # Public portfolio view (by slug)
├── dashboard.html      # User dashboard
├── cv-builder.html     # ATS CV Builder
├── auth-bot.html       # Telegram account linking
├── pricing.html        # Pricing page
├── privacy.html        # Privacy Policy
├── terms.html          # Terms of Service
│
├── css/
│   ├── main.css        # Design system + variables
│   ├── dashboard.css   # Dashboard styles
│   ├── edit-ui.css     # Edit toolbar + theme panel
│   └── themes/
│       ├── light.css
│       ├── dark.css
│       ├── minimal.css
│       ├── glass3d.css   # Pro
│       ├── cyberpunk.css # Pro
│       └── space.css     # Pro
│
├── js/
│   ├── app.js          # GSAP animations + toast system
│   ├── auth.js         # GitHub OAuth via Supabase
│   ├── github.js       # GitHub API + smart sorting
│   ├── ai.js           # Edge Function call + progress bar
│   └── portfolio.js    # Inline editing + theme switcher + paywall
│
└── supabase/
    └── functions/
        └── generate/
            └── index.ts  # Edge Function (Groq API)
```

---

## Database Schema

6 tables in Supabase:

```
users          — id, email, github_username, is_pro, pro_plan,
                 pro_expires_at, referral_code, telegram_id
portfolios     — id, user_id, bio, skills[], theme, slug, is_published
projects       — id, portfolio_id, github_repo_name, ai_description,
                 stars, language, topics
ai_generations — id, user_id, status, github_data, tokens_used
used_codes     — code, user_id, code_type, discount, used_at
referrals      — id, referrer_id, referred_id, created_at
```

---

## Payment & Activation System

Payments are handled manually via InstaPay / Vodafone Cash. A Telegram bot manages the flow:

```
User sends payment screenshot to @GPORT_Payment_BOT
              ↓
Admin reviews and approves (one tap)
              ↓
Bot generates HMAC activation code and sends it to user
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

## Running Locally

### Prerequisites
- A Supabase project
- A GitHub OAuth App
- A Groq API key

### Setup

**1. Clone the repo**
```bash
git clone https://github.com/Mohamed-reda-farag/portfolio-generator
cd portfolio-generator
```

**2. Configure Supabase**

Update `SUPABASE_URL` and `SUPABASE_ANON_KEY` in each HTML file, then run the migrations:
```sql
-- Run in Supabase SQL Editor
-- See: GPORT_complete_migrations.sql
```

**3. Configure GitHub OAuth**

Create a GitHub OAuth App with:
```
Homepage URL:            http://localhost:5500
Authorization callback:  https://YOUR_PROJECT.supabase.co/auth/v1/callback
```

**4. Deploy the Supabase Edge Function**
```bash
supabase functions deploy generate
```

**5. Serve locally**

Use any static server (e.g. Live Server in VS Code) on port 5500.

---

## Telegram Bot (Optional)

The payment bot lives in a separate repository:

```
github.com/Mohamed-reda-farag/gport-bot
```

**Setup:**
```bash
pip install python-telegram-bot python-dotenv httpx
cp .env.example .env   # fill in your values
python telegram_bot.py
```

**Required environment variables:**
```
TELEGRAM_BOT_TOKEN
ADMIN_CHAT_ID
GPORT_SECRET          # must match the value in portfolio.js
SUPABASE_URL
SUPABASE_SERVICE_KEY
SITE_URL
PAYMENT_NUMBER
PRICE_MONTHLY
PRICE_YEARLY
```

---

## Deployment

| Service | Purpose |
|---|---|
| Vercel | Static site hosting (auto-deploy on push) |
| Railway | Telegram bot (24/7 Python worker) |
| Supabase | Database, auth, edge functions |

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
