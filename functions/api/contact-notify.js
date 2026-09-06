// Summy Garden Studio — forward each Contact-us message to the studio mailbox,
// and send the sender an acknowledgement so they know it arrived.
//
// Env: RESEND_API_KEY (required), CONTACT_NOTIFY_TO (optional, defaults below),
// EMAIL_FROM (optional). Reply-To is the visitor, so replying reaches them directly.
//
// WHY THE ACKNOWLEDGEMENT CONTAINS NONE OF THEIR MESSAGE.
// This endpoint is public and unauthenticated, and it now sends mail to an
// address the caller supplies. Echoing the submitted text back would turn it
// into an open relay: anyone could deliver arbitrary content to arbitrary
// inboxes, from our verified domain, and burn the domain's sending reputation
// in an afternoon. So the acknowledgement is fixed copy plus their own name.
// Nothing the caller wrote is ever quoted back to them.

// Every outbound call is bounded. An unbounded fetch here is what made the MFA
// email fail as a 6.4KB Cloudflare HTML 502 that swallowed the real error.
function fetchT(url, opts, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

/* Cloudflare Turnstile. This endpoint sends email to an address the caller
   supplies, which makes it worth abusing: a script could empty the Resend quota
   in minutes and fill the inbox with noise.

   FAIL CLOSED WHEN CONFIGURED, OPEN WHEN NOT. If TURNSTILE_SECRET_KEY is set,
   a request without a valid token is refused. If the variable is missing the
   check is skipped, so deploying this file before setting the secret does not
   take the contact form down — the two do not have to happen in the same
   minute. Once the variable is set, the gate is real. */
async function turnstileOk(env, token, ip) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, why: "no token" };
  try {
    const body = new URLSearchParams({ secret, response: String(token).slice(0, 2048) });
    if (ip) body.set("remoteip", ip);
    const r = await fetchT("https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body }, 8000);
    if (!r.ok) return { ok: false, why: `siteverify http ${r.status}` };
    const j = await r.json().catch(() => ({}));
    return j.success ? { ok: true } : { ok: false, why: (j["error-codes"] || []).join(",") || "rejected" };
  } catch (e) {
    /* A verification service that cannot be reached must not become an open
       door. Refusing is the safe side of this decision: the visitor is told to
       try again, rather than the endpoint quietly becoming unguarded. */
    return { ok: false, why: e?.name === "AbortError" ? "siteverify timed out" : String(e?.message || e) };
  }
}

/* Rate limit, per sender IP.

   Turnstile proves a person is present. It does not stop a real person — or a
   browser farm that solves challenges — from sending a hundred messages in an
   afternoon. These two windows are the backstop: a burst limit that catches a
   script, and a daily limit that caps what any single source can cost in a day.

   Storage is the KV namespace already bound for the gallery cache, under its
   own key prefix. A separate namespace would be tidier; sharing one avoids
   asking you to create and bind a second before this works.

   FAILS OPEN. If KV is unavailable the message goes through. Rate limiting is
   cost control, not the security boundary — Turnstile is — and silently
   swallowing a customer's genuine enquiry because a cache was briefly down is
   the worse of the two failures. */
const RATE = [
  { window: 600, max: 3, label: "10 minutes" },   // burst
  { window: 86400, max: 12, label: "24 hours" },  // sustained
];

async function rateLimit(env, ip) {
  const kv = env.SCENE_CACHE;
  if (!kv || !ip) return { ok: true };
  const now = Math.floor(Date.now() / 1000);
  try {
    for (const r of RATE) {
      // One key per IP per window-slot, expiring by itself — no cleanup needed.
      const slot = Math.floor(now / r.window);
      const key = `rl:cn:${r.window}:${slot}:${ip}`;
      const n = parseInt((await kv.get(key)) || "0", 10) || 0;
      if (n >= r.max) return { ok: false, retryAfter: (slot + 1) * r.window - now, label: r.label };
      // expirationTtl covers the rest of this slot, plus a little slack.
      await kv.put(key, String(n + 1), { expirationTtl: r.window + 60 });
    }
    return { ok: true };
  } catch (e) {
    return { ok: true, degraded: String(e?.message || e) };
  }
}

