// Summy Garden Studio — identity-preserving headshot generation (streaming v2 function)
const MODEL = "gemini-2.5-flash-image";
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

export default async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST")
    return Response.json({ error: "POST only" }, { status: 405, headers });

  const key = process.env.GEMINI_API_KEY;
  if (!key)
    return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 501, headers });

  let body = {};
  try { body = await req.json(); } catch {}
  const { selfie, scene, category, look } = body;
  if (!selfie || !selfie.startsWith("data:image/"))
    return Response.json({ error: "selfie (data URL) required" }, { status: 400, headers });
  if (selfie.length > 6_000_000)
    return Response.json({ error: "image too large" }, { status: 413, headers });

  const b64 = selfie.split(",")[1];
  const mime = selfie.slice(5, selfie.indexOf(";"));
  const outfit = OUTFITS[look] || OUTFITS["Business formal"];
  const vi = Math.min(Math.max(parseInt(body.variant ?? 0, 10) || 0, 0), VARIANTS.length - 1);

  const prompt =
    `Transform this photo into a professional corporate headshot of the SAME person — preserve their exact facial identity, features, skin tone and hair. ` +
    `Dress them in ${outfit}. Background: ${scene || "a modern office"} (${category || "professional"} setting), softly blurred with shallow depth of field. ` +
    `Head-and-shoulders framing, ${VARIANTS[vi]}, photorealistic, 85mm portrait lens, high-end corporate photography. ` +
    `Subtle, natural skin retouching only — keep the person recognisable.`;

  try {
    const res = await fetch(`${API}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [ { inline_data: { mime_type: mime, data: b64 } }, { text: prompt } ] }],
        generationConfig: { imageConfig: { aspectRatio: "3:4" } },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return Response.json({ error: `Gemini ${res.status}: ${t.slice(0, 300)}` }, { status: 502, headers });
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) return Response.json({ error: "no image in response" }, { status: 502, headers });
    const d = img.inlineData || img.inline_data;
    const payload = JSON.stringify({
      image: `data:${d.mimeType || d.mime_type || "image/png"};base64,${d.data}`,
      variant: vi, mode: "gemini",
    });
    // stream the JSON so we bypass the 6MB buffered-response limit
    const stream = new ReadableStream({
      start(c) {
        const enc = new TextEncoder(); const CH = 65536;
        for (let i = 0; i < payload.length; i += CH) c.enqueue(enc.encode(payload.slice(i, i + CH)));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 502, headers });
  }
};
