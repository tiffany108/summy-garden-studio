// Summy Garden Studio — admin CRUD for campaign discount codes.
//
// The admin browser could in principle write to discount_codes directly, since
// the RLS policy allows the owner email. It goes through here instead so that
// validation (percentage range, code shape, duplicate check) lives in one place
// and matches what /api/discount enforces at redemption time — a code that the
// admin page accepted but the checkout rejects is the worst possible outcome
// mid-campaign.
//
// Env: SUPABASE_SECRET_KEY.

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";

function jwtPayload(t) {
  try {
    const b = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const s = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(u));
  } catch (e) { return null; }
}
// Verifies the JWT signature via PostgREST (see the note in checkout.js about
// /auth/v1 hanging from Workers) AND that the caller is the owner account.
async function adminVerify(token) {
  if (!token) return null;
  const p = jwtPayload(token);
  if (!p || !p.sub) return null;
  if (p.exp && Date.now() / 1000 >= p.exp) return null;
  const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.sub)}&select=id`,
    { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  // The signature is already proven above, so the email claim can be trusted.
  if ((p.email || "").toLowerCase() !== ADMIN_EMAIL) return null;
  return { id: p.sub, email: p.email };
}

function svc(env, path, opts = {}) {
  const key = env.SUPABASE_SECRET_KEY;
  return fetch(`${SB_URL}${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);

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
  const admin = await adminVerify(body.token);
  if (!admin) return Response.json({ error: "admin only" }, { status: 403, headers });

  const action = body.action || "list";
  try {
    if (action === "create") return await create(env, body, headers);
    if (action === "toggle") return await toggle(env, body, headers);
    if (action === "delete") return await remove(env, body, headers);
    return await list(env, headers);
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
}

async function list(env, headers) {
  const r = await svc(env, "/rest/v1/discount_codes?select=*&order=created_at.desc&limit=200");
  const codes = r.ok ? await r.json().catch(() => []) : [];

  // Revenue attribution per code: how many redemptions, and what those customers
  // actually paid. Joined here rather than in the browser so the admin page stays
  // a thin view.
  const rr = await svc(env, "/rest/v1/discount_redemptions?select=code,session_id&limit=5000");
  const reds = rr.ok ? await rr.json().catch(() => []) : [];
  const pr = await svc(env, "/rest/v1/purchases?select=session_id,amount,currency&limit=5000");
  const buys = pr.ok ? await pr.json().catch(() => []) : [];
  const bySession = Object.fromEntries((buys || []).map((b) => [b.session_id, b]));

  const stats = {};
  for (const r2 of reds || []) {
    const s = (stats[r2.code] = stats[r2.code] || { uses: 0, revenue: 0 });
    s.uses++;
    const b = bySession[r2.session_id];
    if (b) s.revenue += Number(b.amount) || 0;
  }

  return Response.json({
    codes: (codes || []).map((c) => ({ ...c, stats: stats[c.code] || { uses: 0, revenue: 0 } })),
  }, { status: 200, headers });
}

async function create(env, body, headers) {
  const code = normCode(body.code);
  const percent = parseInt(body.percent, 10);

  if (code.length < 3) return Response.json({ error: "Code needs at least 3 letters or numbers" }, { status: 400, headers });
  if (!(percent >= 1 && percent <= 100)) return Response.json({ error: "Discount must be between 1% and 100%" }, { status: 400, headers });

  const exists = await svc(env, `/rest/v1/discount_codes?code=eq.${encodeURIComponent(code)}&select=code&limit=1`);
  const rows = exists.ok ? await exists.json().catch(() => []) : [];
  if (Array.isArray(rows) && rows.length) return Response.json({ error: `${code} already exists` }, { status: 409, headers });

  const row = {
    code, percent_off: percent,
    label: String(body.label || "").slice(0, 120),
    active: body.active !== false,
    max_uses: body.maxUses ? parseInt(body.maxUses, 10) : null,
    once_per_user: body.oncePerUser !== false,
    // Dates arrive as YYYY-MM-DD from the date inputs. An expiry is taken as the
    // END of that day, so a code dated "31 Dec" works all through the 31st
    // rather than dying at midnight as the campaign starts.
    starts_at: body.startsAt ? new Date(body.startsAt + "T00:00:00Z").toISOString() : null,
    expires_at: body.expiresAt ? new Date(body.expiresAt + "T23:59:59Z").toISOString() : null,
  };

  const ins = await svc(env, "/rest/v1/discount_codes", {
    method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row),
  });
  if (!ins.ok) {
    const t = await ins.text().catch(() => "");
    return Response.json({ error: `could not save: ${t.slice(0, 160)}` }, { status: 502, headers });
  }
  const saved = await ins.json().catch(() => []);
  return Response.json({ ok: true, code: Array.isArray(saved) ? saved[0] : saved }, { status: 200, headers });
}

async function toggle(env, body, headers) {
  const code = normCode(body.code);
  const r = await svc(env, `/rest/v1/discount_codes?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active: !!body.active }),
  });
  if (!r.ok) return Response.json({ error: "could not update" }, { status: 502, headers });
  return Response.json({ ok: true }, { status: 200, headers });
}

async function remove(env, body, headers) {
  const code = normCode(body.code);
  // Deleting cascades to its redemptions, which would erase the campaign's
  // history. Codes that have been used are deactivated instead, so past revenue
  // stays attributable.
  const u = await svc(env, `/rest/v1/discount_redemptions?code=eq.${encodeURIComponent(code)}&select=id&limit=1`);
  const used = u.ok ? await u.json().catch(() => []) : [];
  if (Array.isArray(used) && used.length) {
    await svc(env, `/rest/v1/discount_codes?code=eq.${encodeURIComponent(code)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active: false }),
    });
    return Response.json({ ok: true, deactivated: true }, { status: 200, headers });
  }
  const r = await svc(env, `/rest/v1/discount_codes?code=eq.${encodeURIComponent(code)}`, {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  });
  if (!r.ok) return Response.json({ error: "could not delete" }, { status: 502, headers });
  return Response.json({ ok: true, deleted: true }, { status: 200, headers });
}
