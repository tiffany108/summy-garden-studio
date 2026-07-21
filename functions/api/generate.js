let env;
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
  "Black suit": "a sharp black business suit with a white shirt",
  "Light grey suit": "a light grey business suit with a soft shirt",
  "Pinstripe suit": "a classic pinstripe business suit",
  "Three-piece suit": "a three-piece suit with a matching waistcoat",
  "Women's trouser suit": "a tailored women's trouser suit",
  "Women's skirt suit": "a tailored women's skirt suit",
  "Linen blazer": "a relaxed summer linen blazer",
  "Tweed jacket": "a textured tweed jacket",
  "Blazer over tee": "a smart blazer worn over a plain fitted tee",
  "Blue shirt": "a pressed light blue collared shirt",
  "Striped shirt": "a fine-striped business shirt",
  "Open-collar shirt": "a relaxed open-collar shirt, no tie",
  "Shirt & tie": "a pressed shirt with a well-knotted tie",
  "Tuxedo": "a black-tie tuxedo with a bow tie",
  "Silk blouse": "a flowing silk blouse",
  "Knit sweater": "a fine merino knit sweater",
  "Cardigan": "a smart fitted cardigan over a shirt",
  "Sheath dress": "an elegant tailored sheath dress",
  "Wrap dress": "a professional wrap dress",
  "Polo shirt": "a clean fitted polo shirt",
  "Hijab & blazer": "a smart blazer worn with a neatly draped hijab",
  "White coat": "a doctor's white coat over professional attire",
  "Medical scrubs": "clean medical scrubs",
  "Chef's whites": "a chef's white jacket",
  "Pilot uniform": "an airline pilot's uniform with epaulettes",
  "Hi-vis workwear": "hi-visibility site workwear",
  "Academic gown": "an academic graduation gown with a hood",
  "Cheongsam": "an elegant traditional cheongsam",
  "Blazer & camisole": "a tailored blazer over a silk camisole",
  "Longline blazer": "a longline tailored blazer",
  "Bouclé jacket": "a classic bouclé tweed jacket",
  "Women's tuxedo": "a women's tuxedo jacket with satin lapels",
  "Puff-sleeve blouse": "a puff-sleeve blouse",
  "Ruffle blouse": "a ruffle-front blouse",
  "Knit twinset": "a fine knit twinset",
  "Shirt dress": "a tailored shirt dress",
  "Midi dress": "an elegant professional midi dress",
  "Kimono jacket": "a draped kimono-style jacket",
  "Sari": "an elegant traditional sari drape",
  "Abaya": "an elegant tailored abaya",
  "Cardigan & scarf": "a fine cardigan with a silk scarf",
  "Turtleneck & blazer": "a fitted turtleneck under a tailored blazer",
  "Peplum jacket": "a structured peplum jacket",
  "Satin blouse": "a lustrous satin blouse",
  "Double-breasted suit": "a double-breasted business suit",
  "Brown suit": "a warm brown business suit",
  "Blue suit": "a bright blue business suit",
  "Waistcoat & shirt": "a waistcoat over a pressed shirt",
  "Suit & pocket square": "a suit finished with a pocket square",
  "Knit tie & shirt": "a shirt with a textured knit tie",
  "Denim shirt": "a smart denim shirt",
  "Bomber jacket": "a refined bomber jacket",
  "Field jacket": "a smart field jacket",
  "Sweater vest": "a sweater vest over a shirt",
  "Henley shirt": "a fitted henley shirt",
  "Mandarin collar suit": "a mandarin-collar suit jacket",
  "Women's navy suit": "a tailored women's navy business suit",
  "Women's charcoal suit": "a tailored women's charcoal business suit",
  "Women's black suit": "a sharp women's black business suit",
  "Women's grey suit": "a tailored women's light grey business suit",
  "Women's pinstripe suit": "a women's pinstripe business suit",
  "Women's double-breasted suit": "a women's double-breasted business suit",
};
const STYLES = {
  "Formal": "formal professional look, polished and corporate",
  "Studio": "clean studio-portrait lighting with an even key light",
  "Corporate": "balanced neutral colour grade, trustworthy and steady",
  "Office": "bright professional workday look",
  "Casual": "relaxed smart-casual look, approachable and warm",
  "Natural": "natural true-to-life rendering with soft daylight",
  "Creative": "creative look with richer colour and characterful mood",
  "Fashion": "fashion-editorial look, stylish and contemporary",
  "Street": "candid urban energy with a cooler, grittier grade",
  "Luxury": "premium luxury look, refined and elegant with deep rich tones",
  "Editorial": "editorial magazine look, crisp high-contrast grade",
  "Vintage": "subtle warm vintage film look",
  "Black & white": "fine-art monochrome conversion with rich tonal range",
  "Soft glow": "dreamy soft-focus halation, gentle and flattering",
  "High key": "bright airy high-key rendering with minimal shadow",
  "Low key": "dramatic low-key rendering with deep shadow falloff",
  "Golden warm": "warm golden colour grade, sunlit and inviting",
  "Cool crisp": "cool clean modern grade, sharp and precise",
  "Cinematic": "filmic cinematic grade with teal and amber separation",
  "Executive": "authoritative senior-leadership gravitas",
  "Approachable": "friendly warm human tone, open and personable",
  "Tech": "clean modern minimal look with a contemporary startup feel",
  "Academic": "measured scholarly tone, restrained and considered",
  "Bold": "punchy saturated contemporary look, confident and striking",
};
const POSEFRAME = {
  "Straight on": "head and shoulders framing",
  "Left facing": "head and shoulders framing",
  "Right facing": "head and shoulders framing",
  "Close-up": "tight close-up framing on the face",
  "Half body": "waist-up framing showing the upper body",
  "Chin up": "head and shoulders framing",
  "Three-quarter": "head and shoulders framing",
  "Slight angle": "head and shoulders framing",
  "Over shoulder": "head and shoulders framing",
  "Arms crossed": "waist-up framing showing the upper body",
  "Hands in pockets": "waist-up framing showing the upper body",
  "Seated": "waist-up framing showing the upper body",
  "Leaning": "waist-up framing showing the upper body",
  "Head tilt": "head and shoulders framing",
  "Relaxed": "head and shoulders framing",
  "Standing tall": "waist-up framing showing the upper body",
  "Hand to chin": "head and shoulders framing",
  "Looking away": "head and shoulders framing",
};
const POSES = {
  "Straight on": "facing the camera straight on",
  "Left facing": "body turned to their left with the face toward camera",
  "Right facing": "body turned to their right with the face toward camera",
  "Close-up": "framed tight on the face",
  "Half body": "standing, seen from the waist up",
  "Chin up": "chin slightly raised in a confident posture",
  "Three-quarter": "in a three-quarter turned pose",
  "Slight angle": "body at a slight angle with the face toward camera",
  "Over shoulder": "looking back over one shoulder toward the camera",
  "Arms crossed": "standing with arms confidently crossed",
  "Hands in pockets": "standing relaxed with hands in pockets",
  "Seated": "seated upright and composed",
  "Leaning": "leaning casually to one side",
  "Head tilt": "with a gentle friendly head tilt",
  "Relaxed": "with relaxed shoulders and an easy natural posture",
  "Standing tall": "standing tall with squared shoulders",
  "Hand to chin": "with one hand thoughtfully near the chin",
  "Looking away": "looking slightly away from the camera in a candid moment",
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
  const key = env.SUPABASE_SECRET_KEY;
  return fetch(`${SB_URL}${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
}

const handler = async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });

  const gemKey = env.GEMINI_API_KEY;
  if (!gemKey) return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 501, headers });
  if (!env.SUPABASE_SECRET_KEY) return Response.json({ error: "SUPABASE_SECRET_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  const { selfie, scene, category, outfit, style, pose, expr, frame, token, scene_id } = body;
  const enhance = Math.max(0, Math.min(100, parseInt(body.enhance ?? 60, 10) || 0)); // % facial enhancement
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
      body: JSON.stringify({ user_id: authUser.id, scene: scene_id || scene || "", look: [outfit, style].filter(Boolean).join(" · ") }) });
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
  const frameDesc = POSEFRAME[pose] || FRAMES[frame] || FRAMES["Head & shoulders"];
  const b64 = selfie.split(",")[1];
  const mime = selfie.slice(5, selfie.indexOf(";"));
  const lightByVariant = ["even studio lighting","soft window lighting","crisp editorial lighting","golden-hour rim light"][vi];

  // Fetch the actual backdrop image for the chosen scene so the AI reproduces THAT
  // exact environment instead of imagining one from the text description.
  let sceneRefB64 = null;
  const sceneIdx = parseInt(body.scene_i, 10);
  if (Number.isInteger(sceneIdx) && sceneIdx >= 0 && sceneIdx < 200) {
    try {
      let ab = env.SCENE_CACHE ? await env.SCENE_CACHE.get("b-" + sceneIdx, { type: "arrayBuffer" }) : null;
      if (!ab) {
        const r = await fetch(`https://summy-garden-studio.pages.dev/api/sample?kind=b&i=${sceneIdx}`, { cf: { cacheTtl: 86400 } });
        if (r.ok) ab = await r.arrayBuffer();
      }
      if (ab && ab.byteLength > 1000) {
        const u = new Uint8Array(ab); let s = "";
        for (let o = 0; o < u.length; o += 8192) s += String.fromCharCode.apply(null, u.subarray(o, o + 8192));
        sceneRefB64 = btoa(s);
      }
    } catch (e) { /* fall back to text-only scene description */ }
  }
  // Retouch intensity chosen by the user (0% = keep the face exactly as-is; 100% = full studio polish)
  const retouch =
    enhance < 20 ? `Apply NO facial retouching at all: keep the skin texture, pores, marks, skin tone and all facial shapes exactly as they appear in the original photo — change only the clothing, background, lighting and framing. ` :
    enhance < 50 ? `Apply only very light retouching (about ${enhance}% intensity): keep the original skin texture, tone and all facial shapes untouched; at most soften harsh shadows and reduce temporary shine — the face must look unedited and completely natural. ` :
    enhance < 80 ? `Apply moderate professional retouching (about ${enhance}% intensity): even out and smooth the skin naturally, gently reduce blemishes, shine and under-eye shadows, brighten the eyes subtly — while faithfully preserving the original skin tone, skin texture and every facial shape and proportion (no slimming, no reshaping, no plastic look). ` :
    `Apply flattering professional retouching: even out and smooth the skin naturally, gently reduce blemishes, shine and under-eye shadows, brighten and add subtle catchlights to the eyes, whiten teeth slightly, and give a healthy, well-lit complexion — as a high-end studio photographer would, while keeping the result realistic and recognisable (no plastic or over-smoothed look). `;
  const prompt =
    `Transform this photo into a polished, professional headshot of the SAME person — preserve their exact facial identity, bone structure, natural skin tone, ethnicity and hair. Do not change who they are. ` +
    retouch +
    `Style: ${styleDesc}. Dress them in ${outfitDesc}. The person is ${poseDesc}, with ${exprDesc}. ` +
    (sceneRefB64
      ? `Background: the SECOND attached image shows the exact background location (${scene || "professional setting"}). Place the person standing in exactly this environment — reproduce its architecture, colours, season and lighting faithfully, softly blurred with shallow depth of field behind them. `
      : `Background: ${scene || "a modern office"} (${category || "professional"} setting), softly blurred with shallow depth of field. `) +
    `${frameDesc}, ${lightByVariant}, photorealistic, flattering soft key lighting, 85mm portrait lens, high-end professional photography.`;

  const parts = [{ inline_data: { mime_type: mime, data: b64 } }];
  if (sceneRefB64) parts.push({ inline_data: { mime_type: "image/png", data: sceneRefB64 } });
  parts.push({ text: prompt });

  try {
    const res = await fetch(`${API}?key=${gemKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }],
        generationConfig: { imageConfig: { aspectRatio: "3:4" } } }),
    });
    if (!res.ok) { const t = await res.text(); return Response.json({ error: `Gemini ${res.status}: ${t.slice(0, 200)}` }, { status: 502, headers }); }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) return Response.json({ error: "no image in response" }, { status: 502, headers });
    const d = img.inlineData || img.inline_data;
    // Save this variant to the user's dashboard (best effort — never blocks the response)
    try {
      const outMime = d.mimeType || d.mime_type || "image/png";
      const ext = outMime.includes("jpeg") ? "jpg" : "png";
      const path = `${authUser.id}/${Date.now()}_v${vi}.${ext}`;
      const sbKey = env.SUPABASE_SECRET_KEY;
      const up = await fetch(`${SB_URL}/storage/v1/object/headshots/${path}`, {
        method: "POST",
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": outMime, "x-upsert": "true" },
        body: Uint8Array.from(atob(d.data), c=>c.charCodeAt(0)),
      });
      if (up.ok) {
        await sbService(`/rest/v1/headshots`, { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ user_id: authUser.id, scene: scene_id || scene || "", look: [outfit, style].filter(Boolean).join(" · "), variant: vi, path }) });
      }
    } catch {}
    const payload = JSON.stringify({ image: `data:${d.mimeType || d.mime_type || "image/png"};base64,${d.data}`, variant: vi, remaining, mode: "gemini" });
    const stream = new ReadableStream({ start(c) { const enc = new TextEncoder(); const CH = 65536;
      for (let i = 0; i < payload.length; i += CH) c.enqueue(enc.encode(payload.slice(i, i + CH))); c.close(); } });
    return new Response(stream, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
};

export async function onRequest(context){ env = context.env; return handler(context.request); }
