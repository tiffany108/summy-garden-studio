# Summy Garden Studio — Photo Generation Ground Rules & Principles

**Status:** Agreed foundation. To be followed *before* any build or spend.
**Last updated:** 22 July 2026

These are the binding principles for how customer photos are produced. No engineering, generation, or API spend happens unless it complies with every rule below. When a new request conflicts with a rule here, we revisit this document first — we do not quietly break a principle to satisfy a one-off feature.

---

## 0. The overriding principle

**Reliability over novelty.** We only offer a choice or combination if we can deliver it as a natural, professional photo with high quality. If we cannot deliver it reliably, the option is **hidden** — never shown as a promise we can't keep. A smaller set of choices that always look right beats a large set that sometimes fails.

---

## 1. Identity & appearance (the non-negotiables)

1.1 The final photo must genuinely **look like the customer** — their real *appearance*, not a rebuilt or "beautified into someone else" version.

1.2 **Appearance is preserved by touching the head as little as possible.** Any method that re-generates or re-synthesises the face (free image-generation, or feature-only face-swap) alters appearance and is therefore **not** the primary method.

1.3 **Face shape is the customer's, always.** We never accept a result where the face shape has shifted to the model's. If the shape changes, the whole look changes — that is a failure, not a trade-off.

1.4 The customer's real face, real face-shape, and (subject to §5) real hair come from **their own photo pixels**, not from generation.

---

## 2. The engine: head-swap, not face-swap

2.1 The production method is **head-swap**: the customer's *entire head* (real shape + features + hair) is placed onto the chosen gallery model's body/scene, with only the neck and lighting blended.

2.2 We do **not** use plain **face-swap** (features-only) as the deliverable, because it keeps the model's head shape and therefore changes the customer's appearance (violates §1.3).

2.3 We do **not** use free image-generation (e.g. Gemini) to produce the customer's face in the final photo, because it repaints everything and drifts.

2.4 Image-generation is permitted **only** for one-time, offline **library expansion** (creating new fixed gallery samples), never per customer delivery.

---

## 3. Fixed vs. changeable (what each photo is made of)

For every delivered photo:

| Element | Source | May it change? |
|---|---|---|
| Background | The chosen gallery sample (untouched pixels) | **No — fixed** |
| Suit / outfit | The chosen gallery sample | **No — fixed** |
| Pose / gesture / body | The chosen gallery sample | **No — fixed** |
| Model size, position, framing | The chosen gallery sample | **No — fixed** |
| Lighting / colour of the scene | The chosen gallery sample | **No — fixed** |
| Head — face shape, features | The customer's own photo | Kept as-is (their true appearance) |
| Hair | The customer's own photo | Kept; light tidy allowed (see §5) |
| Skin / lighting on the face | — | Optional light enhancement (see §5) |

**Everything the customer selects from the gallery is delivered unchanged.** Only the head is theirs, and only the optional enhancement layer is added on top.

---

## 4. The gallery = a library of whole, fixed elements

4.1 Customers choose from a **library of whole, finished sample photos** — each already a natural, professional shot. They do **not** ask the system to invent new combinations.

4.2 Elements that cannot be cleanly separated (a suit only exists as worn by a specific body in a specific pose) are offered **only as a whole sample**. We never try to lift a suit from one photo into a pose from another using real pixels.

4.3 Elements that *can* be cleanly separated may be offered as a choice **only where quality is guaranteed** — e.g. samples on a plain solid/gradient backdrop have clean edges, so a background-colour choice is safe there. Busy backgrounds stay whole-only.

4.4 Every gallery sample is catalogued with a **serial number** and detailed, long-form descriptions of each element (see §7). The catalogue powers search/filters, not recombination.

---

## 5. Enhancement is a separate layer, applied on top

5.1 Enhancement is **never baked into** the swap. It is a distinct, tunable pass applied *after* the head-swap, so it stays controllable and reversible.

5.2 The enhancement layer may: tidy hair (masked to the hair region only, face protected), even out skin and lighting, clean the neck/skin blend, and lightly sharpen.

5.3 The customer's **Natural look %** slider controls the enhancement strength. **0% = the raw swap (maximum "truly me").** Defaults sit **low**.

