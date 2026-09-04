// Summy Garden Studio — referral programme.
//
// Units: 1 credit = 1 shoot = 30 finished photos. A referral pays the referrer
// 10 PHOTO credits; 30 photo credits convert into 1 shoot credit. The two are
// separate columns so they can never be mixed up by a stray update.
//
// Payout timing: a referral becomes "earned" when the referred friend makes
// their FIRST PURCHASE (handled in stripe-webhook.js), not at signup. That is
// what stops the programme being farmed with disposable email addresses — a
// fake signup costs an attacker nothing, a real purchase does not.
//
// Actions (POST { token, action }):
//   status   (default) — the caller's code, link, totals and recent referrals
//   attach   { code }  — link a brand-new account to the member who referred it
//   convert            — turn 30 photo credits into 1 shoot credit
//
// Env: SUPABASE_SECRET_KEY (already set for /api/generate).

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

const PHOTOS_PER_REFERRAL = 10;   // photo credits per successful referral
const PHOTOS_PER_SHOOT = 30;      // photo credits needed for one free shoot
const FRIEND_CODE = "FRIEND20";   // discount the referred friend is offered

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
  return { id: p.sub, email: p.email || "" };
}

function svc(env, path, opts = {}) {
  const key = env.SUPABASE_SECRET_KEY;
  return fetch(`${SB_URL}${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}
const jget = async (r) => (r.ok ? await r.json().catch(() => null) : null);

// Codes are typed by hand off phone screens, so normalise generously: strip
// spaces and dashes, uppercase, and keep only the alphabet the generator uses.
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

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
  const user = await sbVerify(body.token);
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers });

  const action = body.action || "status";
  try {
    if (action === "attach") return await attach(env, user, body, headers);
    if (action === "convert") return await convert(env, user, headers);
    return await status(env, user, headers);
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
}

async function status(env, user, headers) {
  /* Degrade rather than disappear. `ref_code` has existed on this project for a
     long time, but `photo_credits` / `referred_by` and the `referrals` table only
     arrive with the 2026-09-03 migration. PostgREST rejects the WHOLE select if
     any one column is missing, so asking for everything at once meant the member
     lost their referral code too — the one part that already worked. Ask for the
     new columns, and on failure fall back to the columns that have always been
     there. Sharing then works immediately; the earnings ledger lights up once the
     migration has run. */
  let prof = null, ledgerReady = true;
  const full = await jget(await svc(env,
    `/rest/v1/profiles?id=eq.${user.id}&select=ref_code,ref_count,photo_credits,credits,referred_by`));
  if (full && full[0]) {
    prof = full[0];
  } else {
    ledgerReady = false;
    const basic = await jget(await svc(env, `/rest/v1/profiles?id=eq.${user.id}&select=ref_code,ref_count,credits`));
    prof = (basic && basic[0]) || {};
  }

  // Same story for the referrals table: absent until the migration runs.
  let refs = [];
  if (ledgerReady) {
    refs = await jget(await svc(env,
      `/rest/v1/referrals?referrer_id=eq.${user.id}&select=status,photo_credits,created_at,earned_at&order=created_at.desc&limit=100`)) || [];
  }

  const earned = refs.filter((r) => r.status === "earned").length;
  const pending = refs.filter((r) => r.status === "pending").length;
  const photo = prof.photo_credits || 0;

  return Response.json({
    code: prof.ref_code || "",
    photoCredits: photo,
    shootCredits: prof.credits || 0,
    earnedReferrals: earned,
    pendingReferrals: pending,
    perReferral: PHOTOS_PER_REFERRAL,
    perShoot: PHOTOS_PER_SHOOT,
    // How many more photo credits until the next free shoot. Computed here, not
    // in the browser, so the progress bar and the Convert button can never
    // disagree. Zero means a shoot is ready to claim.
    toNextShoot: photo >= PHOTOS_PER_SHOOT ? 0 : PHOTOS_PER_SHOOT - photo,
    canConvert: photo >= PHOTOS_PER_SHOOT,
    friendCode: FRIEND_CODE,
    wasReferred: !!prof.referred_by,
    // false = the migration has not run, so sharing works but nothing can be
    // earned yet. The dashboard uses this to hide the earnings figures rather
    // than show zeroes that would never move.
    ledgerReady,
  }, { status: 200, headers });
}

async function attach(env, user, body, headers) {
  const code = normCode(body.code);
  if (!code) return Response.json({ error: "no code" }, { status: 400, headers });

  // Refuse if this account is already attributed, so a code cannot be swapped in
  // later for a second payout.
  const me = await jget(await svc(env, `/rest/v1/profiles?id=eq.${user.id}&select=referred_by,ref_code,created_at`));
  const mine = (me && me[0]) || {};
  if (mine.referred_by) return Response.json({ attached: false, reason: "already" }, { status: 200, headers });
  if (mine.ref_code === code) return Response.json({ attached: false, reason: "self" }, { status: 200, headers });

  // Only a member who has never paid can be attributed. Otherwise an established
  // customer could apply a friend's code just before their second purchase and
  // manufacture a payout.
  const paid = await jget(await svc(env, `/rest/v1/purchases?user_id=eq.${user.id}&select=id&limit=1`));
  if (Array.isArray(paid) && paid.length) return Response.json({ attached: false, reason: "existing" }, { status: 200, headers });

  const owner = await jget(await svc(env, `/rest/v1/profiles?ref_code=eq.${encodeURIComponent(code)}&select=id&limit=1`));
  const referrer = owner && owner[0] && owner[0].id;
  if (!referrer) return Response.json({ attached: false, reason: "unknown" }, { status: 200, headers });
  if (referrer === user.id) return Response.json({ attached: false, reason: "self" }, { status: 200, headers });

  const ins = await svc(env, "/rest/v1/referrals?on_conflict=referred_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ referrer_id: referrer, referred_id: user.id, code, status: "pending", photo_credits: 0 }),
  });
  if (!ins.ok) {
    const t = await ins.text().catch(() => "");
    return Response.json({ error: `attach failed: ${t.slice(0, 160)}` }, { status: 502, headers });
  }

  await svc(env, `/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ referred_by: referrer }),
  });

  return Response.json({ attached: true, friendCode: FRIEND_CODE }, { status: 200, headers });
}

async function convert(env, user, headers) {
  // The check and the deduction happen inside one SQL statement, so two browser
  // tabs pressing the button together cannot both succeed on one balance.
  const r = await svc(env, "/rest/v1/rpc/sgs_convert_photo_credits", {
    method: "POST",
    body: JSON.stringify({ p_user: user.id, p_need: PHOTOS_PER_SHOOT }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return Response.json({ error: `convert failed: ${t.slice(0, 160)}` }, { status: 502, headers });
  }
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) {
    return Response.json({ converted: false, reason: "not_enough" }, { status: 200, headers });
  }
  // out_* names, not photo_credits/credits — see the note on the SQL function
  // about OUT parameters colliding with column names.
  return Response.json({
    converted: true,
    photoCredits: rows[0].out_photo_credits,
    shootCredits: rows[0].out_credits,
  }, { status: 200, headers });
}
