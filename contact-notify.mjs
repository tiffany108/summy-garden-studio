// Summy Garden Studio — forward each Contact-us message to the studio mailbox.
// Env: RESEND_API_KEY (required), CONTACT_NOTIFY_TO (optional, defaults below),
// EMAIL_FROM (optional). Reply-To is the visitor, so replying reaches them directly.
const NOTIFY_TO = process.env.CONTACT_NOTIFY_TO || "gogonewnews@gmail.com";

export default async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const rk = process.env.RESEND_API_KEY;
  if (!rk) return Response.json({ error: "email not configured" }, { status: 501, headers });

  // stopgap anti-abuse: only accept requests from our own site (browser-enforced).
  // Proper defence (Cloudflare Turnstile + rate limiting) is added during the CF migration.
  const origin = req.headers.get("origin") || "";
  const ALLOWED = ["https://summy-garden-studio.netlify.app"];
  const okOrigin = !origin || ALLOWED.some(a => origin === a) || origin.endsWith(".summygarden.com") || origin.endsWith(".summygarden.app") || origin.endsWith(".pages.dev");
  if (!okOrigin) return Response.json({ error: "forbidden" }, { status: 403, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const name = String(body.name || "").slice(0, 120);
  const email = String(body.email || "").slice(0, 200);
  const topic = String(body.topic || "Other").slice(0, 40);
  const message = String(body.message || "").slice(0, 5000);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !message.trim()) return Response.json({ error: "invalid" }, { status: 400, headers });
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Summy Garden Studio <onboarding@resend.dev>",
      to: [NOTIFY_TO],
      reply_to: email,
      subject: `[${topic}] New message from ${name || email}`,
      html: `<h3>New Contact-us message</h3>
             <p><b>Topic:</b> ${esc(topic)}<br><b>Name:</b> ${esc(name) || "—"}<br><b>Email:</b> ${esc(email)}</p>
             <p style="white-space:pre-wrap;border-left:3px solid #38bdf8;padding-left:12px">${esc(message)}</p>
             <p style="color:#888;font-size:12px">Reply to this email to answer the visitor directly. Full inbox: your admin page → Contact messages.</p>`,
    }),
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); return Response.json({ error: d?.message || "send failed" }, { status: 502, headers }); }
  return Response.json({ ok: true }, { status: 200, headers });
};
