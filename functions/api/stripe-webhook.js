// Summy Garden Studio — Stripe webhook: credit the account after successful payment.
// Env: STRIPE_WEBHOOK_SECRET, SUPABASE_SECRET_KEY.
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";

// Photo credits paid to the referrer when a referred friend first buys.
// 30 photo credits convert into one free shoot, so this is 3 referrals = 1 shoot.
// Keep in step with the same constant in referral.js.
const PHOTOS_PER_REFERRAL = 10;

async function verify(payload, sigHeader, secret) {
  const parts = Object.fromEntries((sigHeader || "").split(",").map(kv => kv.split("=")));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === v1;
}

export async function onRequest(context) {
  const { request: req, env } = context;
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = env.STRIPE_WEBHOOK_SECRET;
  const sbKey = env.SUPABASE_SECRET_KEY;
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
      // record the purchase first (unique session_id makes retries idempotent)
      const rec = await fetch(`${SB_URL}/rest/v1/purchases?on_conflict=session_id`, {
        method: "POST",
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json",
                   Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ user_id: uid, session_id: s.id, pack: s.metadata?.pack || "",
          credits: add, amount: (s.amount_total ?? 0) / 100, currency: s.currency || "usd" }),
      });
      const inserted = rec.ok ? await rec.json() : [];
      // only credit the account when this event hasn't been processed before
      const firstTime = !rec.ok || (Array.isArray(inserted) && inserted.length > 0);
      if (firstTime) {
        const g = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}&select=credits`, { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } });
        const rows = g.ok ? await g.json() : [];
        const cur = rows[0]?.credits ?? 0;
        await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${uid}`, {
          method: "PATCH",
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ credits: cur + add }),
        });
      }

      /* ---- Referral payout ----
         This is the moment a referral becomes real: the friend has paid, so the
         referrer earns their photo credits. Doing it here rather than at signup
         is what makes the programme un-farmable — a fake account costs an
         attacker nothing, a completed Stripe payment does not.

         sgs_award_referral only pays a referral still marked 'pending' and flips
         it in the same statement, so Stripe's at-least-once delivery cannot pay
         the same referral twice even if this runs concurrently with a retry. It
         is therefore safe to call unconditionally: a second purchase by the same
         friend simply finds nothing pending and does nothing. */
      try {
        await fetch(`${SB_URL}/rest/v1/rpc/sgs_award_referral`, {
          method: "POST",
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_referred: uid, p_photo_credits: PHOTOS_PER_REFERRAL }),
        });
      } catch {}

      /* ---- Discount redemption ----
         Recorded only now, on a successful payment. Counting a redemption when
         the code was merely typed would let an abandoned checkout burn a
         limited-use campaign code. Keyed on session_id, so retries are no-ops. */
      const dcode = s.metadata?.discount_code;
      if (firstTime && dcode) {
        try {
          await fetch(`${SB_URL}/rest/v1/rpc/sgs_redeem_discount`, {
            method: "POST",
            headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              p_code: dcode, p_user: uid, p_session: s.id,
              p_percent: parseInt(s.metadata?.discount_percent || "0", 10) || 0,
            }),
          });
        } catch {}

        /* ---- Partner commission ----
           If that code belongs to a sales partner, record what they earned. The
           base is amount_total — what the customer ACTUALLY paid after their
           discount — so a partner can never raise their own commission by
           discounting harder, and what we owe is always a share of money we
           genuinely received.

           sgs_record_commission decides everything (is this a partner code, at
           what rate, minus self-purchases) and is idempotent on session_id, so a
           replayed Stripe event cannot pay twice. An ordinary campaign code
           simply matches no partner and writes nothing. */
        try {
          await fetch(`${SB_URL}/rest/v1/rpc/sgs_record_commission`, {
            method: "POST",
            headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              p_code: dcode,
              p_session: s.id,
              p_customer: uid,
              p_pack: s.metadata?.pack || "",
              p_amount: (s.amount_total ?? 0) / 100,
              p_currency: s.currency || "usd",
            }),
          });
        } catch {}
      }
    }
  }
  return new Response("ok", { status: 200 });
}
