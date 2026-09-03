// Summy Garden Studio — validate a campaign discount code.
//
// Percentage-off only, deliberately: a percentage scales correctly across all
// five currencies with no per-currency setup, where a fixed "$10 off" needs a
// separate amount for GBP, HKD, EUR and CNY and drifts as rates move.
//
// The discount_codes table has NO member-facing RLS read policy, so codes can
// only ever be checked through here. If the browser could read the table it
// could also list every unreleased campaign code.
//
// Env: SUPABASE_SECRET_KEY.

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

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

function svc(env, path, opts = {}) {
  const key = env.SUPABASE_SECRET_KEY;
  return fetch(`${SB_URL}${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

export const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);

/* Shared by this endpoint and by checkout.js, so the price the customer is shown
   and the price Stripe actually charges are decided by the same code path.
   Returns { ok, percent, code } or { ok:false, reason }. */
export async function checkCode(env, rawCode, userId) {
  const code = normCode(rawCode);
  if (!code) return { ok: false, reason: "empty" };

  const r = await svc(env, `/rest/v1/discount_codes?code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
  if (!r.ok) return { ok: false, reason: "lookup" };
  const rows = await r.json().catch(() => []);
  const d = Array.isArray(rows) && rows[0];
  if (!d) return { ok: false, reason: "unknown" };

  const now = Date.now();
  if (!d.active) return { ok: false, reason: "inactive" };
  if (d.starts_at && now < Date.parse(d.starts_at)) return { ok: false, reason: "not_yet" };
  if (d.expires_at && now > Date.parse(d.expires_at)) return { ok: false, reason: "expired" };
  if (d.max_uses != null && d.used_count >= d.max_uses) return { ok: false, reason: "used_up" };

  if (d.once_per_user && userId) {
    const u = await svc(env, `/rest/v1/discount_redemptions?code=eq.${encodeURIComponent(code)}&user_id=eq.${userId}&select=id&limit=1`);
    const used = u.ok ? await u.json().catch(() => []) : [];
    if (Array.isArray(used) && used.length) return { ok: false, reason: "already_used" };
  }

  return { ok: true, code, percent: d.percent_off, label: d.label || "" };
}

export async function onRequest(context) {
  const { request: req, env } = context;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  if (!env.SUPABASE_SECRET_KEY) return Response.json({ error: "not configured" }, { status: 501, headers });

  let body = {};
  try { body = await req.json(); } catch {}

  // A signed-in caller lets us enforce once-per-user; an anonymous one can still
  // check that a code is real, which is what the pricing table needs before the
  // customer has an account.
  const user = await sbVerify(body.token);
  const res = await checkCode(env, body.code, user && user.id);

  // Always 200: "that code is not valid" is a normal answer to a normal
  // question, not an error the browser should treat as a failed request.
  return Response.json(res, { status: 200, headers });
}
