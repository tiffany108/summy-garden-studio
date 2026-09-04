// Summy Garden Studio — sales partner / KOL portal API.
//
// Actions (POST { token, action }):
//   me      — is this account a partner, and what is their code and rate
//   stats   — { from, to } headline figures + a day-by-day series for the chart
//
// A partner sees ONLY their own rows. That is enforced twice: the query is
// scoped to their user id here, and the RLS policies on `partners` and
// `commissions` restrict a member to `auth.uid() = ...` even if this endpoint
// were ever bypassed.
//
// Money is never moved by this file. It reports what is owed; Tiffany settles by
// transfer and marks it paid from the admin page.
//
// Env: SUPABASE_SECRET_KEY.

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

// Rough conversions, only for the "≈US$" roll-up. The ledger always stores the
// real amount and its own currency; this is presentation, never the record.
const FX = { usd: 1, gbp: 1.27, hkd: 0.128, eur: 1.09, cny: 0.14 };
const toUSD = (amt, cur) => (Number(amt) || 0) * (FX[String(cur || "usd").toLowerCase()] ?? 1);

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

// YYYY-MM-DD, or null. Anything else is ignored rather than trusted into a query.
const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? String(s) : null);

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

  const prows = await jget(await svc(env,
    `/rest/v1/partners?user_id=eq.${user.id}&select=name,code,commission,kind,active&limit=1`));
  const partner = Array.isArray(prows) && prows[0];
  if (!partner || !partner.active) {
    // Deliberately not "you are not a partner": this endpoint should not tell a
    // stranger whether partner accounts exist or how to become one.
    return Response.json({ partner: false }, { status: 200, headers });
  }

  if (body.action === "me") {
    return Response.json({
      partner: true, name: partner.name || user.name,
      code: partner.code, rate: partner.commission, kind: partner.kind,
    }, { status: 200, headers });
  }

  try {
    return await stats(env, user, partner, body, headers);
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
}

async function stats(env, user, partner, body, headers) {
  const from = day(body.from);
  const to = day(body.to);

  let q = `/rest/v1/commissions?partner_id=eq.${user.id}` +
          `&select=created_at,amount_paid,currency,commission,status,pack&order=created_at.asc&limit=5000`;
  if (from) q += `&created_at=gte.${from}T00:00:00Z`;
  // Inclusive of the end day: a filter that silently drops today's sales is the
  // kind of thing a partner notices and stops trusting the dashboard over.
  if (to) q += `&created_at=lte.${to}T23:59:59Z`;

  const rows = (await jget(await svc(env, q))) || [];

  let sales = 0, revenueUSD = 0, earnedUSD = 0;
  let pendingUSD = 0, confirmedUSD = 0, paidUSD = 0;
  const byDay = {};

  for (const r of rows) {
    const d = String(r.created_at || "").slice(0, 10);
    const cUSD = toUSD(r.commission, r.currency);
    const rUSD = toUSD(r.amount_paid, r.currency);
    sales++; revenueUSD += rUSD; earnedUSD += cUSD;
    if (r.status === "paid") paidUSD += cUSD;
    else if (r.status === "confirmed") confirmedUSD += cUSD;
    else if (r.status === "pending") pendingUSD += cUSD;
    if (!byDay[d]) byDay[d] = { date: d, sales: 0, earned: 0 };
    byDay[d].sales++; byDay[d].earned += cUSD;
  }

  /* Fill the gaps. A chart drawn only from days that happen to have sales
     compresses quiet weeks and makes a flat month look busy — the series is
     padded so the time axis is honest. Capped so a silly range cannot make the
     Worker build a hundred thousand points. */
  let series = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  if (from && to) {
    const out = [];
    const d0 = new Date(from + "T00:00:00Z"), d1 = new Date(to + "T00:00:00Z");
    for (let d = new Date(d0), n = 0; d <= d1 && n < 400; d.setUTCDate(d.getUTCDate() + 1), n++) {
      const k = d.toISOString().slice(0, 10);
      out.push(byDay[k] || { date: k, sales: 0, earned: 0 });
    }
    if (out.length) series = out;
  }

  const r2 = (n) => Math.round(n * 100) / 100;
  return Response.json({
    partner: true, code: partner.code, rate: partner.commission,
    name: partner.name || user.name,
    range: { from, to },
    totals: {
      sales,
      revenueUSD: r2(revenueUSD),
      earnedUSD: r2(earnedUSD),
      pendingUSD: r2(pendingUSD),
      confirmedUSD: r2(confirmedUSD),
      paidUSD: r2(paidUSD),
    },
    series: series.map((s) => ({ date: s.date, sales: s.sales, earned: r2(s.earned) })),
    /* The individual sales, newest first, for the table. Capped at 100: a
       partner scanning recent activity does not page through thousands, and the
       totals above already cover the whole range. */
    rows: rows.slice().reverse().slice(0, 100).map((r) => ({
      date: String(r.created_at || "").slice(0, 10),
      pack: r.pack || "",
      paid: Number(r.amount_paid) || 0,
      currency: (r.currency || "usd").toUpperCase(),
      earned: Number(r.commission) || 0,
      status: r.status,
    })),
  }, { status: 200, headers });
}
