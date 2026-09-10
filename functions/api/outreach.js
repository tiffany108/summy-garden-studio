// Outreach desk — the engine behind /outreach.html.
//
// A general cold-outreach pipeline, not tied to any one product. Each CAMPAIGN
// carries its own sender identity and its own message, so the same tool serves
// the headshot business today and whatever comes next without a rewrite.
//
//   discover  paste the URL of a page that lists companies; it pulls the
//             company websites out of it
//   add       or paste a list of websites directly
//   enrich    read each company's own site for a PUBLISHED shared mailbox and
//             for something true to open a message with
//   draft     merge into the campaign's template
//   send      dry run first, one message per company, one follow-up, ever
//
// Protected like the admin dashboard — owner account plus second factor —
// because it sends email under your name.
//
// Env: SUPABASE_SECRET_KEY, RESEND_API_KEY, EMAIL_FROM
import { mfaValid } from "./admin-mfa.js";

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";

const PACE_MS = 1000;
const MAX_PAGES = 6;
const ENRICH_PER_CALL = 3;

/* ------------------------------------------------------------------- auth */
function jwtPayload(t) {
  try {
    const b = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const s = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(u));
  } catch { return null; }
}
async function sbVerify(token) {
  if (!token) return null;
  const p = jwtPayload(token);
  if (!p || !p.sub || (p.exp && Date.now() / 1000 >= p.exp)) return null;
  const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(p.sub)}&select=id`,
    { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? { id: p.sub, email: (p.email || "").toLowerCase() } : null;
}

const svc = (env, path, opts = {}) => fetch(`${SB_URL}${path}`, {
  ...opts,
  headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
             "Content-Type": "application/json", ...(opts.headers || {}) },
});
const getJson = async (p) => { const r = await p; return r.ok ? r.json().catch(() => null) : null; };
const inList = (a) => "(" + a.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",") + ")";

/* ------------------------------------------------------- address discovery
   Accept an address only when its local part is a KNOWN SHARED MAILBOX. An
   allowlist fails safe; a blocklist fails open the first time somebody is
   called Info Smith, and that failure means emailing a private individual. */
const ROLE_PARTS = [
  "hello", "hi", "info", "enquiries", "enquiry", "inquiries", "contact", "contactus", "general", "mail", "team",
  "sales", "newbusiness", "business", "partnerships", "partner", "bd",
  "hr", "humanresources", "people", "peopleteam", "peopleandculture", "personnel",
  "recruitment", "recruiting", "careers", "career", "jobs", "talent", "hiring",
  "marketing", "comms", "communications", "brand", "press", "media",
  "office", "operations", "ops", "admin", "reception", "support", "help",
];
const RANK = new Map(ROLE_PARTS.map((p, i) => [p, i]));
const PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/team",
               "/our-team", "/people", "/careers", "/jobs", "/privacy", "/imprint"];
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function extractEmails(html) {
  const out = new Set();
  for (const m of String(html).matchAll(/mailto:([^"'?>\s]+)/gi)) out.add(decodeURIComponent(m[1]));
  const text = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  for (const m of text.matchAll(EMAIL_RE)) out.add(m[0]);
  return [...out].map((e) => e.toLowerCase().trim().replace(/[.,;:]+$/, ""));
}
const sameSite = (a, b) => { a = a.toLowerCase(); b = b.toLowerCase();
  return a === b || a.endsWith("." + b) || b.endsWith("." + a); };

function roleAddresses(emails, domain) {
  const seen = new Map();
  for (const e of emails) {
    const [local, dom] = e.split("@");
    if (!local || !dom || !sameSite(dom, domain)) continue;
    const bare = local.toLowerCase(), squashed = bare.replace(/[._-]/g, "");
    const rank = RANK.has(bare) ? RANK.get(bare) : (RANK.has(squashed) ? RANK.get(squashed) : -1);
    if (rank < 0) continue;
    if (!seen.has(e) || seen.get(e) > rank) seen.set(e, rank);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([e]) => e);
}

/* --------------------------------------------------------- reading a site
   What the tool collects is EVIDENCE, not claims. It reads how a company
   describes itself and a few plain signals; the sentence that goes in the
   email is written by a person, in the box next to that evidence. A tool that
   invents the personalised line is a tool that eventually invents a wrong one,
   a hundred times, under your name. */
const strip = (s) => String(s).replace(/\s+/g, " ").trim();

function readSite(html) {
  const g = (re) => (String(html).match(re) || [])[1] || "";
  const title = strip(g(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i));
  const desc = strip(g(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{0,400})["']/i)
                  || g(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']{0,400})["']/i));
  const h1 = strip(g(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i).replace(/<[^>]+>/g, " "));
  return { title: title.slice(0, 200), summary: (desc || h1).slice(0, 300) };
}

function readSignals(html, url) {
  const s = String(html);
  return {
    careers: /\/(careers|jobs|vacancies|join-us|work-with-us)\b/i.test(s),
    team_page: /\/(team|our-team|people|our-people|who-we-are)\b/i.test(s),
    news: /\/(news|blog|insights|press)\b/i.test(s),
    linkedin: /linkedin\.com\/company\/([A-Za-z0-9\-_%]+)/i.exec(s)?.[1] || "",
  };
}

/* --------------------------------------------------------------- fetching */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = "OutreachDesk/1.0 (+https://summygarden.com)";

async function grab(url, timeout = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ac.signal,
      headers: { "User-Agent": UA, Accept: "text/html,*/*" } });
    return { ok: r.ok, status: r.status, url: r.url || url, body: r.ok ? await r.text() : "" };
  } catch { return { ok: false, status: 0, url, body: "" }; }
  finally { clearTimeout(t); }
}

function robotsBlocks(robotsText, path) {
  if (!robotsText) return false;
  let applies = false; const rules = [];
  for (const raw of String(robotsText).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(); if (!line) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const f = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (f === "user-agent") applies = v === "*" || /outreachdesk/i.test(v);
    else if (applies && (f === "disallow" || f === "allow")) {
      if (f === "disallow" && v === "") continue;
      rules.push({ path: v, allow: f === "allow" });
    }
  }
  let blocked = false, best = -1;
  for (const r of rules) if (path.startsWith(r.path) && r.path.length > best) { best = r.path.length; blocked = !r.allow; }
  return blocked;
}

/* --------------------------------------------------------------- discover
   Point it at a page that lists companies — a directory, a member list, an
   exhibitor list, an "our clients" page — and it pulls the company websites
   out of the links. Aggregators and social profiles are dropped, because they
   are never the prospect. */
const NOT_A_PROSPECT = /(^|\.)(linkedin|twitter|x|facebook|instagram|youtube|tiktok|pinterest|reddit|medium|github|google|goo\.gl|bit\.ly|apple|microsoft|amazon|wikipedia|wordpress|squarespace|wix|godaddy|cloudflare|gravatar|w3\.org|schema\.org|gstatic|googleapis|doubleclick|mailchimp|eventbrite|hubspot|calendly|typeform|paypal|stripe|xing|vimeo|flickr|whatsapp|telegram|t\.me)\./i;

function cleanDomain(v) {
  const raw = String(v || "").trim();
  if (!raw || !/\./.test(raw) || /\s/.test(raw) || /@/.test(raw)) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    const h = u.hostname.replace(/^www\./i, "").toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : "";
  } catch { return ""; }
}

function discoverFrom(html, pageUrl) {
  let host = ""; try { host = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase(); } catch {}
  const found = new Map();
  for (const m of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
    const href = m[1];
    if (!/^https?:\/\//i.test(href)) continue;
    const dom = cleanDomain(href);
    if (!dom || dom === host || dom.endsWith("." + host) || host.endsWith("." + dom)) continue;
    if (NOT_A_PROSPECT.test(dom + ".")) continue;
    const text = strip(m[2].replace(/<[^>]+>/g, " "));
    const prev = found.get(dom);
    // The longest anchor text is the likeliest company name; "visit site" is not.
    if (!prev) found.set(dom, { domain: dom, name: text, hits: 1 });
    else { prev.hits++; if (text.length > (prev.name || "").length) prev.name = text; }
  }
  return [...found.values()]
    .map((c) => ({ ...c, name: (c.name && c.name.length > 2 && c.name.length < 90 ? c.name : prettyName(c.domain)) }))
    .sort((a, b) => b.hits - a.hits);
}
const prettyName = (d) => String(d).split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------------------------------------------------------------- enrich */
async function enrichOne(row) {
  const domain = String(row.domain || "").toLowerCase();
  if (!domain) return { ...row, enrich_error: "no website" };
  const origin = "https://" + domain;

  const rob = await grab(origin + "/robots.txt", 6000);
  const found = [], provenance = {}, read = [];
  let site = null, signals = null, blocked = 0, reachable = false;

  for (const p of PATHS) {
    if (read.length >= MAX_PAGES) break;
    if (robotsBlocks(rob.body, p || "/")) { blocked++; continue; }
    if (read.length) await sleep(PACE_MS);
    const r = await grab(origin + p);
    if (!r.ok || !r.body) continue;
    reachable = true; read.push(r.url);
    if (!site) { site = readSite(r.body); signals = readSignals(r.body, r.url); }
    for (const e of roleAddresses(extractEmails(r.body), domain)) {
      if (!found.includes(e)) { found.push(e); provenance[e] = r.url; }
    }
    /* Stop only once BOTH questions are answered — an address, and something
       to say. Stopping at the first address meant the companies easiest to
       reach were the ones we knew least about. */
    if (found.length && site && site.summary) break;
  }

  const ranked = roleAddresses(found, domain);
  return {
    ...row,
    email: ranked[0] || "", emails: ranked,
    email_page: ranked[0] ? provenance[ranked[0]] : "",
    email_found_at: ranked[0] ? new Date().toISOString() : null,
    site_title: site?.title || "", site_summary: site?.summary || "",
    signals: signals || {}, pages_read: read,
    enrich_error: ranked.length ? null
      : !reachable ? "their website did not respond"
      : blocked ? "their robots.txt forbids the pages an address would be on"
      : "no shared mailbox published on their site",
  };
}

/* --------------------------------------------------------------- drafting */
const PLACEHOLDER = /<<([^<>]+)>>/g;
const VAR = /\{\{(\w+)(\?)?\}\}/g;

/* {{name}} is required — missing, it becomes a gap and blocks the send.
   {{name?}} is optional — missing, it disappears along with its blank line. */
function render(tpl, vars) {
  return String(tpl).replace(/\{\{(\w+)\?\}\}\n?\n?/g, (m, k) => {
    const v = vars[k];
    return v === undefined || v === null || String(v).trim() === "" ? "" : String(v) + m.slice(m.indexOf("}}") + 2);
  }).replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const v = vars[k];
    return v === undefined || v === null || String(v).trim() === "" ? `<<${k}>>` : String(v);
  });
}

function draftFor(row, campaign) {
  const vars = {
    company: row.name || row.domain, domain: row.domain,
    note: row.note || "", proof: campaign.proof || "",
    sender: campaign.from_name || "", title: row.site_title || "",
  };
  const body = render(campaign.body_tpl || "", vars);
  const subject = render(campaign.subject_tpl || "", vars).replace(PLACEHOLDER, (m, k) => `<<${k}>>`);
  const holes = [...(body + " " + subject).matchAll(PLACEHOLDER)].map((m) => m[1]);
  return { subject, body, needs_human: holes.length > 0, gaps: [...new Set(holes)] };
}

const FOOTER = (c) =>
  `\n\n${c.from_name} · ${c.company_name || ""} · ${c.site || ""}`.replace(/ · $/, "") +
  `\nNot interested? Reply with "no" and I won't write again.`;

