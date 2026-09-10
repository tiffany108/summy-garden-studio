// Summy Garden Studio — enterprise org portal (phase 2).
// Actions: me | consent | invite
//   me      — the staff studio's bootstrap: which org, which approved scenes,
//             has this person consented yet
//   consent — the member ticks the box themselves; this is the only writer of
//             org_members.consent_at
//   invite  — an org admin adds staff and sends each a magic link
// Env: SUPABASE_SECRET_KEY, RESEND_API_KEY, EMAIL_FROM

/* The short retention window is the enterprise promise, not a preference. HR
   must not be able to quietly turn a fortnight into a year — that is the whole
   reason a company signs this rather than emailing photographs around. Anything
   shorter than the ceiling is fine; longer is refused. */
const MAX_PURGE_DAYS = 14;

const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

/* Token verification without /auth/v1 — same reasoning as checkout.js and
   admin-stats.js: those endpoints hang from Workers on this project, while
   PostgREST validates the JWT signature itself and answers in ~20ms. */
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
  return { id: p.sub, email: (p.email || "").toLowerCase() };
}

const svc = (env, path, opts = {}) => fetch(`${SB_URL}${path}`, {
  ...opts,
  headers: {
    apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json", ...(opts.headers || {}),
  },
});
const getJson = async (r) => (r.ok ? await r.json().catch(() => null) : null);

/* Anything touching /auth/v1 gets a timeout, or a hang becomes a blank 502
   with no explanation — the lesson already recorded in admin-user.js. */
function fetchT(url, opts, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

/* The member row is created by HR before the person has an account, so on the
   first visit it is matched by email and bound to the user id then. The email
   IS the invitation — whoever proves control of it is the invited member. */
async function findMember(env, user) {
  let r = await svc(env, `/rest/v1/org_members?user_id=eq.${encodeURIComponent(user.id)}` +
    `&select=id,org_id,email,name,status,consent_at,staff_ref&limit=1`);
  let rows = await getJson(r);
  if (Array.isArray(rows) && rows.length) return rows[0];
  if (!user.email) return null;
  r = await svc(env, `/rest/v1/org_members?email=eq.${encodeURIComponent(user.email)}` +
    `&user_id=is.null&select=id,org_id,email,name,status,consent_at,staff_ref&limit=1`);
  rows = await getJson(r);
  if (!Array.isArray(rows) || !rows.length) return null;
  const m = rows[0];
  await svc(env, `/rest/v1/org_members?id=eq.${m.id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: user.id }),
  });
  return m;
}

async function isAdminOf(env, userId, orgId) {
  const r = await svc(env, `/rest/v1/org_admins?user_id=eq.${encodeURIComponent(userId)}` +
    (orgId ? `&org_id=eq.${encodeURIComponent(orgId)}` : "") + `&select=org_id&limit=1`);
  const rows = await getJson(r);
  return Array.isArray(rows) && rows.length ? rows[0].org_id : null;
}

/* One sign-in link per invited member. Supabase creates the account with
   type "invite"; someone who already has a consumer account here needs
   "magiclink" instead, so the second attempt covers the returning customer. */
async function signInLink(env, email, redirectTo) {
  for (const type of ["invite", "magiclink"]) {
    const r = await fetchT(`${SB_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type, email, options: { redirect_to: redirectTo } }),
    }).catch((e) => ({ ok: false, _err: e }));
    if (r.ok) {
      const d = await r.json().catch(() => null);
      const link = d?.action_link || d?.properties?.action_link;
      if (link) return { link };
    }
    if (r._err) {
      return { error: r._err.name === "AbortError"
        ? "Supabase did not respond within 12 seconds" : String(r._err.message || r._err) };
    }
  }
  return { error: "could not create a sign-in link" };
}

/* One template for the first invite and for every reminder — a member who gets
   a nudge should not receive something that looks like a different product. */
async function sendInvite(env, { from, email, orgName, link, again }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [email],
      subject: again
        ? `Reminder: your ${orgName} headshot is waiting`
        : `Your ${orgName} headshot — takes about five minutes`,
      html:
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:8px">` +
        `<h2 style="font-size:19px;margin:0 0 12px;color:#0b1f2b">Your ${esc(orgName)} headshot</h2>` +
        `<p style="font-size:14.5px;color:#456;line-height:1.6;margin:0 0 18px">` +
        (again
          ? `Just a reminder — ${esc(orgName)} has arranged a professional headshot for you and yours is not done yet. `
          : `${esc(orgName)} is arranging professional headshots. `) +
        `Upload a photo of yourself and you will get a set back in a few minutes — no studio, no appointment.</p>` +
        `<p style="margin:0 0 20px"><a href="${esc(link)}" ` +
        `style="display:inline-block;background:#0284c7;color:#fff;text-decoration:none;font-weight:700;` +
        `font-size:15px;border-radius:10px;padding:13px 22px">Take my headshot</a></p>` +
        `<p style="font-size:12.5px;color:#5c7688;line-height:1.6;margin:0">` +
        `The link signs you in — there is no password to create. You choose your own photo, ` +
        `and you will be asked to agree before anything is generated.</p></div>`,
    }),
  }).catch(() => null);
  return !!(r && r.ok);
}

