// Summy Garden Studio — create a Stripe Checkout Session.
// Env: STRIPE_SECRET_KEY. Verifies the Supabase session so credits land on the right account.
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

const PACKS = {
  Starter:  { credits: 5,  usd: 999,  gbp: 799,  hkd: 7800,  eur: 899,  cny: 6900 },
  Pro:      { credits: 15, usd: 1999, gbp: 1599, hkd: 15600, eur: 1799, cny: 13800 },
  "Career+":{ credits: 40, usd: 3499, gbp: 2799, hkd: 27300, eur: 3199, cny: 24800 },
};

async function sbUser(token) {
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } });
  return r.ok ? await r.json() : null;
}

export default async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const sk = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!sk) return Response.json({ error: "STRIPE_SECRET_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const { pack, currency, token } = body;
  const P = PACKS[pack];
  const cur = (currency || "USD").toLowerCase();
  if (!P || !P[cur]) return Response.json({ error: "invalid pack/currency" }, { status: 400, headers });
  const user = await sbUser(token);
  if (!user?.id) return Response.json({ error: "sign in required" }, { status: 401, headers });

  const origin = req.headers.get("origin") || "https://summy-garden-studio.netlify.app";
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
  // Omit payment_method_types so Checkout offers whatever is enabled in the Stripe
  // dashboard (card always; Alipay/WeChat Pay etc. appear automatically once activated).

  let res, data;
  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${sk}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    data = await res.json();
  } catch (e) {
    return Response.json({ error: "stripe request failed: " + (e?.message || String(e)) }, { status: 502, headers });
  }
  if (!res.ok) return Response.json({ error: data.error?.message || "stripe error" }, { status: 502, headers });
  return Response.json({ url: data.url }, { status: 200, headers });
};