5.4 **Hair handling:**
 - *Keep as-is* — no change.
 - *Light tidy* (default) — smooth flyaways/frizz, tidy the outline, keep the same colour, length and style. Appearance-safe.
 - *Neat restyle* — a different, tidier hairstyle. This changes appearance, so it is **off by default** and clearly optional.

5.5 **Prevention first:** the upload screen guides the customer ("comb hair off the face, even lighting, look at the camera") because good input beats correction.

---

## 6. Pose, angle & capture

6.1 A head only blends naturally when its **angle matches the sample's body pose**. Therefore the gallery is curated to **near-frontal / slight-angle** poses; extreme angles are hidden (per §0).

6.2 **Customer capture spec** (to match the gallery's poses):
 - *Minimum:* one sharp, evenly-lit, front-facing photo — eyes open, hair off the face, no glare.
 - *Better:* three photos — straight-on, ~30° left, ~30° right.
 - *Best:* a 5–10 second video slowly turning the head left→right with a small nod; the system picks the frame whose angle best matches each sample.

---

## 7. Element labelling scheme (per sample)

Each gallery sample gets a master serial and sub-element records, each with a long descriptive field, stored in the database:

- `SG-###` — master record: scene name, category, thumbnail reference.
- `SG-###.BG` — **background**: location, architecture, objects, colour palette, depth/bokeh, time of day, lighting direction.
- `SG-###.SUIT` — **outfit**: garment type, exact colour + shade, fabric, lapel shape, buttons, shirt, tie/accessory.
- `SG-###.POSE` — **gesture / direction**: body angle, shoulder line, head tilt/turn, hands, seated/standing.
- `SG-###.SIZE` — **model size & position**: crop type, head height as % of frame, horizontal centre offset, headroom above the hair.
- `SG-###.LIGHT` — lighting temperature, contrast, key/fill.
- `SG-###.HEADBOX` — the head region (the target area the customer's head is placed into).

Everything except `.HEADBOX` is fixed and never regenerated — that is what guarantees "unchanged."

---

## 8. Cost, consent & payment

8.1 The customer sees a **watermarked** result first. Credits are charged **only** when they download or email a photo (watermark removed).

8.2 **Consent:** the only face we transform is the **customer's own**, by their choice, onto AI-generated (non-real) models. We do not swap third parties' faces.

8.3 **API spend is authorised per action.** No generation that costs money runs without the owner's clear go-ahead. Test/verification spend is disclosed and approved in advance.

8.4 Provider keys (face-swap, Gemini, Stripe, Resend) are entered by the owner into Cloudflare environment variables. Claude never sees or types the secret values.

---

## 9. Provider / infrastructure

9.1 **Proof stage:** Replicate face-swap (~US$0.006/image) — cheap validation of quality on the owner's real photo before any commitment.

9.2 **Production stage:** Segmind Faceswap v5 (has a proper **head-swap** mode with skin-tone matching) — the live engine once quality is approved.

9.3 The model runs on the provider's infrastructure. No face-swap model weights are hosted in Claude's workspace.

---

## 10. Process rules (before action)

10.1 **Prove before building.** Any new method is validated with a low-cost proof on a real photo before it becomes the pipeline.

10.2 **Verify before declaring done.** Every deploy is checked live (not assumed), with a real generation where relevant.

10.3 **Only expose the deliverable.** If a filter/combination has no reliable result, it is hidden.

10.4 **Full internationalisation.** Every new label, button, description and message is translated into all supported languages before it ships.

10.5 **Honesty over reassurance.** We state real limitations plainly; we do not promise a result we cannot reliably deliver.

---

## 11. Definition of a successful delivered photo

A photo is acceptable to deliver only if **all** are true:

- It looks genuinely like the customer (appearance and face shape preserved).
- The background, suit, pose, size and lighting match the chosen gallery sample.
- The head blends naturally (neck, scale, lighting) with no obvious seam.
- Any enhancement applied is light and did not alter the customer's identity.
- Hair is neat (as uploaded, or lightly tidied) and natural.

If any one fails, the result is not delivered and the flow/option is corrected or hidden.