export async function onRequest(context) {
  const { request: req, env } = context;
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  if (!env.SUPABASE_SECRET_KEY) return Response.json({ error: "SUPABASE_SECRET_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const user = await sbVerify(body.token);
  if (!user) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const action = body.action || "me";

  // ---------------------------------------------------------------- me
  if (action === "me") {
    const member = await findMember(env, user);
    if (!member) return Response.json({ org: null }, { status: 200, headers });

    const o = await getJson(await svc(env, `/rest/v1/organisations?id=eq.${member.org_id}` +
      `&select=id,name,slug,status,bg_policy,logo_path,purge_days&limit=1`));
    const org = Array.isArray(o) && o.length ? o[0] : null;
    if (!org) return Response.json({ org: null }, { status: 200, headers });

    const bg = await getJson(await svc(env, `/rest/v1/org_backgrounds?org_id=eq.${org.id}` +
      `${SCENE_SELECT}`)) || [];

    return Response.json({
      // purge_days goes to the browser so the consent notice can state the real
      // window rather than a number hard-coded in the page.
      org: { name: org.name, slug: org.slug, status: org.status, bg_policy: org.bg_policy, logo: org.logo_path, purge_days: org.purge_days },
      member: { name: member.name, status: member.status, consented: !!member.consent_at },
      /* Whole scenes now, not bare ids: a company-specific background carries
         its own name, description and colours, and the studio has no other
         source for those. Library scenes come back with an empty prompt and are
         still matched against the built-in library by id, exactly as before. */
      scenes: bg.map(publicScene),
      primary: (bg.find((b) => b.is_primary) || {}).scene_id || null,
    }, { status: 200, headers });
  }

  // ----------------------------------------------------------- consent
  /* The member's own act, and the only place consent_at is written. An admin
     cannot set it for someone else — there is no code path that would let them,
     which is the point. */
  if (action === "consent") {
    if (body.agree !== true) return Response.json({ error: "consent not given" }, { status: 400, headers });
    const member = await findMember(env, user);
    if (!member) return Response.json({ error: "not an invited member" }, { status: 403, headers });
    if (member.consent_at) return Response.json({ ok: true, already: true }, { status: 200, headers });

    const r = await svc(env, `/rest/v1/org_members?id=eq.${member.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ consent_at: new Date().toISOString(), status: "consented", user_id: user.id }),
    });
    if (!r.ok) return Response.json({ error: "could not record consent" }, { status: 502, headers });
    return Response.json({ ok: true }, { status: 200, headers });
  }

  // ------------------------------------------------------------ invite
  if (action === "invite") {
    const orgId = await isAdminOf(env, user.id, body.org_id);
    if (!orgId) return Response.json({ error: "not an administrator" }, { status: 403, headers });
    if (!env.RESEND_API_KEY) return Response.json({ error: "RESEND_API_KEY not configured" }, { status: 501, headers });

    const list = Array.isArray(body.invites) ? body.invites.slice(0, 200) : [];
    if (!list.length) return Response.json({ error: "no invites given" }, { status: 400, headers });

    const o = await getJson(await svc(env, `/rest/v1/organisations?id=eq.${orgId}&select=name,slug,seats&limit=1`));
    const org = Array.isArray(o) && o.length ? o[0] : null;
    if (!org) return Response.json({ error: "organisation not found" }, { status: 404, headers });

    /* Seats are what the company bought. Refusing here rather than at billing
       time means HR finds out while they can still do something about it. */
    const c = await svc(env, `/rest/v1/org_members?org_id=eq.${orgId}&select=id`, { headers: { Prefer: "count=exact" } });
    const used = Number((c.headers.get("content-range") || "0/0").split("/")[1]) || 0;
    if (org.seats && used + list.length > org.seats) {
      return Response.json({ error: `that would use ${used + list.length} of ${org.seats} seats` }, { status: 409, headers });
    }

    const origin = req.headers.get("origin") || "https://summygarden.com";
    const redirectTo = `${origin}/?team=${encodeURIComponent(org.slug)}`;
    const from = env.EMAIL_FROM || "Summy Garden Studio <onboarding@resend.dev>";
    const out = [];

    for (const raw of list) {
      const email = String(raw?.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { out.push({ email, ok: false, error: "invalid email" }); continue; }

      // Upsert the seat first: if the email later bounces, HR can still see the
      // row and correct the address rather than wondering what happened.
      const up = await svc(env, `/rest/v1/org_members?on_conflict=org_id,email`, {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          org_id: orgId, email,
          name: String(raw?.name || "").slice(0, 120),
          staff_ref: String(raw?.staff_ref || "").slice(0, 60),
          department: String(raw?.department || "").slice(0, 120),
        }),
      });
      if (!up.ok) { out.push({ email, ok: false, error: "could not create the seat" }); continue; }

      const link = await signInLink(env, email, redirectTo);
      if (link.error) { out.push({ email, ok: false, error: link.error }); continue; }

      const mail = await sendInvite(env, { from, email, orgName: org.name, link: link.link, again: false });
      out.push({ email, ok: mail, error: mail ? undefined : "email could not be sent" });
    }

    return Response.json({ invited: out.filter((x) => x.ok).length, results: out }, { status: 200, headers });
  }

  // ------------------------------------------------------------- admin
  /* Everything the HR console needs in one round trip: the organisation, its
     settings, the approved backgrounds and the whole roster. The roster IS the
     console, so splitting it across calls would only add latency. */
  if (action === "admin") {
    const orgId = await isAdminOf(env, user.id, body.org_id);
    if (!orgId) return Response.json({ error: "not an administrator" }, { status: 403, headers });

    const o = await getJson(await svc(env, `/rest/v1/organisations?id=eq.${orgId}` +
      `&select=id,name,slug,status,seats,purge_days,bg_policy,daily_shoot_cap,logo_path&limit=1`));
    const org = Array.isArray(o) && o.length ? o[0] : null;
    if (!org) return Response.json({ error: "organisation not found" }, { status: 404, headers });

    const members = await getJson(await svc(env, `/rest/v1/org_members?org_id=eq.${orgId}` +
      `&select=id,email,name,staff_ref,department,status,consent_at,invited_at,reminded_at,delivered_at` +
      `&order=invited_at.desc&limit=1000`)) || [];
    const bg = await getJson(await svc(env, `/rest/v1/org_backgrounds?org_id=eq.${orgId}` +
      `${SCENE_SELECT}`)) || [];

    const counts = {};
    for (const m of members) counts[m.status] = (counts[m.status] || 0) + 1;

    return Response.json({ org, members, backgrounds: bg, counts }, { status: 200, headers });
  }

  // ------------------------------------------------------------ remind
  /* Re-sends the same email with a fresh sign-in link. The old link is not
     revoked — someone who finally digs the first mail out of their spam folder
     should not find it dead. */
  if (action === "remind") {
    const orgId = await isAdminOf(env, user.id, body.org_id);
    if (!orgId) return Response.json({ error: "not an administrator" }, { status: 403, headers });
    if (!env.RESEND_API_KEY) return Response.json({ error: "RESEND_API_KEY not configured" }, { status: 501, headers });

    const ids = Array.isArray(body.member_ids) ? body.member_ids.slice(0, 200) : [];
    if (!ids.length) return Response.json({ error: "nobody selected" }, { status: 400, headers });

    const inList = "(" + ids.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",") + ")";
    const rows = await getJson(await svc(env,
      `/rest/v1/org_members?org_id=eq.${orgId}&id=in.${encodeURIComponent(inList)}` +
      `&select=id,email,status`)) || [];

    const o = await getJson(await svc(env, `/rest/v1/organisations?id=eq.${orgId}&select=name,slug&limit=1`));
    const org = Array.isArray(o) && o.length ? o[0] : null;
    if (!org) return Response.json({ error: "organisation not found" }, { status: 404, headers });

    const origin = req.headers.get("origin") || "https://summygarden.com";
    const redirectTo = `${origin}/?team=${encodeURIComponent(org.slug)}`;
    const from = env.EMAIL_FROM || "Summy Garden Studio <onboarding@resend.dev>";
    let sent = 0;

    for (const m of rows) {
      // Someone who has already finished does not need chasing.
      if (m.status === "delivered" || m.status === "complete" || m.status === "purged") continue;
      const link = await signInLink(env, m.email, redirectTo);
      if (link.error) continue;
      if (await sendInvite(env, { from, email: m.email, orgName: org.name, link: link.link, again: true })) {
        sent++;
        await svc(env, `/rest/v1/org_members?id=eq.${m.id}`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ reminded_at: new Date().toISOString() }),
        });
      }
    }
    return Response.json({ reminded: sent }, { status: 200, headers });
  }

  // ---------------------------------------------------------- settings
  if (action === "settings") {
    const orgId = await isAdminOf(env, user.id, body.org_id);
    if (!orgId) return Response.json({ error: "not an administrator" }, { status: 403, headers });

    const patch = {};
    if (body.bg_policy === "choice" || body.bg_policy === "primary_locked") patch.bg_policy = body.bg_policy;
    if (Number.isFinite(Number(body.purge_days))) {
      // Zero would mean "delete immediately", which no warning email could ever
      // reach in time. One day is the floor, MAX_PURGE_DAYS the ceiling. Both
      // are enforced here and not only in the browser, because the number field
      // in the console can be edited by anyone who opens dev tools.
      const want = Math.round(Number(body.purge_days));
      if (want > MAX_PURGE_DAYS) {
        return Response.json(
          { error: `photos cannot be kept longer than ${MAX_PURGE_DAYS} days`, max_purge_days: MAX_PURGE_DAYS },
          { status: 400, headers });
      }
      patch.purge_days = Math.max(1, want);
    }
    if (Object.keys(patch).length) {
      const r = await svc(env, `/rest/v1/organisations?id=eq.${orgId}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
      });
      if (!r.ok) return Response.json({ error: "could not save settings" }, { status: 502, headers });
    }

    /* Backgrounds are replaced wholesale rather than diffed: the console always
       sends the full approved list, and a half-applied diff would leave staff
       able to shoot a scene HR had just removed. */
    if (Array.isArray(body.scenes)) {
      let refused = null;
      const clean = body.scenes
        .map((x, i) => {
          const prompt = cleanPrompt(x?.prompt);
          if (prompt === REFUSED) { refused = String(x?.name || x?.scene_id || ""); return null; }
          return {
            org_id: orgId,
            scene_id: String(x?.scene_id || "").slice(0, 120),
            is_primary: !!x?.is_primary,
            sort: Number.isFinite(Number(x?.sort)) ? Number(x.sort) : i,
            name: String(x?.name || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60),
            prompt,
            art: ART.has(String(x?.art)) ? String(x.art) : "office",
            colors: cleanColors(x?.colors),
          };
        })
        .filter((x) => x && x.scene_id);
      if (refused) {
        return Response.json({
          error: `That background description cannot be used as written. Describe only the setting — the room, the light, the colours — and leave the person out of it.`,
          scene: refused,
        }, { status: 400, headers });
      }
      if (clean.filter((x) => x.is_primary).length > 1) {
        return Response.json({ error: "only one background can be the primary" }, { status: 400, headers });
      }
      await svc(env, `/rest/v1/org_backgrounds?org_id=eq.${orgId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      if (clean.length) {
        const r = await svc(env, `/rest/v1/org_backgrounds`, {
          method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(clean),
        });
        if (!r.ok) return Response.json({ error: "could not save the background list" }, { status: 502, headers });
      }
    }
    return Response.json({ ok: true }, { status: 200, headers });
  }

  return Response.json({ error: "unknown action" }, { status: 400, headers });
}

const SCENE_SELECT = "&select=scene_id,is_primary,sort,name,prompt,art,colors&order=sort.asc";

/* The swatch drawings the studio can render a preview with. Anything else is
   coerced to 'office' rather than passed through to the page. */
const ART = new Set(["office", "bizpark", "street", "park", "lake", "tennis", "cafe", "campus", "studio"]);

const publicScene = (b) => ({
  scene_id: b.scene_id,
  is_primary: !!b.is_primary,
  name: b.name || "",
  prompt: b.prompt || "",
  art: b.art || "office",
  colors: Array.isArray(b.colors) ? b.colors : [],
});

const REFUSED = Symbol("refused");

/* A custom description is written by a company's HR administrator and ends up
   inside the prompt that re-photographs an EMPLOYEE'S FACE. That is a different
   trust boundary from an admin picking a scene off a list, so the text is kept
   to what it is for: a description of a place.
   
   This narrows the opening; it does not close it. A determined administrator
   can still write something odd about a room. The real controls remain the
   IDENTITY LOCK block in generate.js, the fact that staff consent for
   themselves, and the audit trail — not this regex. */
const BLOCKED = /\b(ignore|disregard|instead|override|overrides|instruction|instructions|prompt|system|you must|person|people|man|woman|child|children|body|bodies|face|faces|skin|nude|naked|undress|underwear|lingerie|bikini|swimsuit)\b/i;

function cleanPrompt(v) {
  const t = String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!t) return "";
  if (t.length > 300) return REFUSED;
  if (BLOCKED.test(t)) return REFUSED;
  return t;
}

const HEX = /^#[0-9a-f]{6}$/i;
const cleanColors = (v) =>
  (Array.isArray(v) ? v : []).filter((c) => typeof c === "string" && HEX.test(c)).slice(0, 4);

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
