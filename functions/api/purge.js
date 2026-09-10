// Summy Garden Studio — scheduled deletion of stored photos.
//
// Two promises are kept here, and neither of them was previously kept by
// anything that ran on its own:
//
//   Enterprise — a company's photos are deleted purge_days after they are
//     taken (1–14, capped by organisations_purge_days_ck). Staff are emailed
//     before the deadline so nobody loses a photo they wanted. An ended
//     contract takes everything immediately.
//   Consumer  — the 180-day window advertised on the site. generate.js already
//     tidies a customer's own expired photos, but only when that customer
//     shoots again; somebody who bought one pack and never came back kept
//     their photos forever. This closes that.
//
// Called on a schedule, not by a browser: pg_cron + pg_net hit it once a day
// (see migrations/2026-09-10-purge-job.sql) with the shared secret. There is no
// user session involved, so the secret is the only thing standing in front of a
// destructive endpoint — it is compared in constant time and the endpoint says
// nothing useful when it is wrong.
//
// Env: SUPABASE_SECRET_KEY, PURGE_SECRET, RESEND_API_KEY, EMAIL_FROM

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";

/* Mirrors RETENTION_DAYS in generate.js. If you change one, change both — they
   describe the same promise to the same customer. */
const RETENTION_DAYS = 180;

/* The enterprise ceiling, mirroring MAX_PURGE_DAYS in org.js and the check
   constraint on organisations. A larger value in the database is treated as the
   ceiling rather than trusted. */
const MAX_PURGE_DAYS = 14;

/* How long before the deadline staff are emailed. Three days survives a
   weekend, which one day does not. */
const REMIND_BEFORE_DAYS = 3;

/* A run is deliberately bounded. A Worker has a wall-clock limit, and a purge
   that dies half way through must leave the data consistent — it does, because
   files go before rows and every step is idempotent, so the next run picks up
   what is left. The response says whether more is waiting. */
const MAX_PHOTOS_PER_RUN = 3000;

const svc = (env, path, opts = {}) => fetch(`${SB_URL}${path}`, {
  ...opts,
  headers: {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  },
});

async function getJson(p) {
  const r = await p;
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// PostgREST `in.(...)` needs each value quoted, with embedded quotes doubled.
const inList = (arr) => "(" + arr.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",") + ")";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Length is not secret, but the contents are: compare every byte so a wrong key
   takes the same time whatever it looks like. */
function sameSecret(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* Files first, rows second — the same order as delete-photos.js and
   purgeExpiredPhotos, so a half-failure leaves a dead thumbnail rather than a
   file that nothing points at and nothing will ever come back for. */
async function removePhotos(env, rows, dry) {
  const paths = [], ids = [];
  for (const r of rows) {
    // Every stored path is `<uid>/<file>`. Anything else is a data bug, and
    // deleting on a guess is not something to do with somebody's photographs.
    if (typeof r.path !== "string" || !r.user_id || !r.path.startsWith(r.user_id + "/")) continue;
    paths.push(r.path); ids.push(r.id);
  }
  const skipped = rows.length - paths.length;
  if (!paths.length) return { files: 0, rows: 0, skipped };
  if (dry) return { files: 0, rows: paths.length, skipped };

  let files = 0;
  for (let i = 0; i < paths.length; i += 500) {
    const chunk = paths.slice(i, i + 500);
    const r = await svc(env, "/storage/v1/object/headshots", {
      method: "DELETE", body: JSON.stringify({ prefixes: chunk }),
    });
    if (r.ok) files += chunk.length;
  }

  let gone = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const r = await svc(env, `/rest/v1/headshots?id=in.${encodeURIComponent(inList(chunk))}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } });
    if (r.ok) gone += chunk.length;
  }
  return { files, rows: gone, skipped };
}

async function sendDownloadReminder(env, { from, email, orgName, days, deadline }) {
  const when = new Date(deadline).toISOString().slice(0, 10);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [email],
      subject: `Download your headshot before ${when}`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:8px">` +
        `<h2 style="font-size:19px;margin:0 0 12px;color:#0b1f2b">Your headshot is about to be deleted</h2>` +
        `<p style="font-size:14.5px;color:#456;line-height:1.6;margin:0 0 18px">` +
        `${esc(orgName)} asked us to keep staff photographs for no longer than ${days} days, so yours will be ` +
        `deleted on <b>${esc(when)}</b>. Download it before then and it is yours to keep — after that we will not ` +
        `have a copy, and neither will ${esc(orgName)}.</p>` +
        `<p style="margin:0 0 20px"><a href="https://summygarden.com/" ` +
        `style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;font-weight:700;` +
        `font-size:15px;border-radius:10px;padding:13px 22px">Download my headshot</a></p>` +
        `<p style="font-size:12.5px;color:#5c7688;line-height:1.6;margin:0">` +
        `Deleting them is the point, not an oversight — it is why your employer could arrange this without ` +
        `keeping a folder of staff photographs itself.</p></div>`,
    }),
  }).catch(() => null);
  return !!(r && r.ok);
}

