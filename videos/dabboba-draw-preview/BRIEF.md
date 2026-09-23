---
workflow: general-video
flow: automation
storyboard: no
message: "Original DABBOBA objects, tactile and restrained motion."
destination: local-interactive-preview
aspect: 390x500
language: ko
length: gacha 4.2s; kuji direct manipulation plus 0.36–0.72s completion
---

## Intent

Build the approved interactive gacha and kuji concept inside Codex, separately from the app. No Higgsfield, cloud generation, publication, payments, API calls, actual prize selection, or inventory writes. Both results are fixed local samples clearly labeled as previews, not draw results. The latest revision is **kuji-only attached-front seam cleanup**: composite the original outer and front textures at their native 1517×1037 size before filtering the closed or still-attached flat face. Keep lifted paper on its existing alpha/material path. Preserve original PNGs, logo, colors, printed double border, arrow, barcode, curl curve, timing, lighting and sound. Gacha remains the approved 4.2-second continuous opening with its 1.80-second seal sound.

## Assets

- Native capsule shader: exact copy of `apps/mobile/src/features/draw/gacha-capsule-3d-shaders.ts`.
- Native empty pixel machine, canonical wordmark and the two kuji layers: byte-identical copies.
- Native gacha contact/open WAVs: copies; only playback excerpts and gain change.
- Native Galmuri and Noto Sans KR fonts: local copies.
- Gacha sample product: `assets/products/sample-maomao.png`, copied byte-identically from `/Users/kyoungmin/Desktop/DBB/상품사진/가챠/500엔/약사의 혼잣말 무규토/마오마오2.png`. It always represents the same preview sample, not an actual prize.
- Kuji sample product: `assets/products/sample-kuji-rabbit.jpeg`, copied byte-identically from `/Users/kyoungmin/Desktop/DBB/상품사진/가챠/실바니안 어드벤쳐 시리즈/아기 초콜릿 토끼와 티아라.jpeg`. Its image and short name stay inside the ticket with `시안 예시 · 실제 당첨 아님`.

## Customizations

- Preserve original capsule shape, lower green material, printed wordmark, and ticket artwork. **Previously approved gacha material, unchanged by the kuji seam cleanup:** use clean neutral ivory for the upper dome, rim, cavity and reflections; soften specular highlights and add a broad edge lift for a thin molded-plastic impression. This is a shading impression, not physical transmission or refraction. The preview-only shader leaves the native source unchanged, reduces the opening offset from 0.42 to 0.32, and gives the recessed inner glow a bright center with a depth gradient toward the rim.
- Preserve 8-bit identity through the original pixel machine, original wordmark and restrained pixel UI. Physical movement stays smooth, not stepped.
- Gacha: retain 0–0.50 fall; bounces at 0.50–0.89 (0.30-radius amplitude) and 0.89–1.10 (0.08-radius amplitude); settle/hold to 1.20. Keep the same push-in at 1.20–1.80. Seam separation and lid lift share one identical quintic progress at 1.86–3.30 (same 1.44s), with no separate quick seam stage. Light builds at 1.88–3.65 to the same 0.78 peak; whiteout is 3.30–4.00 (same 0.70s); result is 4.00–4.20 (same 0.20s ease-out). The phase remains opening until 3.30, then result reveal. Do not alter framing, brightness or separation.
- Skip entirely transparent render passes and reuse the atlas when its uniforms are identical. Preserve resolution, artwork and material; these implementation constraints do not imply a measured frame-rate improvement.
- Gacha skip cancels the current animation frame and all audio before showing that same fixed sample. Its visible label is `시안 예시 · 실제 당첨 아님`; there is no live prize or grade lookup.
- Kuji seam cleanup is limited to `scenes/kuji.mjs`: combine the original outer and front textures at 1517×1037, then filter the closed/still-attached flat face once. This targets the dark seam from separately filtered alpha layers producing 75% combined coverage at their shared edge. Do not change source PNGs or artwork; lifted paper keeps its existing alpha and material.
- Previously approved kuji motion is unchanged: immediate curl and continuous regrab from `startProgress + dx / width`; commit at 58% or 18% plus 650px/s, otherwise restore in 180ms. Completion duration is `0.36 + 0.36 * (1 - startProgress)` seconds. Peel uses cubic ease-out until `duration - 0.24`; settling spans peel-end −0.06 to +0.14, and result reveal spans peel-end to +0.20. Maximum completion is 0.72s.
- Preserve kuji's original orange front, camera, curl geometry, approved backside fine grain/broad shading and vertically centered boundary light. The fixed rabbit image and short name remain inside the orange frame. Kuji has no skip button because completion is already brief; gacha keeps its existing skip.
- Kuji capture releases at 65% at 0.90s, finishes the 0.486s completion at 1.386s, then holds through 1.62s.
- Opt-in audio; sound stops on reset/tab switch/background/gacha skip. Gacha cue times follow shared motion constants: contacts stay at 0.50, 0.89 and 1.10 seconds, and seal stays at 1.80, 60ms before the unified visible opening. Source waveform, diminishing gains and filters remain unchanged; the same first 0.14-second excerpt prevents contact overlap. Kuji's locally synthesized paper friction/tear is entirely unchanged.

## Notes

Original object design takes precedence over the earlier idea of a logo-free capsule. No new result text is baked into assets. Deterministic scenes share pure motion samplers with the interactive harness and the HyperFrames capture entry. The harness owns user input and elapsed playback; render-critical scene functions do not read clocks or input.

The latest GPU/browser review is a separate verification step, not implied by these implementation notes. Native app integration and physical-device behavior are not part of this preview deliverable.
