// Summy Garden Studio — customer reviews: submit, list, and one-click moderate.
//
// Actions (POST { action }):
//   submit   { token, rating, comment, name }  — member leaves a review
//   list     — approved reviews + the summary, for the public testimonial section
//   mine     { token }                          — has this member already reviewed
//   moderate { token, mfa, email, decision }    — admin, from the dashboard
//
// GET  /api/review?t=<token>&d=approve|reject   — one-click from the email
//
// Only a member who has actually generated headshots may review, and nothing is
// public until approved. Both rules exist because a rating is only worth
// publishing if it is true: the AggregateRating on the site is computed from
// these rows, and inflating it with invented entries is what Google penalises,
// what AI assistants discount, and what consumer-protection law forbids.
//
// Env: SUPABASE_SECRET_KEY, RESEND_API_KEY (for the approval email).

import { mfaValid } from "./admin-mfa.js";

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";
const SITE = "https://summygarden.com";

/* Photo credits given for a first review, whatever the rating. Same unit a
   referral pays in: 30 photo credits convert into one free shoot, so this is a
   thank-you rather than a payment. Deliberately NOT tied to the Trustpilot
   invitation — see the note at the award site below. */
const REVIEW_REWARD = 5;

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
async function sbVerify(token) {
  if (!token) return null;
  const p = jwtPayload(token);
  if (!p || !p.sub) return null;
  if (p.exp && Date.now() / 1000 >= p.exp) return null;
  const r = await fetchT(`${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.sub)}&select=id,name`,
    { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } }, 8000);
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return null;
  return { id: p.sub, email: (p.email || "").toLowerCase(), name: rows[0].name || "" };
}

function randToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Only the first name is ever published. A full name plus a photo studio is more
   personal information than a testimonial needs, and customers have not asked to
   be findable. */
const firstName = (n) => String(n || "").trim().split(/\s+/)[0].slice(0, 24);

export async function onRequest(context) {
  const { request: req, env } = context;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!env.SUPABASE_SECRET_KEY) return Response.json({ error: "not configured" }, { status: 501, headers });

  // One-click approve/reject straight from the notification email.
  if (req.method === "GET") return await oneClick(context);

  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });

  let body = {};
  try { body = await req.json(); } catch {}

  try {
    if (body.action === "list") return await list(env, headers);
    if (body.action === "mine") return await mine(env, body, headers);
    if (body.action === "moderate") return await moderate(env, body, headers);
    return await submit(env, body, headers);
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
}

async function list(env, headers) {
  const rows = await jget(await svc(env,
    "/rest/v1/reviews?status=eq.approved&select=name,rating,comment,verified,created_at&order=created_at.desc&limit=40")) || [];
  const sum = await jget(await svc(env, "/rest/v1/review_summary?select=*")) || [];
  const s = (Array.isArray(sum) && sum[0]) || {};
  return Response.json({
    reviews: rows,
    count: s.review_count || 0,
    average: s.average_rating != null ? Number(s.average_rating) : null,
    verified: s.verified_count || 0,
  }, {
    status: 200,
    // Short cache: testimonials change rarely, but a new approval should appear
    // within minutes rather than being pinned for an hour.
    headers: { ...headers, "Cache-Control": "public, max-age=300" },
  });
}

async function mine(env, body, headers) {
  const user = await sbVerify(body.token);
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const rows = await jget(await svc(env,
    `/rest/v1/reviews?user_id=eq.${user.id}&select=rating,comment,status&limit=1`)) || [];
  const shots = await jget(await svc(env,
    `/rest/v1/headshots?user_id=eq.${user.id}&select=user_id&limit=1`)) || [];
  return Response.json({
    review: (Array.isArray(rows) && rows[0]) || null,
    // Only offer the form to somebody who has something to review.
    eligible: Array.isArray(shots) && shots.length > 0,
  }, { status: 200, headers });
}

