// Summy Garden Studio — two-factor authentication for the admin page.
//
// Flow: password (Supabase) → 6-digit code emailed here → 12-hour admin session.
// The session token returned by `verify` is what /api/admin-stats and
// /api/admin-codes demand on every call, so the second factor is enforced by the
// server rather than by hiding the dashboard in the browser.
//
// Actions (POST { token, action }):
//   send    — email a fresh 6-digit code to the admin address
//   verify  — { code } → { mfa, expires } on success
//   check   — { mfa } → { valid } (used on page load to skip a needless re-auth)
//
// Env: SUPABASE_SECRET_KEY, RESEND_API_KEY. Optional: EMAIL_FROM,
//      ADMIN_MFA_OFF=1 (emergency disable — see Admin_MFA_Setup.md).

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";

const CODE_TTL_MIN = 10;      // how long a emailed code stays valid
const SESSION_TTL_H = 12;     // how long you stay signed in after entering it
const MAX_ATTEMPTS = 5;       // wrong guesses before the code is burned
const RESEND_COOLDOWN_S = 60; // minimum gap between "email me a code" requests

function jwtPayload(t) {
  try {
    const b = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const s = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(u));
  } catch (e) { return null; }
}

/* Verifies the JWT signature through PostgREST (see checkout.js on why /auth/v1
   cannot be used from Workers) AND that the caller is the owner account. */
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
  if ((p.email || "").toLowerCase() !== ADMIN_EMAIL) return null;
  return { id: p.sub, email: p.email };
}

/* Never let an upstream call hang the Worker. An unbounded fetch is what turns a
   slow dependency into a Cloudflare 502 with an HTML body — which swallows every
   error message this file tries to return and makes the failure undiagnosable.
   checkout.js learned this the hard way; this file should have started with it. */
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

/* The pepper means a stolen copy of admin_mfa is not enough to derive a code:
   an attacker would also need the Cloudflare secret. Falls back to the Supabase
   key so the system still works before a dedicated secret is set. */
async function hashCode(env, code, userId) {
  const pepper = env.ADMIN_MFA_PEPPER || env.SUPABASE_SECRET_KEY || "";
  const data = new TextEncoder().encode(`${userId}:${code}:${pepper}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// crypto.getRandomValues, not Math.random: a predictable code is not a factor.
function sixDigits() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}
function sessionToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Constant-time compare. String === on a hash leaks, through timing, how many
   leading characters matched — enough to reconstruct it given enough tries. */
function sameHash(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Shared with the other admin endpoints: is this MFA session real and current?
   Exported so there is exactly one definition of "is this admin authenticated". */
export async function mfaValid(env, userId, mfa) {
  if (env.ADMIN_MFA_OFF === "1") return true;   // documented emergency switch
  if (!mfa || typeof mfa !== "string" || mfa.length < 32) return false;
  const rows = await jget(await svc(env,
    `/rest/v1/admin_mfa?session_token=eq.${encodeURIComponent(mfa)}&user_id=eq.${userId}&select=session_expires_at&limit=1`));
  const row = Array.isArray(rows) && rows[0];
  if (!row || !row.session_expires_at) return false;
  return Date.parse(row.session_expires_at) > Date.now();
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

  const admin = await adminVerify(body.token);
  if (!admin) return Response.json({ error: "admin only" }, { status: 403, headers });

  try {
    if (body.action === "send") return await send(env, req, admin, headers);
    if (body.action === "verify") return await verify(env, admin, body, headers);
    if (body.action === "check") {
      return Response.json({ valid: await mfaValid(env, admin.id, body.mfa) }, { status: 200, headers });
    }
    return Response.json({ error: "unknown action" }, { status: 400, headers });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
}

async function send(env, req, admin, headers) {
  if (env.ADMIN_MFA_OFF === "1") {
    return Response.json({ sent: false, disabled: true }, { status: 200, headers });
  }
  if (!env.RESEND_API_KEY) {
    // Say so plainly rather than pretending to send. Silently failing here would
    // look identical to "the email is slow", and the admin would sit waiting for
    // a code that was never going to arrive.
    return Response.json({ error: "Email is not configured (RESEND_API_KEY missing), so a code cannot be sent." },
      { status: 501, headers });
  }

  // Cheap rate limit: refuse if a code was already issued moments ago. Stops the
  // Resend quota being burned by someone hammering the button.
  const recent = await jget(await svc(env,
    `/rest/v1/admin_mfa?user_id=eq.${admin.id}&select=created_at&order=created_at.desc&limit=1`));
  const last = Array.isArray(recent) && recent[0] && Date.parse(recent[0].created_at);
  if (last && Date.now() - last < RESEND_COOLDOWN_S * 1000) {
    const wait = Math.ceil((RESEND_COOLDOWN_S * 1000 - (Date.now() - last)) / 1000);
    return Response.json({ error: "cooldown", wait }, { status: 429, headers });
  }

  const code = sixDigits();
  const code_hash = await hashCode(env, code, admin.id);
  const ip = req.headers.get("cf-connecting-ip") || "";

  const ins = await svc(env, "/rest/v1/admin_mfa", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: admin.id, code_hash, ip,
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString(),
    }),
  });
  if (!ins.ok) {
    const t = await ins.text().catch(() => "");
    return Response.json({ error: `could not create code: ${t.slice(0, 160)}` }, { status: 502, headers });
  }

  const from = env.EMAIL_FROM || "Summy Garden Studio <onboarding@resend.dev>";
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  let mail;
  try {
    mail = await fetchT("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [admin.email],
      subject: `${code} is your Summy Garden admin code`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:0 auto;padding:8px">` +
        `<h2 style="font-size:18px;margin:0 0 12px;color:#0b1f2b">Admin sign-in code</h2>` +
        `<p style="font-size:14px;color:#456;margin:0 0 16px">Enter this code to finish signing in to the Summy Garden Studio admin page.</p>` +
        `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;font-weight:800;letter-spacing:.28em;` +
        `background:#eaf6fd;border-radius:12px;padding:18px;text-align:center;color:#0b3a52">${code}</div>` +
        `<p style="font-size:13px;color:#5c7688;margin:16px 0 0">The code expires in ${CODE_TTL_MIN} minutes and can be used once.</p>` +
        `<p style="font-size:13px;color:#b42318;margin:12px 0 0"><b>If you did not just try to sign in, change your admin password immediately</b> — somebody else has it. Requested ${when}${ip ? ` from ${ip}` : ""}.</p>` +
        `</div>`,
    }),
    }, 12000);
  } catch (e) {
    // Aborted or refused. Answering with a real message beats letting Cloudflare
    // return an HTML 502 that hides everything.
    const why = e?.name === "AbortError"
      ? "email failed: Resend did not respond within 12 seconds"
      : `email failed: ${String(e?.message || e).slice(0, 200)}`;
    return Response.json({ error: why }, { status: 502, headers });
  }
  if (!mail.ok) {
    const t = await mail.text().catch(() => "");
    return Response.json({ error: `email failed: HTTP ${mail.status} ${t.slice(0, 220)}` }, { status: 502, headers });
  }

  // Opportunistic cleanup; never allowed to affect the response.
  try { await svc(env, "/rest/v1/rpc/sgs_admin_mfa_gc", { method: "POST", body: "{}" }); } catch {}

  return Response.json({ sent: true, ttl: CODE_TTL_MIN, cooldown: RESEND_COOLDOWN_S }, { status: 200, headers });
}

