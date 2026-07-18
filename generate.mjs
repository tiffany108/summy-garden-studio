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
  "Auto": "professional attire that best suits the chosen style",
  "Original": "the same clothing they are wearing in the photo, tidied and professional",
  "Navy suit": "a tailored navy business suit with a crisp white shirt",
  "Charcoal suit": "a tailored charcoal-grey business suit with a shirt",
  "Light blazer": "a light beige/cream smart blazer over an open-collar shirt",
  "Black turtleneck": "a refined black turtleneck",
  "White shirt": "a clean pressed white collared shirt",
  "Blouse": "an elegant professional blouse",
  "Sportswear": "clean modern athletic sportswear (polo or performance top)",
  "Uniform": "a smart, well-pressed professional service uniform",
};
const STYLES = {
  "Formal": "formal professional headshot style, polished and corporate",
  "Studio": "clean studio-portrait style on a neutral seamless background",
  "Corporate": "corporate style, balanced neutral colour grade, trustworthy",
  "Office": "modern office style with a softly blurred workplace behind",
  "Casual": "relaxed smart-casual style, approachable and warm",
  "Natural": "natural, true-to-life style with soft daylight",
  "Creative": "creative style with richer colour and characterful mood",
  "Fashion": "fashion-editorial style, stylish and contemporary",
  "Street": "urban street style with a soft city backdrop",
  "Luxury": "premium luxury style, refined and elegant",
  "Editorial": "editorial magazine style, crisp high-contrast grade",
  "Vintage": "subtle warm vintage film style",
};
const POSES = {
  "Straight on": "facing the camera straight on",
  "Slight angle": "body turned at a slight angle, face toward camera",
  "Three-quarter": "a three-quarter turned pose",
  "Chin up": "chin slightly up, confident posture",
  "Relaxed": "relaxed shoulders, natural easy posture",
  "Head tilt": "a gentle friendly head tilt",
};
const MODES = {
  "Corporate": "clean corporate style, balanced neutral colour grade, polished and trustworthy",
  "Creative": "creative style with richer colour and a modern, characterful mood",
  "Editorial": "editorial magazine style, crisp high-contrast grade, striking and premium",
  "Natural": "natural relaxed style, soft true-to-life colours and gentle contrast",
};
const EXPRESSIONS = {
  "Natural smile": "a warm, natural smile",
  "Confident": "a composed, confident expression",
  "Friendly": "a friendly, approachable expression",
  "Serious": "a calm, serious and professional expression",
  "Neutral": "a relaxed neutral expression",
};
const FRAMES = {
  "Head & shoulders": "head-and-shoulders framing",
  "Close-up": "a tighter close-up portrait crop from the chest up, face prominent",
  "Upper body": "an upper-body framing showing head, shoulders and upper chest",
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
  const { selfie, scene, category, outfit, style, pose, expr, frame, token, scene_id } = body;
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

  const outfitDesc = OUTFITS[outfit] || OUTFITS["Navy suit"];
  const styleDesc = STYLES[style] || STYLES["Formal"];
  const poseDesc = POSES[pose] || POSES["Straight on"];
  const exprDesc = EXPRESSIONS[expr] || EXPRESSIONS["Natural smile"];
  const frameDesc = FRAMES[frame] || FRAMES["Head & shoulders"];
  const b64 = selfie.split(",")[1];
  const mime = selfie.slice(5, selfie.indexOf(";"));
  const lightByVariant = ["even studio lighting","soft window lighting","crisp editorial lighting","golden-hour rim light"][vi];
  const prompt =
    `Transform this photo into a polished, professional headshot of the SAME person — preserve their exact facial identity, bone structure, natural skin tone, ethnicity and hair. Do not change who they are. ` +
    `Apply flattering professional retouching: even out and smooth the skin naturally, gently reduce blemishes, shine and under-eye shadows, brighten and add subtle catchlights to the eyes, whiten teeth slightly, and give a healthy, well-lit complexion — as a high-end studio photographer would, while keeping the result realistic and recognisable (no plastic or over-smoothed look). ` +
    `Style: ${styleDesc}. Dress them in ${outfitDesc}. The person is ${poseDesc}, with ${exprDesc}. ` +
    `Background: ${scene || "a modern office"} (${category || "professional"} setting), softly blurred with shallow depth of field. ` +
    `${frameDesc}, ${lightByVariant}, photorealistic, flattering soft key lighting, 85mm portrait lens, high-end professional photography.`;

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