async function submit(env, body, headers) {
  const user = await sbVerify(body.token);
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers });

  const rating = parseInt(body.rating, 10);
  if (!(rating >= 1 && rating <= 5)) return Response.json({ error: "rating must be 1 to 5" }, { status: 400, headers });
  const comment = String(body.comment || "").trim().slice(0, 1200);

  /* Eligibility is checked here, on the server, not in the browser. A review
     from somebody who never generated a photo is not a customer review. */
  const shots = await jget(await svc(env,
    `/rest/v1/headshots?user_id=eq.${user.id}&select=user_id`)) || [];
  const nShots = Array.isArray(shots) ? shots.length : 0;
  if (!nShots) return Response.json({ error: "generate your headshots first" }, { status: 403, headers });

  const token = randToken();
  const row = {
    user_id: user.id,
    name: firstName(body.name || user.name) || "A customer",
    rating, comment,
    status: "pending",
    verified: true,           // proven above: they have generated photos
    shots: nShots,
    lang: String(body.lang || "en").slice(0, 8),
    created_at: new Date().toISOString(),
    reviewed_at: null,
    token,
  };

  /* Is this their FIRST review? Checked before the write, because the reward
     below must be payable exactly once — otherwise editing a review repeatedly
     becomes a way to mint credits. */
  const existing = await jget(await svc(env, `/rest/v1/reviews?user_id=eq.${user.id}&select=user_id&limit=1`));
  const isFirst = !(Array.isArray(existing) && existing.length);

  // One review per member: re-submitting replaces theirs and returns to pending.
  const r = await svc(env, "/rest/v1/reviews?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return Response.json({ error: `could not save: ${t.slice(0, 160)}` }, { status: 502, headers });
  }

  /* Thank-you credits for taking the time. Paid for ANY rating — a reward that
     only arrived for five stars would be buying praise rather than feedback, and
     the reviews it produced would be worthless to you and misleading to readers.
     Paid on the FIRST review only, and paid for the on-site review alone: the
     Trustpilot invitation carries no reward, because incentivised reviews breach
     Trustpilot's guidelines and get removed along with, potentially, the whole
     business profile. Customers are told about this reward before they submit,
     and approved reviews carry a visible note that credits were given. */
  let awarded = 0;
  if (isFirst) {
    try {
      const p = await jget(await svc(env, `/rest/v1/profiles?id=eq.${user.id}&select=photo_credits`));
      const cur = (Array.isArray(p) && p[0] && p[0].photo_credits) || 0;
      const up = await svc(env, `/rest/v1/profiles?id=eq.${user.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ photo_credits: cur + REVIEW_REWARD }),
      });
      if (up.ok) awarded = REVIEW_REWARD;
    } catch {}
  }

  // Tell the owner. Best effort — a mail hiccup must not lose the review.
  try { await notify(env, row, user.email); } catch {}

  return Response.json({ saved: true, status: "pending", awarded }, { status: 200, headers });
}

async function notify(env, row, customerEmail) {
  if (!env.RESEND_API_KEY) return;
  const from = env.EMAIL_FROM || "Summy Garden Studio <admin@summygarden.com>";
  const stars = "★".repeat(row.rating) + "☆".repeat(5 - row.rating);
  const ok = `${SITE}/api/review?t=${row.token}&d=approve`;
  const no = `${SITE}/api/review?t=${row.token}&d=reject`;
  await fetchT("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [ADMIN_EMAIL], reply_to: customerEmail || undefined,
      subject: `${stars} New review from ${row.name} — awaiting your approval`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:8px">` +
        `<h2 style="font-size:18px;margin:0 0 4px;color:#0b1f2b">New review awaiting approval</h2>` +
        `<p style="font-size:13px;color:#5c7688;margin:0 0 16px">Nothing appears on your site until you approve it.</p>` +
        `<div style="background:#f4f9fc;border-radius:12px;padding:16px">` +
        `<div style="font-size:22px;color:#f59e0b;letter-spacing:2px">${stars}</div>` +
        `<div style="font-size:15px;font-weight:700;margin-top:6px;color:#0b3a52">${esc(row.name)}` +
        `<span style="font-weight:500;color:#5c7688;font-size:13px"> · ${row.shots} photos generated</span></div>` +
        (row.comment ? `<p style="font-size:14px;line-height:1.6;color:#12303f;margin:10px 0 0">${esc(row.comment)}</p>` : "") +
        `</div>` +
        `<div style="margin-top:18px">` +
        `<a href="${ok}" style="display:inline-block;background:#178a52;color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;margin-right:8px">Approve &amp; publish</a>` +
        `<a href="${no}" style="display:inline-block;background:#eef0f4;color:#334;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px">Reject</a>` +
        `</div>` +
        `<p style="font-size:12px;color:#8fa6b3;margin:16px 0 0">Reply to this email to reach the customer directly.</p>` +
        `</div>`,
    }),
  }, 12000);
}

/* One-click moderation from the email. The token is single-use: it is cleared
   the moment it is spent, so a forwarded email cannot be replayed. It is 24
   random bytes, so it cannot be guessed — and the worst a leak could do is
   publish or hide one review, which you can undo from the admin page. */
async function oneClick(context) {
  const { request: req, env } = context;
  const url = new URL(req.url);
  const t = url.searchParams.get("t") || "";
  const d = url.searchParams.get("d") === "reject" ? "rejected" : "approved";
  const page = (title, msg, colour) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title><div style="font-family:system-ui,sans-serif;max-width:420px;margin:16vh auto;padding:28px;` +
      `text-align:center;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(7,44,69,.12)">` +
      `<div style="font-size:40px">${colour}</div><h1 style="font-size:20px;margin:10px 0 6px;color:#0b1f2b">${title}</h1>` +
      `<p style="font-size:14px;color:#5c7688;margin:0 0 18px">${msg}</p>` +
      `<a href="${SITE}/admin.html" style="color:#0284c7;font-weight:600;font-size:14px">Open the admin page</a></div>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

  if (!t || t.length < 16) return page("Link not valid", "That moderation link is malformed.", "⚠️");

  const r = await svc(env, `/rest/v1/reviews?token=eq.${encodeURIComponent(t)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: d, reviewed_at: new Date().toISOString(), token: null }),
  });
  const rows = r.ok ? await r.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows.length) {
    return page("Already handled", "That review has already been approved or rejected.", "✅");
  }
  return d === "approved"
    ? page("Published", "The review is now live on your site.", "🎉")
    : page("Rejected", "The review will not be shown.", "🚫");
}

async function moderate(env, body, headers) {
  const admin = await sbVerify(body.token);
  if (!admin || admin.email !== ADMIN_EMAIL) return Response.json({ error: "admin only" }, { status: 403, headers });
  if (!(await mfaValid(env, admin.id, body.mfa))) {
    return Response.json({ error: "mfa required", mfa: true }, { status: 401, headers });
  }
  if (body.decision === "list") {
    const rows = await jget(await svc(env,
      "/rest/v1/reviews?select=user_id,name,rating,comment,status,verified,shots,created_at&order=created_at.desc&limit=200")) || [];
    return Response.json({ reviews: rows }, { status: 200, headers });
  }
  const status = body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : null;
  if (!status || !body.userId) return Response.json({ error: "bad request" }, { status: 400, headers });
  const r = await svc(env, `/rest/v1/reviews?user_id=eq.${encodeURIComponent(body.userId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status, reviewed_at: new Date().toISOString(), token: null }),
  });
  if (!r.ok) return Response.json({ error: "could not update" }, { status: 502, headers });
  return Response.json({ ok: true, status }, { status: 200, headers });
}
