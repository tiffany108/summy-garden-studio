// Summy Garden Studio — business stats for the admin dashboard.
// Verifies the caller is the admin account, then gathers data with the
// service key (bypasses RLS): all auth users (email + confirmation status),
// profiles, generation timestamps and purchases.
// Env: SUPABASE_SECRET_KEY.
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";

export default async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return Response.json({ error: "SUPABASE_SECRET_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  if (!body.token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${body.token}` } });
  const caller = u.ok ? await u.json() : null;
  if (!caller?.email || caller.email !== ADMIN_EMAIL) return Response.json({ error: "admin only" }, { status: 403, headers });

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
};
