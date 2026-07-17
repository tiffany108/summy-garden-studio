// Summy Garden Studio — identity-preserving headshot generation (streaming v2)
// Auth + credits enforced via Supabase. Env: GEMINI_API_KEY, SUPABASE_SECRET_KEY.
const MODEL = "gemini-2.5-flash-image";
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";

const VARIANTS = [
  "natural confident smile, even studio lighting",
  "warm approachable expression, soft window lighting",
  "composed professional expression, crisp editorial lighting",
  "relaxed friendly expression, golden-hour rim light",
];
const OUTFITS = {
  "Business formal": "a tailored dark business suit with a crisp shirt",
  "Smart casual": "a smart-casual blazer over an open-collar shirt",
  "Creative": "a refined black turtleneck",
  "Tech casual": "a clean modern crew-neck or quarter-zip",
  "Sportswear": "clean modern athletic sportswear (polo or performance top)",
  "Uniform": "a smart, well-pressed professional service uniform",
};

async function sbAuthUser(token) {
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return await r.json();
}
async function sbService(path, opts = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  return fetch(`${SB_URL}${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
}

export default async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });

  const gemKey = process.env.GEMINI_API_KEY;
  if (!gemKey) return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 501, headers });
  if (!process.env.SUPABASE_SECRET_KEY) return Response.json({ error: "SUPABASE_SECRET_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const { selfie, scene, category, look, token, scene_id } = body;
  if (!token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const authUser = await sbAuthUser(token);
  if (!authUser?.id) return Response.json({ error: "invalid session" }, { status: 401, headers });
  if (!selfie || !selfie.startsWith("data:image/")) return Response.json({ error: "selfie required" }, { status: 400, headers });
  if (selfie.length > 6_000_000) return Response.json({ error: "image too large" }, { status: 413, headers });

  const vi = Math.min(Math.max(parseInt(body.variant ?? 0, 10) || 0, 0), VARIANTS.length - 1);
  let remaining = null;

  if (vi === 0) {
    // variant 0 spends exactly one credit for the whole 4-variant generation
    const r = await sbService(`/rest/v1/rpc/consume_credit`, { method: "POST", body: JSON.stringify({ uid: authUser.id }) });
    const val = r.ok ? await r.json() : -1;
    if (val === -1 || val === null) return Response.json({ error: "no credits" }, { status: 402, headers });
    remaining = val;
    await sbService(`/rest/v1/generations`, { method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: authUser.id, scene: scene_id || scene || "", look: look || "" }) });
  } else {
    // variants 1-3 ride on a generation started in the last 3 minutes
    const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const q = await sbService(`/rest/v1/generations?user_id=eq.${authUser.id}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`);
    const rows = q.ok ? await q.json() : [];
    if (!rows.length) return Response.json({ error: "no active generation" }, { status: 402, headers });
  }

  const outfit = OUTFITS[look] || OUTFITS["Business formal"];
  const b64 = selfie.split(",")[1];
  const mime = selfie.slice(5, selfie.indexOf(";"));
  const prompt =
    `Transform this photo into a professional corporate headshot of the SAME person — preserve their exact facial identity, features, skin tone and hair. ` +
    `Dress them in ${outfit}. Background: ${scene || "a modern office"} (${category || "professional"} setting), softly blurred with shallow depth of field. ` +
    `Head-and-shoulders framing, ${VARIANTS[vi]}, photorealistic, 85mm portrait lens, high-end corporate photography. ` +
    `Subtle, natural skin retouching only — keep the person recognisable.`;

  try {
    const res = await fetch(`${API}?key=${gemKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
        generationConfig: { imageConfig: { aspectRatio: "3:4" } } }),
    });
    if (!res.ok) { const t = await res.text(); return Response.json({ error: `Gemini ${res.status}: ${t.slice(0, 200)}` }, { status: 502, headers }); }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) return Response.json({ error: "no image in response" }, { status: 502, headers });
    const d = img.inlineData || img.inline_data;
    const payload = JSON.stringify({ image: `data:${d.mimeType || d.mime_type || "image/png"};base64,${d.data}`, variant: vi, remaining, mode: "gemini" });
    const stream = new ReadableStream({ start(c) { const enc = new TextEncoder(); const CH = 65536;
      for (let i = 0; i < payload.length; i += CH) c.enqueue(enc.encode(payload.slice(i, i + CH))); c.close(); } });
    return new Response(stream, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
};
