// Summy Garden Studio — Stripe webhook: credit the account after successful payment.
// Env: STRIPE_WEBHOOK_SECRET, SUPABASE_SECRET_KEY.
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";

async function verify(payload, sigHeader, secret) {
  const parts = Object.fromEntries((sigHeader || "").split(",").map(kv => kv.split("=")));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === v1;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sbKey = process.env.SUPABASE_SECRET_KEY;
  if (!secret || !sbKey) return new Response("not configured", { status: 501 });

  const payload = await req.text();
  const ok = await verify(payload, req.headers.get("stripe-signature"), secret);
  if (!ok) return new Response("bad signature", { status: 400 });

  let event; try { event = JSON.parse(payload); } catch { return new Response("bad json", { status: 400 }); }
  if (event.type === "checkout.session.completed") {
    const s = event.data.object;
    const uid = s.metadata?.user_id || s.client_reference_id;
    const add = parseInt(s.metadata?.credits || "0", 10);
    if (uid && add > 0 && (s.payment_status === "paid" || s.status === "complete")) {
      // read current credits, then increment (service role bypasses RLS)
      const g = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=credits`, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } });
      const rows = g.ok ? await g.json() : [];
      const cur = rows[0]?.credits ?? 0;
      await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}`, {
        method: "PATCH",
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ credits: cur + add }),
      });
    }
  }
  return new Response("ok", { status: 200 });
};
