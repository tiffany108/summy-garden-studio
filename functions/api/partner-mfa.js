// Summy Garden Studio — two-factor authentication for the partner portal.
//
// Same shape as the admin one, for the same reason: a partner portal shows
// earnings, a payout account and a discount code that discounts real money. A
// password alone is one credential-stuffed reused password away from all three.
//
// Flow: password (Supabase) → 6-digit code emailed to their account address →
// 12-hour session. The session token is demanded by /api/partner on EVERY call,
// so the second factor is enforced by the server. A gate that only hid the
// dashboard in the browser would be theatre — /api/partner would still answer a
// direct request made with nothing but the password session.
//
// Actions (POST { token, action }):
//   send   — email a fresh 6-digit code to the partner's own address
//   verify — { code } → { mfa, expires }
//   check  — { mfa } → { valid }, so a returning visit skips a needless re-auth
//
// STORAGE. This reuses the admin_mfa table. It is misnamed for this purpose but
// the columns are entirely generic — a user id, a code hash, a session token —
// and rows are scoped by user_id, so an admin session can never be mistaken for
// a partner one or the reverse. Reusing it means no new migration to run before
// this works, which matters more today than a tidier name.
//
// Env: SUPABASE_SECRET_KEY, RESEND_API_KEY. Optional: EMAIL_FROM,
//      PARTNER_MFA_OFF=1 (emergency disable, mirroring ADMIN_MFA_OFF).

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

const CODE_TTL_MIN = 10;
const SESSION_TTL_H = 12;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 60;

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

function jwtPayload(t) {
  try {
    const b = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const s = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(u));
  } catch (e) { return null; }
}

/* Verify the JWT through PostgREST (/auth/v1 hangs from Workers on this
   project), then confirm the caller is an ACTIVE partner. A paused partner is
   treated exactly like a stranger — no code is sent, nothing is revealed. */
async function partnerVerify(env, token) {
  if (!token) return null;
  const p = jwtPayload(token);
  if (!p || !p.sub) return null;
  if (p.exp && Date.now() / 1000 >= p.exp) return null;
  const r = await fetchT(`${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.sub)}&select=id,name`,
    { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } }, 8000);
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;

  const prows = await jget(await svc(env,
    `/rest/v1/partners?user_id=eq.${encodeURIComponent(p.sub)}&select=name,active&limit=1`));
  const partner = Array.isArray(prows) && prows[0];
  if (!partner || !partner.active) return null;

  return { id: p.sub, email: (p.email || "").toLowerCase(), name: partner.name || rows[0].name || "" };
}