/* ------------------------------------------------------------------ input */
function parseList(text) {
  const out = [], seen = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const parts = line.split(/[,\t]/).map((x) => x.trim()).filter(Boolean);
    let domain = "", name = "";
    for (const p of parts) { const d = cleanDomain(p); if (d && !domain) domain = d; else if (!name) name = p; }
    if (!domain) domain = cleanDomain(line);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push({ domain, name: name || prettyName(domain) });
  }
  return out;
}

/* ------------------------------------------------------------------ entry */
export async function onRequest(context) {
  const { request: req, env } = context;
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  if (!env.SUPABASE_SECRET_KEY) return Response.json({ error: "not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const caller = await sbVerify(body.token);
  if (!caller) return Response.json({ error: "sign in required" }, { status: 401, headers });
  if (caller.email !== ADMIN_EMAIL) return Response.json({ error: "owner only" }, { status: 403, headers });
  if (!(await mfaValid(env, caller.id, body.mfa))) {
    return Response.json({ error: "mfa required", mfa: true }, { status: 401, headers });
  }

  const A = body.action || "load";
  const campaignId = body.campaign_id || null;
  const campaign = campaignId
    ? (await getJson(svc(env, `/rest/v1/campaigns?id=eq.${encodeURIComponent(campaignId)}&select=*&limit=1`)) || [])[0]
    : null;

  // ------------------------------------------------------------------ load
  if (A === "load") {
    const campaigns = await getJson(svc(env, `/rest/v1/campaigns?select=*&order=created_at.desc&limit=50`)) || [];
    const active = campaignId || campaigns[0]?.id || null;
    const rows = active
      ? await getJson(svc(env, `/rest/v1/prospects?campaign_id=eq.${encodeURIComponent(active)}&select=*&order=updated_at.desc&limit=500`)) || []
      : [];
    const sup = await getJson(svc(env, `/rest/v1/prospect_suppressions?select=*&order=at.desc&limit=300`)) || [];
    const sends = await getJson(svc(env, `/rest/v1/prospect_sends?select=to_email,kind,at&limit=2000`)) || [];
    const today = new Date().toISOString().slice(0, 10);
    return Response.json({ ok: true, campaigns, campaign_id: active, rows, suppressions: sup,
      sent_today: sends.filter((s) => String(s.at).slice(0, 10) === today).length }, { status: 200, headers });
  }

  // -------------------------------------------------------------- campaign
  if (A === "save_campaign") {
    const c = body.campaign || {};
    const patch = {
      name: String(c.name || "Untitled").slice(0, 120),
      from_name: String(c.from_name || "").slice(0, 120),
      company_name: String(c.company_name || "").slice(0, 120),
      site: String(c.site || "").slice(0, 160),
      subject_tpl: String(c.subject_tpl || "").slice(0, 300),
      body_tpl: String(c.body_tpl || "").slice(0, 4000),
      followup_tpl: String(c.followup_tpl || "").slice(0, 2000),
      proof: String(c.proof || "").slice(0, 500),
      daily_cap: Math.min(200, Math.max(1, Number(c.daily_cap) || 40)),
      followup_days: Math.min(60, Math.max(1, Number(c.followup_days) || 7)),
      updated_at: new Date().toISOString(),
    };
    if (c.id) {
      const r = await svc(env, `/rest/v1/campaigns?id=eq.${encodeURIComponent(c.id)}`,
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
      const rows = r.ok ? await r.json().catch(() => []) : [];
      return Response.json({ ok: r.ok, campaign: rows[0] || null }, { status: r.ok ? 200 : 502, headers });
    }
    const r = await svc(env, `/rest/v1/campaigns`,
      { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    return Response.json({ ok: r.ok, campaign: rows[0] || null }, { status: r.ok ? 200 : 502, headers });
  }

  // -------------------------------------------------------------- discover
  if (A === "discover") {
    const url = String(body.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return Response.json({ error: "Paste a full web address, starting with https://" }, { status: 400, headers });
    let origin = ""; try { origin = new URL(url).origin; } catch { return Response.json({ error: "that is not a web address" }, { status: 400, headers }); }
    const rob = await grab(origin + "/robots.txt", 6000);
    let path = "/"; try { path = new URL(url).pathname; } catch {}
    if (robotsBlocks(rob.body, path)) {
      return Response.json({ error: "That site's robots.txt asks us not to read this page." }, { status: 403, headers });
    }
    const r = await grab(url, 12000);
    if (!r.ok) return Response.json({ error: `Could not read that page (HTTP ${r.status || "no response"}).` }, { status: 502, headers });
    const found = discoverFrom(r.body, r.url);
    return Response.json({ ok: true, found: found.slice(0, 300), page: r.url }, { status: 200, headers });
  }

  // ------------------------------------------------------------------- add
  if (A === "add") {
    if (!campaign) return Response.json({ error: "pick a campaign first" }, { status: 400, headers });
    const list = Array.isArray(body.rows) && body.rows.length
      ? body.rows.map((x) => ({ domain: cleanDomain(x.domain), name: String(x.name || "").slice(0, 160) })).filter((x) => x.domain)
      : parseList(body.text || "");
    if (!list.length) return Response.json({ error: "No websites found in that. One per line — a web address, optionally with a name in front." }, { status: 400, headers });
    const rows = list.slice(0, 300).map((c) => ({
      campaign_id: campaign.id, name: c.name, domain: c.domain, stage: "sourced",
      source: String(body.source || "pasted").slice(0, 60),
      source_url: String(body.source_url || "").slice(0, 400),
    }));
    const r = await svc(env, `/rest/v1/prospects?on_conflict=campaign_id,domain`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    if (!r.ok) return Response.json({ error: "could not save: " + (await r.text()).slice(0, 200) }, { status: 502, headers });
    return Response.json({ ok: true, added: rows.length }, { status: 200, headers });
  }

  // ---------------------------------------------------------------- enrich
  if (A === "enrich") {
    if (!campaign) return Response.json({ error: "pick a campaign first" }, { status: 400, headers });
    const todo = (await getJson(svc(env,
      `/rest/v1/prospects?campaign_id=eq.${campaign.id}&stage=eq.sourced&select=*&order=created_at.asc&limit=${ENRICH_PER_CALL}`)) || []);
    if (!todo.length) return Response.json({ ok: true, done: 0, remaining: 0, results: [] }, { status: 200, headers });

    const out = await Promise.all(todo.map((r) =>
      enrichOne(r).catch(() => ({ ...r, enrich_error: "their site did not respond" }))));
    for (const o of out) {
      await svc(env, `/rest/v1/prospects?id=eq.${o.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          stage: "enriched", email: o.email || "", emails: o.emails || [],
          email_page: o.email_page || "", email_found_at: o.email_found_at,
          site_title: o.site_title || "", site_summary: o.site_summary || "",
          signals: o.signals || {}, pages_read: o.pages_read || [],
          enrich_error: o.enrich_error, updated_at: new Date().toISOString() }),
      });
    }
    const left = await svc(env, `/rest/v1/prospects?campaign_id=eq.${campaign.id}&stage=eq.sourced&select=id`,
      { headers: { Prefer: "count=exact" } });
    return Response.json({ ok: true, done: out.length,
      remaining: Number((left.headers.get("content-range") || "0/0").split("/")[1]) || 0,
      results: out.map((o) => ({ id: o.id, name: o.name, email: o.email, error: o.enrich_error })) }, { status: 200, headers });
  }

  // ----------------------------------------------------------------- draft
  if (A === "draft") {
    if (!campaign) return Response.json({ error: "pick a campaign first" }, { status: 400, headers });
    const rows = await getJson(svc(env,
      `/rest/v1/prospects?campaign_id=eq.${campaign.id}&stage=in.(enriched,drafted)&email=neq.&select=*&limit=300`)) || [];
    let n = 0, blocked = 0;
    for (const row of rows) {
      const d = draftFor(row, campaign);
      if (d.needs_human) blocked++;
      await svc(env, `/rest/v1/prospects?id=eq.${row.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ subject: d.subject, body: d.body, needs_human: d.needs_human,
                               stage: "drafted", updated_at: new Date().toISOString() }) });
      n++;
    }
    return Response.json({ ok: true, drafted: n, blocked }, { status: 200, headers });
  }

  // ------------------------------------------------------------------ save
  if (A === "save") {
    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.note === "string") patch.note = body.note.slice(0, 600);
    if (typeof body.subject === "string") patch.subject = body.subject.slice(0, 300);
    if (typeof body.body === "string") patch.body = body.body.slice(0, 4000);
    if (body.stage) patch.stage = String(body.stage).slice(0, 20);
    if (patch.body !== undefined || patch.subject !== undefined) {
      const text = (patch.body ?? "") + " " + (patch.subject ?? "");
      patch.needs_human = /<<[^<>]+>>/.test(text);
    }
    const r = await svc(env, `/rest/v1/prospects?id=eq.${encodeURIComponent(body.id)}`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    return Response.json({ ok: r.ok, row: rows[0] || null }, { status: r.ok ? 200 : 502, headers });
  }

  // ------------------------------------------------------------------ send
  if (A === "send") {
    if (!campaign) return Response.json({ error: "pick a campaign first" }, { status: 400, headers });
    if (!env.RESEND_API_KEY) return Response.json({ error: "RESEND_API_KEY is not set in Cloudflare" }, { status: 501, headers });
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return Response.json({ error: "nothing selected" }, { status: 400, headers });

    const rows = await getJson(svc(env, `/rest/v1/prospects?id=in.${encodeURIComponent(inList(ids))}&campaign_id=eq.${campaign.id}&select=*`)) || [];
    const sup = new Set(((await getJson(svc(env, `/rest/v1/prospect_suppressions?select=key`))) || []).map((s) => s.key));
    const sends = await getJson(svc(env, `/rest/v1/prospect_sends?select=to_email,kind,at&limit=3000`)) || [];
    const today = new Date().toISOString().slice(0, 10);
    let usedToday = sends.filter((s) => String(s.at).slice(0, 10) === today).length;

    const kind = body.kind === "followup" ? "followup" : "first";
    const cap = Number(campaign.daily_cap) || 40;
    const after = Number(campaign.followup_days) || 7;
    const out = { sent: 0, skipped: [], would: [] };

    for (const row of rows) {
      const why = (() => {
        if (!row.email) return "no address";
        if (/<<[^<>]+>>/.test(row.body || "") || /<<[^<>]+>>/.test(row.subject || "")) return "still has a gap to fill in";
        /* Someone who said no said no — across every campaign, not just this
           one. Suppression is global on purpose. */
        if (sup.has(row.email) || sup.has("@" + (row.email.split("@")[1] || ""))) return "on the do-not-contact list";
        const mine = sends.filter((s) => s.to_email === row.email);
        if (kind === "first" && mine.some((s) => s.kind === "first")) return "already written to";
        if (kind === "followup") {
          const first = mine.find((s) => s.kind === "first");
          if (!first) return "never written to";
          if (mine.some((s) => s.kind === "followup")) return "already followed up once";
          /* Fail CLOSED on a date we cannot read. `NaN < after` is false, so
             the obvious version of this line lets a follow-up straight through
             the moment a timestamp is missing or malformed — a guard that
             breaks by sending is worse than no guard at all. */
          const firstAt = Date.parse(first.at);
          if (!Number.isFinite(firstAt)) return "cannot tell when the first message went, so not following up";
          const days = (Date.now() - firstAt) / 86400000;
          if (days < after) return `only ${days.toFixed(1)} of ${after} days since the first message`;
        }
        if (usedToday >= cap) return `daily cap of ${cap} reached`;
        return null;
      })();
      if (why) { out.skipped.push({ name: row.name, why }); continue; }
      if (!body.confirm) { out.would.push({ name: row.name, to: row.email }); usedToday++; continue; }

      const subject = kind === "followup" ? "re: " + row.subject : row.subject;
      const text = (kind === "followup"
        ? render(campaign.followup_tpl || "Hello,\n\nFollowing up once, then I will leave it.\n\nIf this is not a priority just now, no problem at all — is there someone else there I should have written to instead?",
                 { company: row.name, sender: campaign.from_name })
        : row.body) + FOOTER(campaign);

      const send = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM || `${campaign.from_name} <noreply@summygarden.com>`,
          to: [row.email], subject, text }),
      }).catch(() => null);
      if (!send || !send.ok) { out.skipped.push({ name: row.name, why: "the email provider refused it" }); continue; }

      await svc(env, `/rest/v1/prospect_sends`, { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ campaign_id: campaign.id, prospect_id: row.id, to_email: row.email, kind, subject }) });
      await svc(env, `/rest/v1/prospects?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ stage: kind === "first" ? "sent" : "followed_up", updated_at: new Date().toISOString() }) });
      sends.push({ to_email: row.email, kind, at: new Date().toISOString() });
      usedToday++; out.sent++;
    }
    return Response.json({ ok: true, ...out, confirmed: !!body.confirm }, { status: 200, headers });
  }

  // -------------------------------------------------------------- the list
  if (A === "suppress") {
    const key = String(body.key || "").toLowerCase().trim();
    if (!key) return Response.json({ error: "nothing given" }, { status: 400, headers });
    await svc(env, `/rest/v1/prospect_suppressions?on_conflict=key`, {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key, reason: String(body.reason || "asked").slice(0, 200) }) });
    return Response.json({ ok: true }, { status: 200, headers });
  }
  if (A === "unsuppress") {
    await svc(env, `/rest/v1/prospect_suppressions?key=eq.${encodeURIComponent(String(body.key || ""))}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return Response.json({ ok: true }, { status: 200, headers });
  }
  if (A === "remove") {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length) return Response.json({ error: "nothing selected" }, { status: 400, headers });
    await svc(env, `/rest/v1/prospects?id=in.${encodeURIComponent(inList(ids))}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return Response.json({ ok: true }, { status: 200, headers });
  }

  return Response.json({ error: "unknown action" }, { status: 400, headers });
}
