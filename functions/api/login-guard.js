// Summy Garden Studio — failed sign-in tracking and 24-hour lockout.
//
// HONEST SCOPE: sign-in runs in the browser against Supabase directly, so this
// is enforced by the sign-in form, not by the auth server. It stops a human
// guessing at a keyboard and records every attempt for you; it does not stop a
// script aimed straight at Supabase. See the migration for why.
//
// Deliberately unauthenticated — it is called BEFORE anyone is signed in. That
// shapes every decision below:
//   * `check` never reveals whether an email has an account (that would be a
//     free user-enumeration oracle). It answers only "is this address locked".
//   * `fail` cannot be used to lock somebody else out at will, because a lock
//     is always clearable by that person completing a password reset.
//
// Actions (POST { action, email }):
//   check  — { locked, until, minutes }
//   fail   — record a failure; returns { locked, left, until }
//   clear  — wipe the record (called after a genuine sign-in, with proof)
//
// Env: SUPABASE_SECRET_KEY.

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

const MAX_FAILS = 6;
const LOCK_HOURS = 24;

function fetchT(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

function svc(env, path, opts = {}) {
  const key = env.SUPABASE_SECRET_KEY;
  return fetchT(`${SB_URL}${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  }, 10000);
}
const jget = async (r) => (r.ok ? await r.json().catch(() => null) : null);

const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 320);
const looksLikeEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/* `clear` is the one action that must not be callable by a stranger — otherwise
   an attacker resets the counter after every fifth guess and the lockout means
   nothing. Proof is a Supabase access token for that same address: you can only
   have one by having signed in successfully, which is precisely when clearing
   is correct. */
function jwtPayload(t) {
  try {
    const b = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const s = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(u));
  } catch (e) { return null; }
}
async function tokenOwns(token, email) {
  if (!token) return false;
  const p = jwtPayload(token);
  if (!p || !p.sub) return false;
  if (p.exp && Date.now() / 1000 >= p.exp) return false;
  if (normEmail(p.email) !== email) return false;
  // Signature check: PostgREST validates the JWT itself, so a forged token fails.
  const r = await fetchT(`${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.sub)}&select=id`,
    { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } }, 8000);
  if (!r.ok) return false;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
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
  // Never let a missing key turn into a lockout for everybody: if this endpoint
  // cannot work, sign-in should carry on unguarded rather than stop.
  if (!env.SUPABASE_SECRET_KEY) return Response.json({ locked: false, off: true }, { status: 200, headers });

  let body = {};
  try { body = await req.json(); } catch {}
  const email = normEmail(body.email);
  if (!looksLikeEmail(email)) return Response.json({ locked: false }, { status: 200, headers });

  const ip = req.headers.get("cf-connecting-ip") || "";

  try {
    if (body.action === "fail") {
      const r = await svc(env, "/rest/v1/rpc/sgs_login_fail", {
        method: "POST",
        body: JSON.stringify({ p_email: email, p_ip: ip, p_max: MAX_FAILS, p_hours: LOCK_HOURS }),
      });
      const rows = await r.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : null;
      const fails = (row && (row.out_fails ?? row.fails)) || 0;
      const until = (row && (row.out_locked_until ?? row.locked_until)) || null;
      const locked = !!until && Date.parse(until) > Date.now();
      return Response.json({
        locked, until,
        left: Math.max(0, MAX_FAILS - fails),
        max: MAX_FAILS, hours: LOCK_HOURS,
      }, { status: 200, headers });
    }

    if (body.action === "clear") {
      if (!(await tokenOwns(body.token, email))) {
        return Response.json({ error: "not allowed" }, { status: 403, headers });
      }
      await svc(env, "/rest/v1/rpc/sgs_login_clear", { method: "POST", body: JSON.stringify({ p_email: email }) });
      return Response.json({ cleared: true }, { status: 200, headers });
    }

    // Default: check.
    const rows = await jget(await svc(env,
      `/rest/v1/login_attempts?email=eq.${encodeURIComponent(email)}&select=fails,locked_until&limit=1`));
    const row = Array.isArray(rows) && rows[0];
    const until = row && row.locked_until;
    const locked = !!until && Date.parse(until) > Date.now();
    return Response.json({
      locked,
      until: locked ? until : null,
      minutes: locked ? Math.ceil((Date.parse(until) - Date.now()) / 60000) : 0,
      // Only ever reported for a locked account, so this cannot be used to probe
      // whether an unknown address is registered.
      left: locked ? 0 : undefined,
      max: MAX_FAILS, hours: LOCK_HOURS,
    }, { status: 200, headers });
  } catch (e) {
    // Fail open. A wobble in this endpoint must never be the reason a paying
    // customer cannot reach the photos they bought.
    return Response.json({ locked: false, error: String(e?.message || e).slice(0, 120) }, { status: 200, headers });
  }
}
