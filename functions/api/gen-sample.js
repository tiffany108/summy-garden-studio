let env;
// Summy Garden Studio — admin-only: generate a stock model portrait via Gemini
// (for building matched-ethnicity gallery samples). Body: { token, prompt }.
// Returns the generated image bytes. Library-building only, never per-customer.
const MODEL = "gemini-2.5-flash-image";
const API = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const SB_URL = "https://qyixfqqkbgajqmclpnqr.supabase.co";
const SB_PUB = "sb_publishable_FX9-eaM-1hBzisTNm_YVhw_BoeTUAPs";
const ADMIN_EMAIL = "tiffany123@hotmail.com.hk";

const handler = async (req) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405, headers });
  const gemKey = env.GEMINI_API_KEY;
  if (!gemKey) return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 501, headers });

  let body = {}; try { body = await req.json(); } catch {}
  if (!body.token) return Response.json({ error: "sign in required" }, { status: 401, headers });
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, Authorization: `Bearer ${body.token}` } });
  const caller = u.ok ? await u.json() : null;
  if (!caller?.email || caller.email !== ADMIN_EMAIL) return Response.json({ error: "admin only" }, { status: 403, headers });

  const prompt = String(body.prompt || "").slice(0, 700);
  if (!prompt) return Response.json({ error: "prompt required" }, { status: 400, headers });

  try {
    const res = await fetch(`${API}?key=${gemKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { imageConfig: { aspectRatio: "3:4" } } }),
    });
    if (!res.ok) { const t = await res.text(); return Response.json({ error: `Gemini ${res.status}: ${t.slice(0, 300)}` }, { status: 500, headers }); }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p) => p.inlineData || p.inline_data);
    if (!img) return Response.json({ error: "no image in response" }, { status: 500, headers });
    const d = img.inlineData || img.inline_data;
    return new Response(Uint8Array.from(atob(d.data), (c) => c.charCodeAt(0)), {
      status: 200, headers: { ...headers, "Content-Type": d.mimeType || d.mime_type || "image/png", "Cache-Control": "no-store" },
    });
  } catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 500, headers }); }
};

export async function onRequest(context) { env = context.env; return handler(context.request); }