async function verify(env, admin, body, headers) {
  if (env.ADMIN_MFA_OFF === "1") {
    return Response.json({ mfa: "disabled", disabled: true }, { status: 200, headers });
  }
  const code = String(body.code || "").replace(/\D/g, "");
  if (code.length !== 6) return Response.json({ error: "bad_code" }, { status: 400, headers });

  const rows = await jget(await svc(env,
    `/rest/v1/admin_mfa?user_id=eq.${admin.id}&consumed=is.false&select=id,code_hash,expires_at,attempts&order=created_at.desc&limit=1`));
  const row = Array.isArray(rows) && rows[0];
  if (!row) return Response.json({ error: "no_code" }, { status: 400, headers });

  if (Date.parse(row.expires_at) < Date.now()) {
    return Response.json({ error: "expired" }, { status: 400, headers });
  }
  if ((row.attempts || 0) >= MAX_ATTEMPTS) {
    return Response.json({ error: "too_many" }, { status: 429, headers });
  }

  const given = await hashCode(env, code, admin.id);
  if (!sameHash(given, row.code_hash)) {
    // Count the miss before answering, so brute force is bounded even if the
    // attacker abandons the connection.
    await svc(env, `/rest/v1/admin_mfa?id=eq.${row.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ attempts: (row.attempts || 0) + 1 }),
    });
    const left = MAX_ATTEMPTS - (row.attempts || 0) - 1;
    return Response.json({ error: "wrong", left: Math.max(0, left) }, { status: 400, headers });
  }

  // Correct. Burn the code and issue the session in one update.
  const mfa = sessionToken();
  const upd = await svc(env, `/rest/v1/admin_mfa?id=eq.${row.id}&consumed=is.false`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      consumed: true, session_token: mfa,
      session_expires_at: new Date(Date.now() + SESSION_TTL_H * 3600000).toISOString(),
    }),
  });
  const saved = upd.ok ? await upd.json().catch(() => []) : [];
  // consumed=is.false in the filter means a replayed request updates nothing —
  // one code can only ever mint one session.
  if (!Array.isArray(saved) || !saved.length) {
    return Response.json({ error: "no_code" }, { status: 400, headers });
  }

  return Response.json({ mfa, hours: SESSION_TTL_H }, { status: 200, headers });
}
