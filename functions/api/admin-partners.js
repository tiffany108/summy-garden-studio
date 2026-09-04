// Summy Garden Studio — admin management of sales partners and KOLs.
//
// Actions (POST { token, mfa, action }):
//   list    — every partner with redemptions, earnings owed and paid
//   create  — { email, name, code, commission, kind } make a partner
//   toggle  — { userId, active } switch a partner on or off
//   payout  — { userId } mark all confirmed commission as paid
//
// Creating a partner does two things at once: it mints their discount code in
// discount_codes (so customers can actually use it) and their row in partners
// (so the commission is attributed). Those must not drift apart, which is why
// this endpoint owns both rather than leaving the code to be created by hand.
//
// Requires the admin JWT AND a current MFA session — this endpoint can commit
// you to paying commission, so it is not a soft target.
//
// Env: SUPABASE_SECRET_KEY, RESEND_API_KEY (for the invitation).

import { mfaValid } from "./admin-mfa.js";

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";
const SITE = "https://summygarden.com";

const FX = { usd: 1, gbp: 1.27, hkd: 0.128, eur: 1.09, cny: 0.14 };
const toUSD = (a, c) => (Number(a) || 0) * (FX[String(c || "usd").toLowerCase()] ?? 1);

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
  }, 12000);
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

const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);
const normEmail = (e) => String(e || "").trim().toLowerCase().slice(0, 320);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

  try {
    if (body.action === "create") return await create(env, body, headers);
    if (body.action === "toggle") return await toggle(env, body, headers);
    if (body.action === "payout") return await payout(env, body, headers);
    return await list(env, headers);
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
}

async function list(env, headers) {
  const partners = (await jget(await svc(env,
    "/rest/v1/partners?select=*&order=created_at.desc&limit=500"))) || [];
  const comms = (await jget(await svc(env,
    "/rest/v1/commissions?select=partner_id,commission,currency,status&limit=20000"))) || [];

  const agg = {};
  for (const c of comms) {
    const a = (agg[c.partner_id] = agg[c.partner_id] || { sales: 0, pending: 0, confirmed: 0, paid: 0 });
    const v = toUSD(c.commission, c.currency);
    a.sales++;
    if (c.status === "paid") a.paid += v;
    else if (c.status === "confirmed") a.confirmed += v;
    else if (c.status === "pending") a.pending += v;
  }
  const r2 = (n) => Math.round((n || 0) * 100) / 100;

  return Response.json({
    partners: partners.map((p) => {
      const a = agg[p.user_id] || { sales: 0, pending: 0, confirmed: 0, paid: 0 };
      return { ...p, stats: { sales: a.sales, pending: r2(a.pending), confirmed: r2(a.confirmed), paid: r2(a.paid) } };
    }),
  }, { status: 200, headers });
}

