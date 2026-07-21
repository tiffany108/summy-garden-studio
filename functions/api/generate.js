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
  "Auto": "a tailored professional business suit chosen by the studio — navy or charcoal with a crisp shirt, whichever flatters the person best",
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

  let stage = "parse";
  try {
  let body = {}; try { body = await req.json(); } catch {}
  const { selfie, scene, category, outfit, style, pose, expr, frame, token, scene_id } = body;
  const enhance = Math.max(0, Math.min(100, parseInt(body.enhance ?? 60, 10) || 0)); // % facial enhancement
  if (!token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  stage = "auth";
  const authUser = await sbAuthUser(token);
  if (!authUser?.id) return Response.json({ error: "invalid session" }, { status: 401, headers });
  stage = "credit";
  if (!selfie || !selfie.startsWith("data:image/")) return Response.json({ error: "selfie required" }, { status: 400, headers });
  if (selfie.length > 6_000_000) return Response.json({ error: "image too large" }, { status: 413, headers });

  const vi = Math.min(Math.max(parseInt(body.variant ?? 0, 10) || 0, 0), VARIANTS.length - 1);
  const isProof = body.proof === true;
  let remaining = null;

  if (isProof) {
    // Proof mode: one watermarked combination set, no credit spent now —
    // max 3 per user per 2 hours (admin exempt); credits are charged when
    // a photo is downloaded/emailed (see /api/unlock-photo).
    const isAdmin = authUser.email === "tiffany123@hotmail.com.hk";
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const q = await sbService(`/rest/v1/headshots?user_id=eq.${authUser.id}&variant=eq.9&created_at=gte.${encodeURIComponent(since)}&select=id`);
    const rows = q.ok ? await q.json() : [];
    if (!isAdmin && rows.length >= 6) return Response.json({ error: "Preview limit reached for now — download your favourite set, or try again in a couple of hours." }, { status: 409, headers });
  } else if (vi === 0) {
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

  stage = "prompt";
  // Default (no outfit chosen / "Auto") → the studio's best suit.
  // Only the explicit "Original" choice keeps the person's own clothing.
  const keepOriginalOutfit = outfit === "Original";
  const outfitDesc = keepOriginalOutfit ? OUTFITS["Original"] : (OUTFITS[outfit] || OUTFITS["Auto"]);
  const styleDesc = STYLES[style] || STYLES["Formal"];
  const poseDesc = POSES[pose] || POSES["Straight on"];
  const exprDesc = EXPRESSIONS[expr] || EXPRESSIONS["Natural smile"];
  const frameDesc = POSEFRAME[pose] || FRAMES[frame] || FRAMES["Head & shoulders"];
  const b64 = selfie.split(",")[1];
  const mime = selfie.slice(5, selfie.indexOf(";"));
  const lightByVariant = ["even studio lighting","soft window lighting","crisp editorial lighting","golden-hour rim light"][vi];

  // Reference images for the EXACT chosen scene and outfit arrive from the
  // browser as small data-URLs (encoding them server-side exceeded the CPU
  // limit and crashed the function — the client does it for free).
  const parseDataImg = (s, cap) => {
    if (typeof s !== "string" || !s.startsWith("data:image/") || s.length > cap) return null;
    const comma = s.indexOf(","); if (comma < 0) return null;
    return { mime: s.slice(5, s.indexOf(";")), data: s.slice(comma + 1) };
  };
  const sceneRef = parseDataImg(body.scene_ref, 2_500_000);
  const outfitRef = parseDataImg(body.outfit_ref, 2_000_000);
  const faceRef = parseDataImg(body.face_ref, 2_000_000);
  const baseRef = parseDataImg(body.base_ref, 2_500_000); // sample portrait for face-swap mode
  // If the Gemini call fails after the credit was consumed, give the credit back.
  const refundCredit = async () => {
    if (vi !== 0 || remaining === null) return;
    try {
      const r = await sbService(`/rest/v1/profiles?id=eq.${authUser.id}&select=credits`);
      const rows = r.ok ? await r.json() : [];
      if (rows.length) await sbService(`/rest/v1/profiles?id=eq.${authUser.id}`, {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ credits: (rows[0].credits | 0) + 1 }) });
    } catch {}
  };
  // Retouch intensity chosen by the user (0% = keep the face exactly as-is; 100% = full studio polish)
  const retouch =
    enhance < 20 ? `Apply NO facial retouching at all: keep the skin texture, pores, marks, skin tone and all facial shapes exactly as they appear in the original photo — change only the clothing, background, lighting and framing. ` :
    enhance < 50 ? `Apply only very light retouching (about ${enhance}% intensity): keep the original skin texture, tone and all facial shapes untouched; at most soften harsh shadows and reduce temporary shine — the face must look unedited and completely natural. ` :
    enhance < 80 ? `Apply moderate professional retouching (about ${enhance}% intensity): even out and smooth the skin naturally, gently reduce blemishes, shine and under-eye shadows, brighten the eyes subtly — while faithfully preserving the original skin tone, skin texture and every facial shape and proportion (no slimming, no reshaping, no plastic look). ` :
    `Apply flattering professional retouching to SKIN AND LIGHTING ONLY: even out and smooth the skin naturally, gently reduce blemishes, shine and under-eye shadows, brighten and add subtle catchlights to the eyes, whiten teeth slightly, and give a healthy, well-lit complexion — as a high-end studio photographer would, keeping the result realistic and recognisable (no plastic or over-smoothed look). `;
  const ords = ["FIRST", "SECOND", "THIRD", "FOURTH"]; let imgN = 1;
  const faceOrd = faceRef ? ords[imgN++] : null;
  const sceneOrd = sceneRef ? ords[imgN++] : null;
  const outfitOrd = outfitRef ? ords[imgN++] : null;
  let prompt, parts;
  if (body.swap === true && baseRef) {
    // FACE-SWAP mode (Auto / sample pick): keep the sample photo identical,
    // replace only the model's head with the customer's.
    const promptOverride = (authUser.email === "tiffany123@hotmail.com.hk" && typeof body.swap_prompt === "string" && body.swap_prompt.length < 4000) ? body.swap_prompt : null;
    prompt = promptOverride ||
      (`FACE SWAP task — this is a mandatory face replacement, not a suggestion. ` +
      `The FIRST attached image is a professional portrait of MODEL A. The SECOND attached image shows PERSON B. ` +
      `Produce the FIRST image again, IDENTICAL in every way — same clothing, same body, same pose, same hands, same background, same lighting, same colours, same framing — EXCEPT the head: MODEL A's face, head and hair must be COMPLETELY REPLACED by PERSON B's face, head and hairstyle. ` +
      `The output must NOT contain MODEL A's face or hair anywhere. If PERSON B has a different gender, age, ethnicity or hairstyle than MODEL A, the new head MUST still be PERSON B's — adapt nothing about it. ` +
      `PERSON B's identity is non-negotiable: copy their facial geometry, eyes, nose, mouth, jawline, skin tone and hairstyle exactly so they are instantly recognisable. ` +
      `${retouch}Never change the shape or proportions of any facial feature. ` +
      `Blend the new head seamlessly: natural neck transition, skin tone matched to PERSON B, relit to the FIRST image's lighting direction. Photorealistic, high-end professional photography.`);
    parts = [{ inline_data: { mime_type: baseRef.mime || "image/jpeg", data: baseRef.data } }];
    if (faceRef) parts.push({ inline_data: { mime_type: faceRef.mime || "image/jpeg", data: faceRef.data } });
    else parts.push({ inline_data: { mime_type: mime, data: b64 } });
    parts.push({ text: prompt });
  } else {
  prompt =
    `Professional headshot creation task. Edit the FIRST attached photo. Follow ALL numbered instructions: ` +
    `1) IDENTITY — MOST IMPORTANT: the output must show the SAME person as the FIRST photo. ` +
    (faceOrd ? `The ${faceOrd} attached image is a sharp close-up of this person's face — it is the DEFINITIVE face reference: copy it exactly, feature by feature. Use it ONLY for facial identity — do NOT copy its crop, zoom or framing; the composition is set by instruction 5. ` : ``) +
    `Copy their exact face: facial geometry, eyes, nose, mouth, jawline, skin tone, ethnicity, apparent age and hairstyle. Do not beautify them into a different person; anyone who knows them must recognise them instantly. ` +
    `2) FACE RETOUCH: ${retouch}At EVERY retouch level: never change the shape or proportions of any facial feature — no slimming, reshaping, enlarging eyes or altering the nose, jaw or lips. Only skin texture, blemishes and lighting may be adjusted. The sole permitted shape change is the facial EXPRESSION requested in instruction 5 (e.g. a natural or big smile). ` +
    `3) CLOTHING: ` +
    (outfitOrd
      ? `REMOVE the person's current clothing and dress them in EXACTLY the outfit shown in the ${outfitOrd} attached image (${outfitDesc}) — same garment, colour, fabric, neckline and details, fitted naturally to their body. The original clothing must not remain visible. `
      : keepOriginalOutfit
        ? `keep the person's OWN clothing exactly as worn in the FIRST photo — same garment, colours, neckline and fabric, just neatly presented. Do not replace their clothes. `
        : `REMOVE the person's current clothing and dress them in ${outfitDesc}. The original clothing must not remain visible. `) +
    `4) BACKGROUND: ` +
    (sceneOrd
      ? `COMPLETELY REPLACE the FIRST photo's background with the environment shown in the ${sceneOrd} attached image (${scene || "professional setting"}). None of the FIRST photo's original surroundings, ground or sky may remain visible. The result must look as if the person was photographed standing IN the ${sceneOrd} image's exact location: match that reference image's composition, architecture, objects, colours, season and lighting as closely as possible — near pixel-faithful apart from a soft depth-of-field blur behind the person. `
      : `COMPLETELY REPLACE the background with ${scene || "a modern office"} (${category || "professional"} setting), softly blurred with shallow depth of field. `) +
    `5) POSE & FRAMING: the person is ${poseDesc}, with ${exprDesc}. Compose the shot as ${frameDesc} — recompose the crop and zoom to this framing (do NOT reuse the FIRST photo's framing or distance), keeping the person horizontally centred similarly to the FIRST photo. ` +
    `6) STYLE & LIGHT: ${styleDesc}. ${lightByVariant}, photorealistic, flattering soft key lighting, 85mm portrait lens, high-end professional photography.`;

  parts = [{ inline_data: { mime_type: mime, data: b64 } }];
  if (faceRef) parts.push({ inline_data: { mime_type: faceRef.mime || "image/jpeg", data: faceRef.data } });
  if (sceneRef) parts.push({ inline_data: { mime_type: sceneRef.mime || "image/jpeg", data: sceneRef.data } });
  if (outfitRef) parts.push({ inline_data: { mime_type: outfitRef.mime || "image/jpeg", data: outfitRef.data } });
  parts.push({ text: prompt });
  }

  stage = "gemini";
  try {
    const res = await fetch(`${API}?key=${gemKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }],
        generationConfig: { imageConfig: { aspectRatio: "3:4" } } }),
    });
    if (!res.ok) { const t = await res.text(); await refundCredit(); return Response.json({ error: `Gemini ${res.status}: ${t.slice(0, 900)}` }, { status: 500, headers }); }
    const data = await res.json();
    const outParts = data?.candidates?.[0]?.content?.parts || [];
    const img = outParts.find((p) => p.inlineData || p.inline_data);
    if (!img) { await refundCredit(); return Response.json({ error: "no image in response" }, { status: 500, headers }); }
    const d = img.inlineData || img.inline_data;
    // Save this variant to the user's dashboard (best effort — never blocks the response)
    try {
      const outMime = d.mimeType || d.mime_type || "image/png";
      const ext = outMime.includes("jpeg") ? "jpg" : "png";
      const outVi = isProof ? 9 : vi; // 9 marks a proof/combination set
      const path = `${authUser.id}/${Date.now()}_v${outVi}.${ext}`;
      const sbKey = env.SUPABASE_SECRET_KEY;
      const up = await fetch(`${SB_URL}/storage/v1/object/headshots/${path}`, {
        method: "POST",
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": outMime, "x-upsert": "true" },
        body: Uint8Array.from(atob(d.data), c=>c.charCodeAt(0)),
      });
      if (up.ok) {
        await sbService(`/rest/v1/headshots`, { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ user_id: authUser.id, scene: scene_id || scene || "", look: [outfit, style].filter(Boolean).join(" · "), variant: outVi, path }) });
      }
    } catch {}
    const payload = JSON.stringify({ image: `data:${d.mimeType || d.mime_type || "image/png"};base64,${d.data}`, variant: vi, remaining, mode: "gemini" });
    const stream = new ReadableStream({ start(c) { const enc = new TextEncoder(); const CH = 65536;
      for (let i = 0; i < payload.length; i += CH) c.enqueue(enc.encode(payload.slice(i, i + CH))); c.close(); } });
    return new Response(stream, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    await refundCredit();
    return Response.json({ error: String(e?.message || e) }, { status: 500, headers });
  }
  } catch (e) {
    // top-level guard: report the crash point instead of a blank Cloudflare 502
    return Response.json({ error: `crash at ${stage}: ${String(e?.stack || e?.message || e).slice(0, 400)}` }, { status: 500, headers });
  }
};

export async function onRequest(context){ env = context.env; return handler(context.request); }