export async function onRequest(context) {
  const { request: req, env } = context;
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  if (!env.SUPABASE_SECRET_KEY) return Response.json({ error: "not configured" }, { status: 501, headers });
  if (!env.PURGE_SECRET) return Response.json({ error: "not configured" }, { status: 501, headers });

  let body = {};
  try { body = await req.json(); } catch {}

  if (!sameSecret(req.headers.get("x-purge-key") || body.key, env.PURGE_SECRET)) {
    // Deliberately terse: an endpoint that deletes photographs owes a caller it
    // does not recognise no explanation at all.
    return Response.json({ error: "no" }, { status: 401, headers });
  }

  const dry = body.dry_run === true;
  const now = Date.now();
  const from = env.EMAIL_FROM || "Summy Garden Studio <onboarding@resend.dev>";
  const report = { dry, at: new Date(now).toISOString(), orgs: [], consumer: null, more: false };
  let budget = MAX_PHOTOS_PER_RUN;

  // ------------------------------------------------------------- enterprise
  const orgs = await getJson(svc(env, `/rest/v1/organisations?select=id,name,purge_days,status&limit=500`));
  for (const org of (Array.isArray(orgs) ? orgs : [])) {
    if (budget <= 0) { report.more = true; break; }

    const days = Math.min(MAX_PURGE_DAYS, Math.max(1, Number(org.purge_days) || MAX_PURGE_DAYS));
    /* A finished contract takes everything, now. That is the answer to "what
       happens to our staff's photos when we leave", and it should not depend on
       anyone remembering to press something. */
    const ended = org.status === "ended";
    const cutoff = new Date(ended ? now : now - days * 86400000).toISOString();
    const line = {
      org: org.name, id: org.id, days, reason: ended ? "contract_end" : "window_expired",
      photos: 0, files: 0, members: 0, reminded: 0,
    };

    const roster = await getJson(svc(env, `/rest/v1/org_members?org_id=eq.${encodeURIComponent(org.id)}` +
      `&select=id,email,name,user_id,download_reminded_for,purged_at&limit=2000`)) || [];
    const byUser = new Map(roster.filter((m) => m.user_id).map((m) => [m.user_id, m]));

    const doomed = await getJson(svc(env, `/rest/v1/headshots?org_id=eq.${encodeURIComponent(org.id)}` +
      `&created_at=lt.${encodeURIComponent(cutoff)}&select=id,path,user_id,created_at` +
      `&order=created_at.asc&limit=${budget}`)) || [];

    if (doomed.length) {
      if (doomed.length >= budget) report.more = true;
      budget -= doomed.length;

      const out = await removePhotos(env, doomed, dry);
      line.photos = out.rows; line.files = out.files;
      if (out.skipped) line.skipped = out.skipped;

      /* One audit row per member, per run. No image data — just enough to answer
         "prove you deleted it", which is the question that follows every
         contract ending. */
      const perMember = new Map();
      for (const d of doomed) {
        const m = byUser.get(d.user_id);
        const k = m ? m.id : null;
        perMember.set(k, (perMember.get(k) || 0) + 1);
      }
      line.members = perMember.size;
      if (!dry) {
        const audit = [...perMember].map(([member_id, photos]) => ({
          org_id: org.id, member_id, photos, reason: line.reason,
        }));
        if (audit.length) {
          await svc(env, `/rest/v1/org_deletions`, {
            method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(audit),
          });
        }
      }
    }

    /* Who has nothing left? Marked purged so the HR console can say so, and so
       the company can see at a glance that the window did what it promised. */
    if (!dry && doomed.length) {
      const left = await getJson(svc(env, `/rest/v1/headshots?org_id=eq.${encodeURIComponent(org.id)}` +
        `&select=user_id&limit=5000`)) || [];
      const alive = new Set(left.map((h) => h.user_id));
      const emptied = roster.filter((m) => m.user_id && !alive.has(m.user_id) && !m.purged_at);
      for (let i = 0; i < emptied.length; i += 100) {
        const ids = emptied.slice(i, i + 100).map((m) => m.id);
        if (!ids.length) continue;
        await svc(env, `/rest/v1/org_members?id=in.${encodeURIComponent(inList(ids))}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ purged_at: new Date(now).toISOString(), status: "purged" }),
        });
      }
    }

    /* Reminders. Keyed on each member's OLDEST surviving photo rather than on a
       stored delivery date: someone who shoots again gets a later deadline and
       is reminded again, automatically, with no extra bookkeeping. An ended
       contract sends none — those photos are already gone. */
    if (!ended && env.RESEND_API_KEY) {
      const alive = await getJson(svc(env, `/rest/v1/headshots?org_id=eq.${encodeURIComponent(org.id)}` +
        `&select=user_id,created_at&order=created_at.asc&limit=5000`)) || [];
      const earliest = new Map();
      for (const h of alive) if (!earliest.has(h.user_id)) earliest.set(h.user_id, h.created_at);

      for (const [uid, created] of earliest) {
        const m = byUser.get(uid);
        if (!m || !m.email) continue;
        const deadline = Date.parse(created) + days * 86400000;
        if (deadline - now > REMIND_BEFORE_DAYS * 86400000) continue;   // not close enough yet
        /* Already told them about this exact deadline. A minute of slack absorbs
           clock skew without ever letting a second email through for one batch. */
        if (m.download_reminded_for && Math.abs(Date.parse(m.download_reminded_for) - deadline) < 60000) continue;
        if (dry) { line.reminded++; continue; }
        const sent = await sendDownloadReminder(env, { from, email: m.email, orgName: org.name, days, deadline });
        if (!sent) continue;
        line.reminded++;
        await svc(env, `/rest/v1/org_members?id=eq.${encodeURIComponent(m.id)}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ download_reminded_for: new Date(deadline).toISOString() }),
        });
      }
    }

    if (line.photos || line.reminded || line.members) report.orgs.push(line);
  }

  // --------------------------------------------------------------- consumer
  /* org_id is null for a consumer shoot, so this can never reach a company's
     photos even if something above went wrong. */
  if (body.consumer !== false && budget > 0) {
    const cutoff = new Date(now - RETENTION_DAYS * 86400000).toISOString();
    const doomed = await getJson(svc(env, `/rest/v1/headshots?org_id=is.null` +
      `&created_at=lt.${encodeURIComponent(cutoff)}&select=id,path,user_id,created_at` +
      `&order=created_at.asc&limit=${budget}`)) || [];
    if (doomed.length >= budget) report.more = true;
    const out = await removePhotos(env, doomed, dry);
    report.consumer = {
      days: RETENTION_DAYS, photos: out.rows, files: out.files,
      customers: new Set(doomed.map((d) => d.user_id)).size,
    };
    if (out.skipped) report.consumer.skipped = out.skipped;
  }

  return Response.json(report, { status: 200, headers });
}
