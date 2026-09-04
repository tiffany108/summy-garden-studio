// Summy Garden Studio — create a Stripe Checkout Session.
// Env: STRIPE_SECRET_KEY, SUPABASE_SECRET_KEY (the latter only for discount codes).
// Verifies the Supabase session so credits land on the right account.
import { checkCode } from "./discount.js";

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

const PACKS = {
  // 1 credit = 1 shoot = 30 finished photos (~US$1.20 of generation cost).
  // Keys stay Starter/Pro/Career+ for continuity; they are shown as
  // Essential / Professional / Studio in the UI.
  Starter:  { credits: 1, usd: 2400, gbp: 1900, hkd: 18800, eur: 2200, cny: 17800 },
  Pro:      { credits: 3, usd: 3900, gbp: 3100, hkd: 30800, eur: 3600, cny: 28800 },
  "Career+":{ credits: 6, usd: 5900, gbp: 4700, hkd: 46800, eur: 5400, cny: 42800 },
};

// Never let an upstream call hang the Worker — an unbounded fetch is what turns a
// slow dependency into a Cloudflare 502 with no usable error for the customer.
function fetchT(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

/* ---- Token verification without /auth/v1 ----
   Supabase's /auth/v1/* endpoints do not respond from Cloudflare Workers on this
   project (they hang; /rest/v1 answers in ~20ms). We therefore verify the caller
   through PostgREST, which validates the JWT signature itself — a forged or
   expired token is rejected — and RLS guarantees a user can only read their own
   profile row. Same security guarantee, an endpoint that actually responds. */
function jwtPayload(t) {
  try {
    const b = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const s = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(u));
  } catch (e) { return null; }
}
async function sbVerify(token) {
  if (!token) return null;
  const p = jwtPayload(token);
  if (!p || !p.sub) return null;
  if (p.exp && Date.now() / 1000 >= p.exp) return null;
  const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.sub)}&select=id`,
    { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  return { id: p.sub, email: p.email || "" };
}
const sbUser = (token) => sbVerify(token);

export async function onRequest(context) {
  const { request: req, env } = context;
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const sk = env.STRIPE_SECRET_KEY;
  if (!sk) return Response.json({ error: "STRIPE_SECRET_KEY not configured" }, { status: 501, headers });

  let stage = "start";
  try {
  let body = {}; try { body = await req.json(); } catch {}
  const { pack, currency, token } = body;
  const P = PACKS[pack];
  const cur = (currency || "USD").toLowerCase();
  if (!P || !P[cur]) return Response.json({ error: "invalid pack/currency" }, { status: 400, headers });
  stage = "auth";
  const user = await sbUser(token);
  if (!user?.id) return Response.json({ error: "sign in required" }, { status: 401, headers });

  /* The discount is re-validated here rather than trusted from the browser. The
     price the customer was shown is only a preview; this is the number Stripe
     actually charges, so it has to come from the database on every session. */
  stage = "discount";
  let disc = null;
  if (body.discount) {
    const chk = await checkCode(env, body.discount, user.id);
    if (!chk.ok) return Response.json({ error: "invalid discount code", reason: chk.reason }, { status: 400, headers });
    disc = chk;
  }

  const origin = req.headers.get("origin") || "https://summygarden.com";
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("client_reference_id", user.id);
  form.set("customer_email", user.email || "");
  form.set("metadata[user_id]", user.id);
  form.set("metadata[credits]", String(P.credits));
  form.set("metadata[pack]", pack);
  form.set("success_url", `${origin}/?paid=1#pricing`);
  form.set("cancel_url", `${origin}/#pricing`);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", cur);
  form.set("line_items[0][price_data][unit_amount]", String(P[cur]));
  form.set("line_items[0][price_data][product_data][name]", `Summy Garden Studio — ${pack} pack (${P.credits} credits)`);

  /* Apply the discount as a Stripe coupon rather than by quietly lowering
     unit_amount. Stripe then shows the customer the full price with the discount
     itemised beneath it — which is both more persuasive and what the receipt and
     your Stripe reporting need in order to attribute revenue to a campaign. The
     coupon is created per session and marked once-redeemable so it cannot leak
     and be reused outside the campaign. */
  if (disc) {
    stage = "coupon";
    const cf = new URLSearchParams();
    cf.set("percent_off", String(disc.percent));
    cf.set("duration", "once");
    cf.set("name", `${disc.code} — ${disc.percent}% off`);
    cf.set("max_redemptions", "1");
    /* Self-destruct after 24 hours. A coupon object is created for every checkout
       attempt, and most checkouts are abandoned — without an expiry the Stripe
       account slowly fills with thousands of dead single-use coupons that can
       never be cleaned up in bulk. A day is far longer than anyone spends on a
       payment page, and it caps the window in which an abandoned session's
       coupon id could be reused. */
    cf.set("redeem_by", String(Math.floor(Date.now() / 1000) + 86400));
    cf.set("metadata[code]", disc.code);
    const cr = await fetchT("https://api.stripe.com/v1/coupons", {
      method: "POST",
      headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: cf.toString(),
    }, 15000);
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok || !cd.id) {
      return Response.json({ error: cd?.error?.message || "could not apply that code", stage }, { status: 502, headers });
    }
    form.set("discounts[0][coupon]", cd.id);
    // Carried through to the webhook so the redemption is recorded against the
    // code only when the payment actually succeeds.
    form.set("metadata[discount_code]", disc.code);
    form.set("metadata[discount_percent]", String(disc.percent));
  }
  // payment_method_types is deliberately NOT set. Omitting it makes Stripe Checkout
  // offer exactly the methods enabled in the dashboard, so nothing breaks when one
  // is switched on or off. (Hardcoding ["card","alipay"] failed every session with
  // a 400 because Alipay was never activated; automatic_payment_methods is a
  // PaymentIntents parameter and is rejected here.)

  stage = "stripe";
  const res = await fetchT("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  }, 15000);
  stage = "stripe-parse";
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return Response.json({ error: data?.error?.message || `stripe ${res.status}`, code: data?.error?.code || null, stage },
      { status: 502, headers });
  }
  if (!data.url) return Response.json({ error: "stripe returned no checkout url", stage }, { status: 502, headers });
  return Response.json({ url: data.url }, { status: 200, headers });

  } catch (e) {
    // Always answer with JSON so the browser can show the customer something useful.
    const msg = e?.name === "AbortError" ? `timed out during ${stage}` : String(e?.message || e);
    return Response.json({ error: msg, stage }, { status: 502, headers });
  }
}