async function create(env, body, headers) {
  const email = normEmail(body.email);
  const code = normCode(body.code);
  const name = String(body.name || "").trim().slice(0, 80);
  const commission = parseInt(body.commission, 10);
  const kind = body.kind === "salesperson" ? "salesperson" : "partner";
  const discount = parseInt(body.discount, 10) || 20;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "a valid email is required" }, { status: 400, headers });
  if (code.length < 3) return Response.json({ error: "code needs at least 3 letters or numbers" }, { status: 400, headers });
  if (!(commission >= 0 && commission <= 90)) return Response.json({ error: "commission must be between 0 and 90%" }, { status: 400, headers });
  if (!(discount >= 1 && discount <= 100)) return Response.json({ error: "customer discount must be 1-100%" }, { status: 400, headers });

  /* The person must already have an account. Creating auth users from here would
     mean handling their password, which is exactly the thing we never want to
     touch — so they sign up normally first, then you promote them. */
  const users = await jget(await svc(env, `/rest/v1/profiles?select=id,name&limit=1&id=not.is.null&email=eq.${encodeURIComponent(email)}`));
  let userId = Array.isArray(users) && users[0] && users[0].id;

  if (!userId) {
    // profiles may not carry email; fall back to the auth admin listing.
    const au = await jget(await svc(env, `/auth/v1/admin/users?filter=${encodeURIComponent(email)}`));
    const found = au && (Array.isArray(au.users) ? au.users : []).find((u) => (u.email || "").toLowerCase() === email);
    userId = found && found.id;
  }
  if (!userId) {
    return Response.json({
      error: `No account found for ${email}. Ask them to sign up at ${SITE} first, then create the partner.`,
    }, { status: 404, headers });
  }

  const taken = await jget(await svc(env, `/rest/v1/discount_codes?code=eq.${encodeURIComponent(code)}&select=code&limit=1`));
  if (Array.isArray(taken) && taken.length) return Response.json({ error: `${code} is already in use` }, { status: 409, headers });

  // The customer-facing code. once_per_user stays true so one customer cannot
  // reuse a partner's code repeatedly.
  const dc = await svc(env, "/rest/v1/discount_codes", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ code, percent_off: discount, label: `Partner: ${name || email}`, active: true, once_per_user: true }),
  });
  if (!dc.ok) {
    const t = await dc.text().catch(() => "");
    return Response.json({ error: `could not create the code: ${t.slice(0, 160)}` }, { status: 502, headers });
  }

  const pr = await svc(env, "/rest/v1/partners?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, name: name, code, commission, kind, active: true, notes: String(body.notes || "").slice(0, 500) }),
  });
  if (!pr.ok) {
    const t = await pr.text().catch(() => "");
    // Roll the code back so a failure here does not leave an orphaned discount
    // that customers could use with nobody earning from it.
    await svc(env, `/rest/v1/discount_codes?code=eq.${encodeURIComponent(code)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return Response.json({ error: `could not create the partner: ${t.slice(0, 160)}` }, { status: 502, headers });
  }

  try { await invite(env, { email, name, code, commission, discount }); } catch {}
  return Response.json({ ok: true, code, userId }, { status: 200, headers });
}

async function invite(env, p) {
  if (!env.RESEND_API_KEY) return;
  const from = env.EMAIL_FROM || "Summy Garden Studio <admin@summygarden.com>";
  await fetchT("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [p.email], reply_to: ADMIN_EMAIL,
      subject: `Your Summy Garden partner code: ${p.code}`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:8px">` +
        `<h2 style="font-size:19px;margin:0 0 6px;color:#0b1f2b">Welcome aboard${p.name ? ", " + esc(p.name) : ""}</h2>` +
        `<p style="font-size:14px;color:#456;line-height:1.6;margin:0 0 16px">Your partner account is ready. Share your code and you earn a share of every purchase made with it.</p>` +
        `<div style="background:#eaf6fd;border-radius:12px;padding:18px;text-align:center">` +
        `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:30px;font-weight:800;letter-spacing:.18em;color:#0b3a52">${esc(p.code)}</div>` +
        `<div style="font-size:13px;color:#5c7688;margin-top:8px">Customers get ${p.discount}% off &middot; you earn ${p.commission}% of what they pay</div>` +
        `</div>` +
        `<p style="font-size:14px;color:#456;line-height:1.6;margin:16px 0 0">Track your sales and earnings any time at ` +
        `<a href="${SITE}/partner.html" style="color:#0284c7;font-weight:600">${SITE}/partner.html</a> — sign in with this email address.</p>` +
        `<p style="font-size:13px;color:#5c7688;line-height:1.6;margin:14px 0 0">Each sale shows as pending for 30 days while the customer's quality guarantee runs, then becomes ready to pay. We settle by transfer and will be in touch to arrange it.</p>` +
        `<p style="font-size:13px;color:#5c7688;margin:14px 0 0">Reply to this email with any questions.</p>` +
        `</div>`,
    }),
  }, 12000);
}

async function toggle(env, body, headers) {
  if (!body.userId) return Response.json({ error: "bad request" }, { status: 400, headers });
  const active = !!body.active;
  const p = await svc(env, `/rest/v1/partners?user_id=eq.${encodeURIComponent(body.userId)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ active }),
  });
  const rows = p.ok ? await p.json().catch(() => []) : [];
  const code = Array.isArray(rows) && rows[0] && rows[0].code;
  // Switch their customer-facing code with them, or a paused partner's code
  // would keep discounting sales that earn nobody anything.
  if (code) {
    await svc(env, `/rest/v1/discount_codes?code=eq.${encodeURIComponent(code)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ active }),
    });
  }
  return Response.json({ ok: true, active }, { status: 200, headers });
}

async function payout(env, body, headers) {
  if (!body.userId) return Response.json({ error: "bad request" }, { status: 400, headers });
  /* Only `confirmed` rows are marked paid — never `pending`. A pending row is
     still inside its refund window, and marking it paid would record money as
     settled that you may yet have to claw back. */
  const r = await svc(env, `/rest/v1/commissions?partner_id=eq.${encodeURIComponent(body.userId)}&status=eq.confirmed`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "paid", paid_at: new Date().toISOString() }),
  });
  if (!r.ok) return Response.json({ error: "could not record the payout" }, { status: 502, headers });
  const rows = await r.json().catch(() => []);
  const total = (Array.isArray(rows) ? rows : []).reduce((n, c) => n + toUSD(c.commission, c.currency), 0);
  return Response.json({ ok: true, count: Array.isArray(rows) ? rows.length : 0, totalUSD: Math.round(total * 100) / 100 },
    { status: 200, headers });
}
