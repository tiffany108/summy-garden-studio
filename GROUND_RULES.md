# Summy Garden Studio — Photo Generation Ground Rules & Principles

**Status:** Working recipe proven live and accepted by the owner ("yes, much better").
**Last updated:** 22 July 2026 (v3 — final proven face-swap recipe)

These are the binding principles for how customer photos are produced. No engineering or spend happens unless it complies. When a new request conflicts with a rule here, we revisit this document first.

---

## 0. The overriding principle

**Reliability over novelty.** We only offer a choice we can deliver as a natural, professional photo. If we can't deliver it reliably, the option is hidden. A smaller set that always looks right beats a large set that sometimes fails.

---

## 1. THE PROVEN RECIPE (validated live, 22 Jul 2026 — this is the core)

A delivered photo = the customer's face swapped onto a chosen gallery sample. Four things, all required:

1. **Clean source photo.** Plain wall behind the customer, nothing beside the head (no chairs/objects), hair tidied off the face, even light (face a window), phone at eye level, head-and-shoulders with the face large. **This is the single biggest factor** — a cluttered photo drags junk (e.g. a chair) into the hair and ruins the result.

2. **Send the full face.** Use the whole framed face, not a tight crop. The full face is what makes it look like the customer; over-cropping to "clean up" throws the likeness away. (A clean photo means the full face is safe to send.)

3. **Pure swap — ZERO instructions.** Never send any prompt/"additional prompt" to the swap engine. Every prompt we tried broke it: "beautify/youthful" turned the customer into a different, younger, wrong-ethnicity person; "keep ethnicity" made it keep the *model's* face. The bare swap just works.

4. **Hair-matched sample.** Choose a sample whose model's hair matches the customer's (length, straight/wavy, colour family). This is what makes the hair look whole and natural — the swap keeps the model's hair, so if it already resembles the customer's, there's no visible seam or half-and-half.

**Ethnicity is NOT a factor.** The pure swap transfers the customer's own face and skin tone onto any model regardless of the model's ethnicity (proven: an Asian customer on a European model → the result is clearly the Asian customer). Do **not** curate by ethnicity. Match **hair**, not ethnicity.

---

## 2. The engine

2.1 **Segmind Faceswap v5** (`faceswap-v5`), key `SEGMIND_API_KEY` in Cloudflare, ≈US$0.05/image. Called with **only** `source_image` (customer face) + `target_image` (gallery sample) + quality; **no `additional_prompt`, ever** (§1.3).

2.2 Free image-generation (Gemini) is used **only** for one-time, offline library building (creating new gallery samples), never per-customer.

2.3 **Segmind credit is kept** (the refund is moot) — it is now the working production engine.

---

## 3. Fixed vs. changeable (what each photo is made of)

| Element | Source | Changes? |
|---|---|---|
| Background, suit, pose, size, lighting | The chosen gallery sample — untouched pixels | **No — fixed** |
| Face — features, skin tone, ethnicity | The customer's own photo (swapped in) | Kept — this is the customer |
| Hair | The model's — chosen to match the customer's (§1.4) | Model's, hair-matched |

Everything the customer picks from the gallery is delivered unchanged; only the face is theirs.

---

## 4. The gallery & "hair-matched sample sets" (CHOSEN APPROACH)

4.1 Customers choose from whole, finished sample photos — never free recombination. The Style/Outfit/Pose pickers become **filters** over whole samples; un-deliverable filters are hidden.

4.2 Because the swap keeps the model's hair, the gallery is organised into **hair-matched sets**: each sample is tagged by the model's hair (length, texture, colour). Each customer is shown samples whose hair matches theirs (asked once, or judged from their photo). This — not ethnicity — is what we match on.

4.3 The **existing gallery is used as-is** (owner decision: no regenerating photos). We select the naturally-occurring matching samples from it; we may *add* a few new samples only where a common hair type is missing.

---

## 5. Enhancement

5.1 **Default: none.** The pure swap is delivered as-is. We proved that even light "freshening" prompts destroy identity, so enhancement is NOT applied through the swap engine.

5.2 If any polish is ever added, it must be a **separate**, post-swap image step (never a prompt to the swap), kept minimal, and must never alter identity, ethnicity or age. Off by default.

---

## 6. Capture guidance (shown to every customer)

The upload screen must clearly instruct: *plain wall, nothing beside your head, hair tidied off your face, even lighting (face a window), phone at eye level, head-and-shoulders with your face large.* Good input is the difference between "looks like me" and a mess.

---

## 7. Element labelling scheme (per sample)

- `SG-###` — master: scene name, category, **model's hair (length/texture/colour)**, gender, thumbnail.
- `SG-###.BG` / `.SUIT` / `.POSE` / `.SIZE` / `.LIGHT` — long descriptions of each fixed element.
- `SG-###.FACEBOX` — the face region the swap targets.

The **hair tag** powers hair-matched sample sets (§4.2).

---

## 8. Cost, consent & payment

8.1 Customer sees a **watermarked** result first; credit is charged only on download/email (watermark removed).

8.2 Only the **customer's own** face is swapped, by their choice, onto AI-generated (non-real) models.

8.3 **API spend authorised per action** — no paid generation without the owner's clear go-ahead; test spend disclosed in advance.

8.4 Provider keys entered by the owner into Cloudflare; Claude never stores secret values.

---

## 9. Process rules

9.1 **Prove before building** (the recipe above was proven this way).
9.2 **Verify live before "done."**
9.3 **Only expose the deliverable;** hide the rest.
9.4 **Translate every new label/message** into all supported languages before shipping.
9.5 **Honesty over reassurance** — state real limits plainly.

---

## 10. Definition of a successfully delivered photo

Deliver only if ALL are true:

- It clearly resembles the customer (face, skin tone, ethnicity preserved by the pure swap).
- The background, suit, pose, size and lighting are the chosen sample's, unchanged.
- The hair is **whole and consistent** (no chair/object pulled in, no half-and-half) — achieved via a clean photo + hair-matched sample.
- No prompt/enhancement altered the identity.

If any fails, don't deliver — fix the input (cleaner photo) or the match (better hair-matched sample), or hide the option.
