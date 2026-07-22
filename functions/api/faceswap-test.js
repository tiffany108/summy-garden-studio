let env;
// Summy Garden Studio — admin-only face/head-swap PROOF endpoint (Segmind Faceswap v5).
// Body: { token, source_b64 (customer face, raw base64 or data URL), target_i (gallery
// sample index) OR target_url, quality?, additional_prompt? }
// Returns the swapped image bytes (image/*), or JSON error.
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";

const handler = async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });

  const key = (env.SEGMIND_API_KEY || "").trim();
  if (!key) return Response.json({ error: "SEGMIND_API_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  if (!body.token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${body.token}` } });
  const caller = u.ok ? await u.json() : null;
  if (!caller?.email || caller.email !== ADMIN_EMAIL) return Response.json({ error: "admin only" }, { status: 403, headers });

  const src = String(body.source_b64 || "");
  if (src.length < 200) return Response.json({ error: "source_b64 required" }, { status: 400, headers });

  const ti = parseInt(body.target_i, 10);
  const targetUrl = body.target_url ||
    `https://summy-garden-studio.pages.dev/api/sample?kind=p&i=${Number.isInteger(ti) ? ti : 30}`;

  const payload = {
    source_image: src,           // customer's face (base64 or data URL)
    target_image: targetUrl,     // gallery model photo (public URL, Segmind fetches it)
    image_format: "jpeg",
    quality: Math.min(100, Math.max(10, parseInt(body.quality, 10) || 95)),
  };
  if (typeof body.additional_prompt === "string" && body.additional_prompt) payload.additional_prompt = body.additional_prompt.slice(0, 300);

  let r;
  try {
    r = await fetch("https://api.segmind.com/v1/faceswap-v5", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return Response.json({ error: "segmind request failed: " + String(e?.message || e) }, { status: 502, headers });
  }

  const ct = r.headers.get("content-type") || "";
  if (r.ok && ct.startsWith("image/")) {
    const ab = await r.arrayBuffer();
    return new Response(ab, { status: 200, headers: { ...headers, "Content-Type": ct, "Cache-Control": "no-store" } });
  }
  // error or JSON body — surface it for debugging
  const txt = await r.text().catch(() => "");
  return Response.json({ error: `Segmind ${r.status}`, detail: txt.slice(0, 600), ct }, { status: r.ok ? 200 : 502, headers });
};

export async function onRequest(context) { env = context.env; return handler(context.request); }
