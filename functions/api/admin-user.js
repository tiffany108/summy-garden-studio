// Summy Garden Studio — admin actions on a customer account.
//
// Actions (POST { token, mfa, action, email }):
//   reset   — email the customer a link to choose their own new password
//   unlock  — clear a 24-hour sign-in lockout
//   status  — is this address currently locked, and how many failures
//
// WHY A LINK AND NOT A GENERATED PASSWORD. Emailing a password puts a working
// credential in an inbox, in plain text, where it stays for years — and the
// customer usually never changes it. A recovery link expires, can only be used
// once, and means neither you nor anyone reading this code ever knows a
// customer's password. That last part protects you: if a customer disputes a
// charge, you can show that nobody at Summy Garden could have signed in as them.
//
// Requires the admin JWT *and* a current MFA session, same as every other admin
// endpoint — this one can trigger emails to customers, so it is not a soft
// target.
//
// Env: SUPABASE_SECRET_KEY.

import { mfaValid } from "./admin-mfa.js";

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";

function fetchT(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

function jwtPayload(t) {
  try {
    const b = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const s = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(u));
  } catch (e) { return null; }
}
async function adminVerify(token) {
  if (!token) return null;
  const p = jwtPayload(token);
  if (!p || !p.sub) return null;
  if (p.exp && Date.now() / 1000 >= p.exp) return null;
  const r = await fetchT(`${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.sub)}&select=id`,
    { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } }, 8000);
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  if ((p.email || "").toLowerCase() !== ADMIN_EMAIL) return null;
  return { id: p.sub, email: p.email };
}

function svc(env, path, opts = {}) {
  const key = env.SUPABASE_SECRET_KEY;
  return fetchT(`${SB_URL}${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  }, 12000);
}

const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 320);

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
  if (!(await mfaValid(env, admin.id, body.mfa))) {
    return Response.json({ error: "mfa required", mfa: true }, { status: 401, headers });
  }

  const email = normEmail(body.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "a valid customer email is required" }, { status: 400, headers });
  }

  try {
    if (body.action === "unlock") {
      await svc(env, "/rest/v1/rpc/sgs_login_clear", { method: "POST", body: JSON.stringify({ p_email: email }) });
      return Response.json({ unlocked: true }, { status: 200, headers });
    }

    if (body.action === "status") {
      const r = await svc(env,
        `/rest/v1/login_attempts?email=eq.${encodeURIComponent(email)}&select=fails,locked_until,last_fail_at&limit=1`);
      const rows = r.ok ? await r.json().catch(() => []) : [];
      const row = Array.isArray(rows) && rows[0];
      const until = row && row.locked_until;
      return Response.json({
        fails: (row && row.fails) || 0,
        locked: !!until && Date.parse(until) > Date.now(),
        until: until || null,
        lastFail: (row && row.last_fail_at) || null,
      }, { status: 200, headers });
    }

    // Default: send a password-reset link.
    const origin = req.headers.get("origin") || "https://summygarden.com";
    /* Supabase's recover endpoint deliberately answers 200 whether or not the
       address exists, so this cannot be used to discover who your customers are.
       It goes through /auth/v1 — which hangs from Workers for the /user and
       /token endpoints on this project — so the timeout above is what turns a
       hang into a readable error instead of a blank Cloudflare 502. */
    const r = await fetchT(`${SB_URL}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: SB_PUB, "Content-Type": "application/json" },
      body: JSON.stringify({ email, gotrue_meta_security: {} }),
    }, 12000).catch((e) => ({ ok: false, status: 0, _err: e }));

    if (!r.ok) {
      const detail = r._err
        ? (r._err.name === "AbortError" ? "Supabase did not respond within 12 seconds" : String(r._err.message || r._err))
        : `HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 180)}`;
      return Response.json({ error: `could not send reset link: ${detail}` }, { status: 502, headers });
    }

    // Sending a reset is also a reasonable moment to lift any lockout: you are
    // helping this person get back in, and the link is about to let them.
    try {
      await svc(env, "/rest/v1/rpc/sgs_login_clear", { method: "POST", body: JSON.stringify({ p_email: email }) });
    } catch {}

    return Response.json({ sent: true, email, origin }, { status: 200, headers });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
}