const send = (rk, payload) =>
  fetchT("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export async function onRequest(context) {
  const { request: req, env } = context;
  const NOTIFY_TO = env.CONTACT_NOTIFY_TO || "tiffany123@hotmail.com.hk";
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const rk = env.RESEND_API_KEY;
  if (!rk) return Response.json({ error: "email not configured" }, { status: 501, headers });

  // stopgap anti-abuse: only accept requests from our own site (browser-enforced).
  // Proper defence (Cloudflare Turnstile + rate limiting) is added during the CF migration.
  const origin = req.headers.get("origin") || "";
  const ALLOWED = ["https://summygarden.com", "https://www.summygarden.com", "https://summy-garden-studio.netlify.app"];
  const okOrigin = !origin || ALLOWED.some(a => origin === a) || origin.endsWith(".summygarden.com") || origin.endsWith(".summygarden.app") || origin.endsWith(".pages.dev");
  if (!okOrigin) return Response.json({ error: "forbidden" }, { status: 403, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const name = String(body.name || "").slice(0, 120);
  const email = String(body.email || "").slice(0, 200);
  const topic = String(body.topic || "Other").slice(0, 40);
  const message = String(body.message || "").slice(0, 5000);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !message.trim()) return Response.json({ error: "invalid" }, { status: 400, headers });

  const ip = req.headers.get("CF-Connecting-IP") || "";

  /* Rate limit BEFORE Turnstile. Verifying a token is an outbound request to
     Cloudflare; refusing a flood without making one keeps an attacker from
     spending our time as well as their own. */
  const rl = await rateLimit(env, ip);
  if (!rl.ok) {
    return Response.json({
      error: `You have sent several messages already. Please try again later, or email admin@summygarden.com directly.`,
      retryAfter: rl.retryAfter,
    }, { status: 429, headers: { ...headers, "Retry-After": String(rl.retryAfter || 600) } });
  }

  // Checked after the cheap validation and before anything is sent.
  const ts = await turnstileOk(env, body.cf, ip);
  if (!ts.ok) {
    return Response.json({
      error: "We could not verify that this came from a person. Please reload the page and try again.",
      turnstile: ts.why,
    }, { status: 403, headers });
  }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // summygarden.com is a VERIFIED domain in Resend, so it can send to any
  // recipient. The old default, onboarding@resend.dev, is Resend's shared test
  // sender and may ONLY deliver to the Resend account owner - every send to any
  // other address comes back 403. EMAIL_FROM still overrides this.
  const FROM = env.EMAIL_FROM || "Summy Garden Studio <no-reply@summygarden.com>";
  const isJoin = /^join us/i.test(topic);
  const role = /salesperson/i.test(topic) ? "salesperson" : "partner";

  /* A throw here — DNS failure, abort on timeout — must not escape. An uncaught
     exception in a Pages Function is returned as a Cloudflare HTML error page,
     which the caller cannot parse and which hides the real cause. Same trap as
     the MFA email. */
  let r;
  try {
    r = await send(rk, {
      from: FROM,
      to: [NOTIFY_TO],
      reply_to: email,
      subject: isJoin
        ? `[Partner application] ${name || email} — ${role}`
        : `[${topic}] New message from ${name || email}`,
      html: `<h3>${isJoin ? "New partner application" : "New Contact-us message"}</h3>
             <p><b>Topic:</b> ${esc(topic)}<br><b>Name:</b> ${esc(name) || "—"}<br><b>Email:</b> ${esc(email)}</p>
             <p style="white-space:pre-wrap;border-left:3px solid #38bdf8;padding-left:12px">${esc(message)}</p>
             <p style="color:#888;font-size:12px">Reply to this email to answer them directly. Full inbox: your admin page → Contact messages.</p>`,
    });
  } catch (e) {
    const why = e?.name === "AbortError" ? "email provider timed out" : String(e?.message || e);
    return Response.json({ error: why }, { status: 502, headers });
  }
  if (!r.ok) { const d = await r.json().catch(() => ({})); return Response.json({ error: d?.message || "send failed" }, { status: 502, headers }); }

  /* The acknowledgement is best-effort and deliberately second. If it fails, the
     lead has still reached Tiffany and the visitor has still seen the on-screen
     confirmation — reporting an error here would be a lie about what happened. */
  let acked = false;
  try {
    const hi = name ? `Hi ${esc(name.split(/\s+/)[0])},` : "Hello,";
    const ack = isJoin
      ? { subject: "We have your application — Summy Garden Studio",
          body: `<p>${hi}</p>
             <p>Thank you for applying to the Summy Garden Studio ${role} programme. Your application has arrived and a real person will read it.</p>
             <p><b>What happens next.</b> We reply by email, usually within 1–2 working days. If we go ahead, we will agree your code and your commission rate, then ask you to create an ordinary account on summygarden.com — that same login opens your partner portal.</p>
             <p style="background:#eef8f1;border-left:3px solid #178a52;padding:12px 14px;border-radius:6px">
               <b>We will never ask for your bank details by email.</b> You will enter them yourself, inside your own portal, once you are approved. If anyone emails or messages you asking for your account number on our behalf, it is not us — whatever the address says.</p>
             <p>If you did not apply to us, you can ignore this message; nothing further will happen.</p>
             <p style="color:#888;font-size:12px">Summy Garden Studio · summygarden.com<br>This mailbox is not monitored — reply to our next email instead.</p>` }
      : { subject: "We received your message — Summy Garden Studio",
          body: `<p>${hi}</p>
             <p>Thank you for getting in touch. Your message has arrived and we reply by email, usually within 1–2 working days.</p>
             <p>If you did not contact us, you can ignore this message.</p>
             <p style="color:#888;font-size:12px">Summy Garden Studio · summygarden.com<br>This mailbox is not monitored — reply to our next email instead.</p>` };
    const a = await send(rk, { from: FROM, to: [email], reply_to: NOTIFY_TO, subject: ack.subject, html: ack.body });
    acked = a.ok;
  } catch { /* the lead is safe; the courtesy note is not worth failing over */ }

  return Response.json({ ok: true, acked }, { status: 200, headers });
}
