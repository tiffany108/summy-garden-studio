# Deploying Summy Garden Studio on Cloudflare Pages

The site is a static front-end (`index.html`, `admin.html`) plus serverless
functions in `functions/api/`. It runs on Cloudflare Pages with zero build step.

## 1. Create the Pages project
Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git** → pick the `summy-garden-studio` repo.

Build settings:
- Framework preset: **None**
- Build command: **(leave empty)**
- Build output directory: **/** (root)

Functions are auto-detected from the `functions/` folder — `/api/generate`,
`/api/sample`, `/api/checkout`, `/api/stripe-webhook`, `/api/admin-stats`,
`/api/send-photo`, `/api/contact-notify`.

## 2. Environment variables  (Settings → Environment variables → Production)
Same secret values used on Netlify:
- `GEMINI_API_KEY`        – Google Gemini image API
- `SUPABASE_SECRET_KEY`   – Supabase service role key
- `STRIPE_SECRET_KEY`     – Stripe secret key
- `STRIPE_WEBHOOK_SECRET` – Stripe webhook signing secret
- `RESEND_API_KEY`        – (optional) email delivery
- `CONTACT_NOTIFY_TO`     – (optional) defaults to gogonewnews@gmail.com
- `EMAIL_FROM`            – (optional) verified sender once a domain is added

## 3. KV namespace for the thumbnail cache
Workers & Pages → **KV** → **Create namespace** → name it `gallery`.
Then Pages project → Settings → **Functions → KV namespace bindings** →
add binding **Variable name: `SCENE_CACHE`** → the `gallery` namespace.
(If unbound, thumbnails still generate — they just re-generate each time
instead of being cached.)

## 4. Custom domain
Pages project → **Custom domains** → add `summygarden.com` (+ `www`).
Register the domain under **Registrar** first if not owned yet.

## 5. Re-point the Stripe webhook
Stripe dashboard → Developers → Webhooks → set endpoint to
`https://summygarden.com/api/stripe-webhook` (keep the same signing secret,
or update `STRIPE_WEBHOOK_SECRET` if Stripe issues a new one).

## 6. Security (all free tier)
- SSL/TLS: automatic.
- **Turnstile**: create a widget, add the token check to the contact &
  sign-up forms (front-end + a check in `contact-notify` / auth).
- **Cloudflare Access**: Zero Trust → Access → Application → protect
  `summygarden.com/admin.html` with a one-time-PIN e-mail policy.
- WAF managed rules + Bot Fight Mode: on by default for the zone.

## Netlify fallback
`netlify.toml` still maps `/api/*` → `/.netlify/functions/*`, and the root
`*.mjs` files remain, so the old Netlify deploy keeps working during the
cut-over. Once Cloudflare is verified, Netlify can be retired.
