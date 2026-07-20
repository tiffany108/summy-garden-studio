// Summy Garden Studio — email a generated headshot to the signed-in member.
// Env: RESEND_API_KEY (create a free account at resend.com), optional EMAIL_FROM
// (defaults to Resend's onboarding sender, which can only deliver to the
// account owner's own inbox until a domain is verified).
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

export default async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const rk = process.env.RESEND_API_KEY;
  if (!rk) return Response.json({ error: "email not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const { token, image, scene, look, variant } = body;
  if (!token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } });
  const user = u.ok ? await u.json() : null;
  if (!user?.email) return Response.json({ error: "invalid session" }, { status: 401, headers });
  if (!image || !image.startsWith("data:image/")) return Response.json({ error: "image required" }, { status: 400, headers });
  if (image.length > 5_000_000) return Response.json({ error: "image too large" }, { status: 413, headers });

  const mime = image.slice(5, image.indexOf(";"));
  const b64 = image.split(",")[1];
  const ext = mime.includes("jpeg") ? "jpg" : "png";
  const from = process.env.EMAIL_FROM || "Summy Garden Studio <onboarding@resend.dev>";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [user.email],
      subject: `Your Summy Garden Studio headshot${variant != null ? " — variant " + "ABCD"[variant] : ""}`,
      html: `<p>Hi${user.user_metadata?.name ? " " + user.user_metadata.name.split(" ")[0] : ""},</p>
             <p>Your professional headshot is attached${scene ? ` — scene: <b>${String(scene).replace(/</g, "&lt;")}</b>` : ""}${look ? `, look: <b>${String(look).replace(/</g, "&lt;")}</b>` : ""}.</p>
             <p>It's also saved in your dashboard at <a href="https://summy-garden-studio.netlify.app">Summy Garden Studio</a>.</p>
             <p>— Summy Garden Studio 🌿</p>`,
      attachments: [{ filename: `summy-garden-headshot-${"ABCD"[variant] || "A"}.${ext}`, content: b64 }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json({ error: data?.message || `email failed (${r.status})` }, { status: 502, headers });
  return Response.json({ ok: true, to: user.email }, { status: 200, headers });
};
