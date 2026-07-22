let env;
// Summy Garden Studio — customer face-swap (Segmind Faceswap v5).
// Places the customer's own face onto a chosen gallery scene sample (pure swap,
// no prompt — the proven recipe). Body: { token, source_b64 (customer face, raw
// base64 or data URL), target_i (scene sample index) }. Returns swapped image
// bytes (image/*), or a JSON error. Any signed-in user may call it.
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const SAMPLE_ORIGIN = "https://summy-garden-studio.pages.dev";

const handler = async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  let stage = "start";
  try {
    const key = (env.SEGMIND_API_KEY || "").trim();
    if (!key) return Response.json({ error: "face-swap not configured" }, { status: 501, headers });
    stage = "auth";

    let body = {}; try { body = await req.json(); } catch {}
    if (!body.token) return Response.json({ error: "sign in required" }, { status: 401, headers });
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${body.token}` } });
    const caller = u.ok ? await u.json() : null;
    if (!caller?.email) return Response.json({ error: "sign in required" }, { status: 401, headers });

    const src = String(body.source_b64 || "");
    if (src.length < 200) return Response.json({ error: "no source photo" }, { status: 400, headers });
    const ti = parseInt(body.target_i, 10);
    if (!Number.isInteger(ti) || ti < 0) return Response.json({ error: "no scene selected" }, { status: 400, headers });
    const target = `${SAMPLE_ORIGIN}/api/sample?kind=p&i=${ti}`;

    // Pure swap — NO additional_prompt (every prompt broke the likeness; the bare swap is the proven recipe).
    const payload = { source_image: src, target_image: target, image_format: "jpeg", quality: 95 };
    stage = "segmind";
    const r = await fetch("https://api.segmind.com/v1/faceswap-v5", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    stage = "read";
    const ct = r.headers.get("content-type") || "";
    if (r.ok && ct.startsWith("image/")) {
      const ab = await r.arrayBuffer();
      return new Response(ab, { status: 200, headers: { ...headers, "Content-Type": ct, "Cache-Control": "no-store" } });
    }
    const txt = await r.text().catch(() => "");
    return Response.json({ error: `swap failed (${r.status})`, detail: txt.slice(0, 300) }, { status: r.ok ? 200 : 502, headers });
  } catch (e) {
    return Response.json({ error: `crash at ${stage}: ${String(e?.message || e).slice(0, 300)}` }, { status: 500, headers });
  }
};

export async function onRequest(context) { env = context.env; return handler(context.request); }