async function hashCode(env, code, userId) {
  const pepper = env.ADMIN_MFA_PEPPER || env.SUPABASE_SECRET_KEY || "";
  const data = new TextEncoder().encode(`${userId}:${code}:${pepper}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
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
/* Constant-time compare: String === on a hash leaks, through timing, how many
   leading characters matched. */
function sameHash(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* The single definition of "is this partner past the second factor". Imported
   by /api/partner so the answer cannot drift between the two files. */
export async function partnerMfaValid(env, userId, mfa) {
  if (env.PARTNER_MFA_OFF === "1") return true;
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

  const partner = await partnerVerify(env, body.token);
  // Deliberately not "you are not a partner": this endpoint should not tell a
  // stranger whether partner accounts exist.
  if (!partner) return Response.json({ error: "sign in required" }, { status: 403, headers });

  try {
    if (body.action === "send") return await send(env, req, partner, headers);
    if (body.action === "verify") return await verify(env, partner, body, headers);
    if (body.action === "check") {
      return Response.json({ valid: await partnerMfaValid(env, partner.id, body.mfa) }, { status: 200, headers });
    }
    return Response.json({ error: "unknown action" }, { status: 400, headers });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
}

async function send(env, req, partner, headers) {
  if (env.PARTNER_MFA_OFF === "1") {
    return Response.json({ sent: false, disabled: true }, { status: 200, headers });
  }
  if (!env.RESEND_API_KEY) {
    return Response.json({ error: "Email is not configured, so a code cannot be sent." }, { status: 501, headers });
  }
  if (!partner.email) {
    return Response.json({ error: "No email address on this account." }, { status: 400, headers });
  }

  /* Cooldown. Without it, "email me a code" is a free way to flood somebody's
     inbox and burn the sending quota. */
  const recent = await jget(await svc(env,
    `/rest/v1/admin_mfa?user_id=eq.${partner.id}&select=created_at&order=created_at.desc&limit=1`));
  const last = Array.isArray(recent) && recent[0] && Date.parse(recent[0].created_at);
  if (last && Date.now() - last < RESEND_COOLDOWN_S * 1000) {
    const wait = Math.ceil((RESEND_COOLDOWN_S * 1000 - (Date.now() - last)) / 1000);
    return Response.json({ error: `Please wait ${wait}s before asking for another code.`, wait },
      { status: 429, headers });
  }

  const code = sixDigits();
  const code_hash = await hashCode(env, code, partner.id);
  const ip = req.headers.get("CF-Connecting-IP") || "";

  const ins = await svc(env, "/rest/v1/admin_mfa", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: partner.id, code_hash, ip,
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString(),
    }),
  });
  if (!ins.ok) {
    const t = await ins.text().catch(() => "");
    return Response.json({ error: `could not store the code: ${t.slice(0, 140)}` }, { status: 502, headers });
  }

  const from = env.EMAIL_FROM || "Summy Garden Studio <no-reply@summygarden.com>";
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let r;
  try {
    r = await fetchT("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [partner.email],
        subject: `${code} is your Summy Garden partner sign-in code`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:460px;margin:0 auto;padding:8px">` +
          `<p style="font-size:14px;color:#456;margin:0 0 14px">Hello${partner.name ? " " + esc(partner.name.split(/\s+/)[0]) : ""}, here is your code to open your partner dashboard.</p>` +
          `<div style="background:#eaf6fd;border-radius:12px;padding:20px;text-align:center">` +
          `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;font-weight:800;letter-spacing:.22em;color:#0b3a52">${code}</div>` +
          `<div style="font-size:12.5px;color:#5c7688;margin-top:8px">Valid for ${CODE_TTL_MIN} minutes</div></div>` +
          `<p style="font-size:13px;color:#5c7688;line-height:1.6;margin:16px 0 0"><b>If you did not just try to sign in, someone has your password.</b> Change it, and tell us — reply to this email.</p>` +
          `<p style="font-size:12px;color:#8fa6b3;margin:14px 0 0">We will never ask you for this code, or for your bank details, by email or message.</p>` +
          `</div>`,
      }),
    }, 12000);
  } catch (e) {
    const why = e?.name === "AbortError" ? "the email provider timed out" : String(e?.message || e);
    return Response.json({ error: `Could not send the code: ${why}` }, { status: 502, headers });
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    return Response.json({ error: `Could not send the code: ${d?.message || r.status}` }, { status: 502, headers });
  }

  try { await svc(env, "/rest/v1/rpc/sgs_admin_mfa_gc", { method: "POST", body: "{}" }); } catch {}
  return Response.json({ sent: true, ttl: CODE_TTL_MIN, cooldown: RESEND_COOLDOWN_S }, { status: 200, headers });
}

async function verify(env, partner, body, headers) {
  const code = String(body.code || "").replace(/\D/g, "");
  if (code.length !== 6) return Response.json({ error: "Enter the 6-digit code." }, { status: 400, headers });

  const rows = await jget(await svc(env,
    `/rest/v1/admin_mfa?user_id=eq.${partner.id}&consumed=is.false&select=id,code_hash,expires_at,attempts&order=created_at.desc&limit=1`));
  const row = Array.isArray(rows) && rows[0];
  if (!row) return Response.json({ error: "no_code" }, { status: 400, headers });

  if (Date.parse(row.expires_at) < Date.now()) {
    return Response.json({ error: "That code has expired. Ask for a new one." }, { status: 400, headers });
  }
  if ((row.attempts || 0) >= MAX_ATTEMPTS) {
    return Response.json({ error: "Too many wrong attempts. Ask for a new code." }, { status: 429, headers });
  }

  const given = await hashCode(env, code, partner.id);
  if (!sameHash(given, row.code_hash)) {
    await svc(env, `/rest/v1/admin_mfa?id=eq.${row.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ attempts: (row.attempts || 0) + 1 }),
    });
    const left = MAX_ATTEMPTS - (row.attempts || 0) - 1;
    return Response.json({ error: left > 0 ? `That code is not right. ${left} attempts left.` : "Too many wrong attempts. Ask for a new code." },
      { status: 401, headers });
  }

  const mfa = sessionToken();
  const session_expires_at = new Date(Date.now() + SESSION_TTL_H * 3600000).toISOString();
  /* consumed=is.false in the filter makes this a compare-and-set: two racing
     requests cannot both mint a session from one code. */
  const upd = await svc(env, `/rest/v1/admin_mfa?id=eq.${row.id}&consumed=is.false`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ consumed: true, session_token: mfa, session_expires_at }),
  });
  const done = await jget(upd);
  if (!Array.isArray(done) || !done.length) {
    return Response.json({ error: "That code has already been used. Ask for a new one." }, { status: 409, headers });
  }
  return Response.json({ mfa, expires: session_expires_at }, { status: 200, headers });
}
