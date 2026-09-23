# HyperFrames Composition Project

## Approved DABBOBA preview boundary

- Latest outer-paper approval (2026-09-23): fill only the former black mounting gap with source-matched orange `#F25B1E`; replace the 4-native-pixel brown outline with a 1-native-pixel `#CE4B19` hairline and shallow bottom-edge shade. Preserve the shell dimensions/camera, original source artwork, printed white double border, pull-tab, ivory liner, curl, timing, audio and all gacha behavior. Keep the shell a hollow perimeter ring with only a 2-native-pixel overlap below the opaque artwork edge to prevent filtered corner cracks; never fill the transparent reveal cavity or cover the printed front. This supersedes earlier outer-stroke locks only and remains a browser-preview change, not native integration.
- Latest kuji interior approval (2026-09-23): preserve the source orange rim/leaf, camera, curl, timing, thresholds, sound and all gacha behavior. Add a stationary ivory paper liner derived only from the inverse original outer alpha, below the curl/shadows/local light. Hide it completely when closed; clip its exposure to the same fold and restore it under Reduced Motion at committed presentation. Use the original small wordmark and restrained printed registration marks, dark readable DOM result text, unchanged photo pixels and the truthful fixture disclosure. No fake grade, serial, prize, extra rounded card, loop or added delay. This preview pass is distinct from the separately requested native-app integration, which is not completed by editing this folder.
- Previous approval: **customer-review polish** (2026-09-23) supersedes only the timing/result-layout locks recorded below. Preserve total gacha 4.2 s, all 0–1.20 s motion, 0.60 s focus, final camera/material/separation and original assets/audio. Opening and seal now share cubic smoothstep 1.76–3.30; internal light is cubic 1.80–3.50 at unchanged peak .78; whiteout cubic 3.12–4.00; result 3.82–4.06 then hold through 4.20. Add only a small tray contact shadow before focus finishes. Kuji completion keeps its distance-aware duration/thresholds/settle/reveal boundaries but inherits bounded forward release velocity with monotonic quintic Hermite motion; larger result content stays within the original cavity. Actual-app integration was requested afterward and remains a separate implementation task; this preview is not app-integration proof. Earlier entries below describe the previous baseline, not the current timing contract.
- Keep this interactive prototype separate from the actual mobile app.
- Latest user approval on 2026-09-23 is **kuji-only attached-front seam cleanup** in `scenes/kuji.mjs`. Composite original outer/front textures at native 1517×1037, then filter the closed or still-attached flat front once; avoid the dark seam caused by separately filtered alpha edges combining to 75% coverage. Lifted paper keeps its existing alpha/material. Preserve source PNGs, logo, colors, printed double border, arrow, barcode, curl curve, camera, timing, light intensity, audio and all gacha behavior. Do not claim visual/regression verification from this implementation boundary.
- Previously approved gacha remains **4.2 seconds**. Preserve the previous 4.0-second opening/bounce polish and subsequent focus at 1.20–1.80. All motion before focus stays identical. Seam separation and lid lift use the exact same quintic progress at 1.86–3.30 (1.44s), not a separate quick seam stage. Keep light at 1.88–3.65 with peak 0.78, whiteout at 3.30–4.00 (0.70s), and result at 4.00–4.20 (0.20s ease-out). Opening phase ends at 3.30. Do not extend the timeline or change framing, height, brightness or effect count.
- Preserve original shader bytes in `scenes/capsule-shader.mjs`, the approved gacha material variant, 0.32 separation, camera framing/path, skip control and sample image. Preserve audio waveforms/gains/filters; contacts remain 0.50/0.89/1.10 and the shared seal cue stays at 1.80, 60ms before visible opening. Keep the previously approved kuji design and motion unchanged outside the attached-flat-face compositing path: orange front, camera, curl geometry, backside fine grain/broad shading, vertically centered boundary light, rabbit example and audio.
- Skip entirely transparent render passes and reuse the atlas when its uniforms are identical, without changing resolution, artwork, camera or material. Do not present these changes as measured frame-rate gains or completed GPU verification.
- Kuji regrab continues from `startProgress + dx / width`. Thresholds remain 58%, or 18% plus 650px/s, with 180ms canceled return. Completion is `0.36 + 0.36 * (1 - startProgress)` seconds, at most 0.72s; peel-end is duration −0.24 with cubic ease-out, settle spans peel-end −0.06 to +0.14, and reveal spans peel-end to +0.20. The 65% demo releases at 0.90s, completes at 1.386s and holds through 1.62s.
- Both sample product images are fixed local review fixtures labeled `시안 예시 · 실제 당첨 아님`; never randomize them or connect them to commerce. Keep the rabbit image and short name inside the orange ticket. Gacha alone has a skip button; do not add a kuji skip or change friction/tear audio.
- Latest GPU/browser/physical-device QA must be separately evidenced in `QA.md`; implementation notes do not imply those checks passed.

