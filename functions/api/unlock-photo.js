let env;
// Summy Garden Studio — unlock one photo (remove watermark) for 1 credit.
// Called when a customer downloads or emails a confirmed combination set.
// Body: { token }. Returns { ok, remaining } or 402 when out of credits.
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

const handler = async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const key = env.SUPABASE_SECRET_KEY;
  if (!key) return Response.json({ error: "SUPABASE_SECRET_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  if (!body.token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${body.token}` } });
  const caller = u.ok ? await u.json() : null;
  if (!caller?.id) return Response.json({ error: "invalid session" }, { status: 401, headers });

  const r = await fetch(`${SB_URL}/rest/v1/rpc/consume_credit`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uid: caller.id }),
  });
  const val = r.ok ? await r.json() : -1;
  if (val === -1 || val === null) return Response.json({ error: "no credits" }, { status: 402, headers });
  return Response.json({ ok: true, remaining: val }, { status: 200, headers });
};

export async function onRequest(context) { env = context.env; return handler(context.request); }
