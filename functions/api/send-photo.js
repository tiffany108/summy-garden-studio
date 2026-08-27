// Summy Garden Studio — email a generated headshot to the signed-in member.
// Env: RESEND_API_KEY (create a free account at resend.com), optional EMAIL_FROM
// (defaults to Resend's onboarding sender, which can only deliver to the
// account owner's own inbox until a domain is verified).
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";


/* ---- Token verification without /auth/v1 ----
   Supabase's /auth/v1/* endpoints do not respond from Cloudflare Workers on this
   project (they hang; /rest/v1 answers in ~20ms). We therefore verify the caller
   through PostgREST, which validates the JWT signature itself — a forged or
   expired token is rejected — and RLS guarantees a user can only read their own
   profile row. Same security guarantee, an endpoint that actually responds. */
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
  return { id: p.sub, email: p.email || "" };
}

export async function onRequest(context) {
  const { request: req, env } = context;
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const rk = env.RESEND_API_KEY;
  if (!rk) return Response.json({ error: "email not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const { token, image, scene, look, variant } = body;
  if (!token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const user = await sbVerify(token);
  if (!user?.email) return Response.json({ error: "invalid session" }, { status: 401, headers });
  if (!image || !image.startsWith("data:image/")) return Response.json({ error: "image required" }, { status: 400, headers });
  if (image.length > 5_000_000) return Response.json({ error: "image too large" }, { status: 413, headers });

  const mime = image.slice(5, image.indexOf(";"));
  const b64 = image.split(",")[1];
  const ext = mime.includes("jpeg") ? "jpg" : "png";
  const from = env.EMAIL_FROM || "Summy Garden Studio <onboarding@resend.dev>";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [user.email],
      subject: `Your Summy Garden Studio headshot${variant != null ? " — variant " + "ABCD"[variant] : ""}`,
      html: `<p>Hi${user.user_metadata?.name ? " " + user.user_metadata.name.split(" ")[0] : ""},</p>
             <p>Your professional headshot is attached${scene ? ` — scene: <b>${String(scene).replace(/</g, "&lt;")}</b>` : ""}${look ? `, look: <b>${String(look).replace(/</g, "&lt;")}</b>` : ""}.</p>
             <p>It's also saved in your dashboard at <a href="https://summygarden.com">Summy Garden Studio</a>.</p>
             <p>— Summy Garden Studio 🌿</p>`,
      attachments: [{ filename: `summy-garden-headshot-${"ABCD"[variant] || "A"}.${ext}`, content: b64 }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json({ error: data?.message || `email failed (${r.status})` }, { status: 502, headers });
  return Response.json({ ok: true, to: user.email }, { status: 200, headers });
}