## Skills — USE THESE FIRST

**Always invoke the relevant skill before writing or modifying compositions.** Skills encode framework-specific patterns (e.g., `window.__timelines` registration, `data-*` attribute semantics, shader-compatible CSS rules) that are NOT in generic web docs. Skipping them produces broken compositions.

**Doing anything with HyperFrames?** Start at `/hyperframes` — it tells you what HyperFrames can do and which skill or workflow handles your intent (make a video, TTS / BGM, prep footage, author / animate, render, install blocks), confirms your brief up front (the intent layer), and routes every "make me a…" request (a video, a deck, a composition port) to the right workflow. Read it first, especially when there's no project context to orient you. The workflows it routes to:

- `/product-launch-video` — any **website** URL or brief / script → a product launch / SaaS / promo video, or a site tour / showcase featuring the site's own captured visuals.
- `/faceless-explainer` — arbitrary text (topic / article / notes), **no URL, no website capture** → 60-90s faceless explainer.
- `/embedded-captions` — an existing talking-head video (MP4) → the same footage with captions / subtitles added (rail + embed, or pure-cinematic embed); the footage itself is untouched.
- `/talking-head-recut` — an existing talking-head / interview / podcast video (MP4) → the same footage **packaged with designed graphic overlays** (kinetic titles, lower-thirds, data callouts, pull-quotes, side panels, pip) synced to the transcript; the clip plays unchanged underneath. (Plain captions/subtitles → `/embedded-captions`.)
- `/pr-to-video` — a GitHub PR (URL / `owner/repo#N` / "this PR") → 30-90s code-change explainer (changelog / feature reveal / fix / refactor).
- `/motion-graphics` — a short (typically under 10s) design-led **motion graphic**, motion-is-the-message, no narration: kinetic type, a stat / number count-up, a chart, a logo sting, a lower-third / overlay, or an animated tweet / headline / captured-page highlight; rendered to MP4 or a transparent overlay. Longer / narrated / custom → `/general-video`.
- `/music-to-video` — a **music track** (audio file, video to pull audio from, or one generated from a mood brief) → beat-synced video (lyric / slideshow / kinetic promo). Music drives pacing; user-supplied images / videos are cut onto the same beat grid.
- `/slideshow` — a **presentation / pitch deck / interactive deck** — discrete slides, fragment reveals, branching, hotspot navigation, presenter mode. Output is a navigable deck, not a rendered video.
- `/general-video` — fallback for any other video (title card, longer brand / sizzle reel, multi-scene montage, static loop, custom composition) and the home of **companion mode** — co-create with the full HyperFrames toolbox; the original hyperframes authoring flow, any length.

**Porting an existing composition?** `/remotion-to-hyperframes` translates a Remotion (React) composition into HyperFrames HTML — a source migration, separate from the creation workflows above.

The domain skills (`/hyperframes-core`, `/hyperframes-animation`, `/hyperframes-keyframes`, `/hyperframes-creative`, `/hyperframes-cli`, `/media-use`, `/hyperframes-audio`, `/hyperframes-registry`, `/figma`) and the full capability map live inside `/hyperframes` — it is the single source of truth for which skill handles which intent.

