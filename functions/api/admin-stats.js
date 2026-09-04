// Summy Garden Studio — business stats for the admin dashboard.
// Verifies the caller is the admin account, then gathers data with the
// service key (bypasses RLS): all auth users (email + confirmation status),
// profiles, generation timestamps and purchases.
// Env: SUPABASE_SECRET_KEY.
import { mfaValid } from "./admin-mfa.js";

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";


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

export async function onRequest(context) {
  const { request: req, env } = context;
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return Response.json({ error: "SUPABASE_SECRET_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  if (!body.token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const caller = await sbVerify(body.token);
  if (!caller?.email || caller.email !== ADMIN_EMAIL) return Response.json({ error: "admin only" }, { status: 403, headers });
  /* Second factor. Checked HERE and not only in the browser: hiding the
     dashboard behind a code screen would leave this endpoint answering a direct
     request made with nothing but the password session, which is exactly the
     attack MFA is supposed to stop. */
  if (!(await mfaValid(env, caller.id, body.mfa))) {
    return Response.json({ error: "mfa required", mfa: true }, { status: 401, headers });
  }

  const svc = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (url) => { const r = await fetch(url, { headers: svc }); return r.ok ? await r.json() : null; };

  // paginate the auth admin users list (50 per page by default)
  const users = [];
  for (let page = 1; page <= 20; page++) {
    const d = await get(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`);
    const list = d?.users || (Array.isArray(d) ? d : []);
    if (!list.length) break;
    list.forEach(x => users.push({ id: x.id, email: x.email, confirmed: !!(x.email_confirmed_at || x.confirmed_at),
      created_at: x.created_at, last_sign_in_at: x.last_sign_in_at }));
    if (list.length < 200) break;
  }

  const profiles = await get(`${SB_URL}/rest/v1/profiles?select=id,name,credits,ref_count,created_at&limit=5000`) || [];
  const generations = await get(`${SB_URL}/rest/v1/generations?select=user_id,created_at&order=created_at.desc&limit=20000`) || [];
  const purchases = await get(`${SB_URL}/rest/v1/purchases?select=user_id,session_id,pack,credits,amount,currency,created_at&order=created_at.desc&limit=10000`) || [];

  return Response.json({ users, profiles, generations, purchases, generated_at: new Date().toISOString() }, { status: 200, headers });
}
