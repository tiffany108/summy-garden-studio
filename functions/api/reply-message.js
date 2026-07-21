let env;
// Summy Garden Studio — reply to a contact message from support@summygarden.com.
// Admin-only. Sends via Resend (env RESEND_API_KEY); supports attachments.
// Body: { token, message_id, to, subject, body, attachments:[{filename, type, content(base64)}] }
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";
const FROM = "Summy Garden Studio <support@summygarden.com>";
const MAX_ATTACH_BYTES = 15 * 1024 * 1024; // 15MB total (Resend caps emails at 40MB)

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const handler = async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const rk = (env.RESEND_API_KEY || "").trim();
  if (!rk) return Response.json({ error: "Email sending is not configured yet — finish the Resend setup first (RESEND_API_KEY)." }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  if (!body.token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${body.token}` } });
  const caller = u.ok ? await u.json() : null;
  if (!caller?.email || caller.email !== ADMIN_EMAIL) return Response.json({ error: "admin only" }, { status: 403, headers });

  const to = String(body.to || "").trim();
  const subject = String(body.subject || "").trim() || "Re: Summy Garden Studio";
  const text = String(body.body || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return Response.json({ error: "invalid recipient email" }, { status: 400, headers });
  if (!text) return Response.json({ error: "reply message is empty" }, { status: 400, headers });

  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : [];
  let total = 0;
  for (const a of attachments) {
    if (!a || typeof a.filename !== "string" || typeof a.content !== "string") return Response.json({ error: "bad attachment" }, { status: 400, headers });
    total += Math.floor(a.content.length * 3 / 4);
  }
  if (total > MAX_ATTACH_BYTES) return Response.json({ error: "attachments too large — keep the total under 15MB" }, { status: 400, headers });

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#12313f">
    <p style="white-space:pre-wrap;margin:0 0 22px">${esc(text)}</p>
    <p style="margin:0;color:#5b7684">— Summy Garden Studio 夏園工作室<br>
    <a href="https://summygarden.com" style="color:#0284c7">summygarden.com</a></p></div>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM, to: [to], reply_to: "support@summygarden.com",
      subject, text, html,
      attachments: attachments.map(a => ({ filename: a.filename, content: a.content })),
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json({ error: "send failed: " + (d?.message || r.status) }, { status: 502, headers });

  // best-effort: mark the message as replied (needs SUPABASE_SECRET_KEY; ignore failures)
  const sbKey = (env.SUPABASE_SECRET_KEY || "").trim();
  if (sbKey && body.message_id) {
    await fetch(`${SB_URL}/rest/v1/contact_messages?id=eq.${encodeURIComponent(body.message_id)}`, {
      method: "PATCH",
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ replied_at: new Date().toISOString(), reply_text: text.slice(0, 4000) }),
    }).catch(() => {});
  }
  return Response.json({ ok: true, id: d?.id || null }, { status: 200, headers });
};

export async function onRequest(context) { env = context.env; return handler(context.request); }