**Changing how real footage or images look or reveal?** Load `/media-use` and read its `references/media-treatments.md` before editing, even when the request only says dark, flat, boring, retro, private, or “make the reveal cooler.” It governs how footage is treated, never whether media may be used. Use canonical media treatments and seek-safe motion; do not improvise equivalent CSS/SVG filters or overlays.

> **Tailwind v4 projects** (`hyperframes init --tailwind`): see `/hyperframes-core` → `references/tailwind.md`.

> **Skill missing or stale?** Run `npx hyperframes skills update <name>` to install/refresh
> the specific skill you need (the `/hyperframes` router does this automatically before
> entering a workflow), or bare `npx hyperframes skills update` to refresh the core set plus
> everything already installed — neither pulls the full set. Restart the agent session so
> newly installed skills load.

## Commands

```bash
npm run dev          # human-operated foreground preview (blocks until stopped)
npx hyperframes preview --background  # agent-safe persistent Studio preview
npx hyperframes preview --status      # verify the persistent preview is listening
npx hyperframes preview --stop        # stop it when review is finished
npm run check        # lint + runtime + layout + motion + contrast (one command)
npm run render       # render to MP4
npm run publish      # publish and get a shareable link
npx hyperframes lint --verbose  # include info-level findings
npx hyperframes lint --json     # machine-readable output for CI
npx hyperframes docs <topic> # reference docs in terminal
```

> **Agents must use `npx hyperframes preview --background` for Studio handoff.** Do not rely
> on a shell/tool `run_in_background` wrapper around `npm run dev`: that foreground process
> remains owned by the invoking session and can disappear while the browser stays open,
> leaving refreshes at `ERR_CONNECTION_TIMED_OUT`. Verify with `preview --status`, keep it
> alive through review, and stop it explicitly with `preview --stop` afterward.

> **Pinned CLI version.** These scripts pin an exact `hyperframes@X.Y.Z` so this project re-renders identically over time. Weeks later that pin lags fixes shipped since. To move up: `npx hyperframes@latest upgrade --project . --check` (shows the delta), then `npx hyperframes@latest upgrade --project .` to rewrite the pins. Always unpinned — the pinned script re-runs the old version against itself.

## Documentation

**For quick reference**, use the local CLI docs command (no network required):

```bash
npx hyperframes docs <topic>
```

Topics: `data-attributes`, `gsap`, `compositions`, `rendering`, `examples`, `troubleshooting`

**For full documentation**, discover pages via the machine-readable index — do NOT guess URLs:

```
https://hyperframes.heygen.com/llms.txt
```

## Project Structure

- `index.html` — main composition (root timeline)
- `compositions/` — sub-compositions referenced via `data-composition-src`
- `meta.json` — project metadata (id, name)
- `transcript.json` — whisper word-level transcript (if generated)

## Linting — ALWAYS RUN AFTER CHANGES

After creating or editing any `.html` composition, **always** run the full check before considering the task complete:

```bash
npm run check
```

Fix all errors before presenting the result. Warnings should be reviewed before rendering.

## Key Rules

1. Every timed element needs `data-start` and a duration. `data-start` is what marks it as timed; `data-track-index` is an optional Studio display lane the render never reads
2. Give timed visual elements `class="clip"`. The framework keys visibility off `data-start`, not the class, but the shared `.clip` CSS is what gives a scene its full-frame box, and `lint` warns without it
3. Register one paused root timeline per composition on `window.__timelines`:
   ```js
   window.__timelines = window.__timelines || {};
   window.__timelines["composition-id"] = gsap.timeline({ paused: true });
   ```
   Scene timelines manually added to this root must not be paused. A paused
   child does not advance when the root is seeked. The runtime activates
   registered composition siblings, not arbitrary nested scene timelines.
4. Videos use `muted` with a separate `<audio>` element for the audio track
5. Sub-compositions use `data-composition-src="compositions/file.html"` to reference other HTML files
6. Only deterministic logic — no `Date.now()`, no `Math.random()`, no network fetches
