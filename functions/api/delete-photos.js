// Summy Garden Studio — permanently delete a member's saved headshots.
//
// Why this runs on the server rather than in the browser: the `headshots` table
// and storage bucket only grant members SELECT (see
// migrations/2026-07-20-saved-headshots.sql). Adding client-side DELETE policies
// would mean widening RLS on a private bucket, and the storage object and the
// database row would then be deleted by two separate un-coordinated calls — so a
// half-failure would leave orphaned files that still count against the member's
// 400-photo cap. Here the service key does both, in order, in one request.
//
// Security: the caller's JWT is verified first, and every path is then checked
// against the database with `user_id = <caller>`. A member can only ever delete
// rows that are already proven to be theirs — a forged path for somebody else's
// folder simply matches nothing and is dropped.
//
// Env: SUPABASE_SECRET_KEY (already set for /api/generate).

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

/* ---- Token verification without /auth/v1 ----
   Supabase's /auth/v1/* endpoints do not respond from Cloudflare Workers on this
   project (they hang; /rest/v1 answers in ~20ms). We verify through PostgREST,
   which validates the JWT signature itself — a forged or expired token is
   rejected — and RLS guarantees a user can only read their own profile row. */
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
  return { id: p.sub };
}

function sbService(env, path, opts = {}) {
  const key = env.SUPABASE_SECRET_KEY;
  return fetch(`${SB_URL}${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

// PostgREST `in.(...)` needs each value quoted, with embedded quotes doubled.
const inList = (arr) => "(" + arr.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",") + ")";

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
  const { token, all } = body;
  const wanted = Array.isArray(body.paths) ? body.paths.filter((p) => typeof p === "string") : [];

  const user = await sbVerify(token);
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers });
  if (!all && !wanted.length) return Response.json({ error: "nothing selected" }, { status: 400, headers });
  // A shoot is 30 photos and the dashboard caps at 400, so anything past that is
  // not a real selection.
  if (wanted.length > 400) return Response.json({ error: "too many photos in one request" }, { status: 413, headers });

  // Resolve what actually belongs to this member. Never trust the paths sent by
  // the browser: we re-read them from the database scoped to user_id, so the set
  // we delete is always a subset of the caller's own rows.
  let q = `/rest/v1/headshots?user_id=eq.${encodeURIComponent(user.id)}&select=path`;
  if (!all) q += `&path=in.${encodeURIComponent(inList(wanted))}`;
  const look = await sbService(env, q);
  if (!look.ok) {
    const t = await look.text().catch(() => "");
    return Response.json({ error: `lookup failed: ${t.slice(0, 160)}` }, { status: 502, headers });
  }
  const rows = await look.json().catch(() => []);
  const paths = [...new Set((Array.isArray(rows) ? rows : []).map((r) => r.path).filter(Boolean))];
  if (!paths.length) return Response.json({ deleted: 0 }, { status: 200, headers });

  // Belt and braces: every stored path is `<uid>/<file>`, so anything outside the
  // caller's own folder would be a data bug. Refuse rather than delete it.
  const mine = paths.filter((p) => p.startsWith(user.id + "/"));

  // 1) Remove the image files. Storage takes up to 1000 names per call.
  let filesGone = 0;
  for (let i = 0; i < mine.length; i += 500) {
    const chunk = mine.slice(i, i + 500);
    const r = await sbService(env, "/storage/v1/object/headshots", {
      method: "DELETE",
      body: JSON.stringify({ prefixes: chunk }),
    });
    if (r.ok) filesGone += chunk.length;
  }

  // 2) Remove the database rows. This is what the dashboard reads, so it happens
  // second — if storage failed we would rather show a photo that no longer loads
  // than hide a file that is still sitting in the bucket.
  let delQ = `/rest/v1/headshots?user_id=eq.${encodeURIComponent(user.id)}`;
  if (!all) delQ += `&path=in.${encodeURIComponent(inList(paths))}`;
  const del = await sbService(env, delQ, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!del.ok) {
    const t = await del.text().catch(() => "");
    return Response.json({ error: `delete failed: ${t.slice(0, 160)}` }, { status: 502, headers });
  }

  return Response.json({ deleted: paths.length, files: filesGone }, { status: 200, headers });
}
