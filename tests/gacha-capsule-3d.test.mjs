import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const renderer = read("apps/mobile/src/features/draw/GachaCapsule3D.tsx");
const shaders = read("apps/mobile/src/features/draw/gacha-capsule-3d-shaders.ts");
const machine = read("apps/mobile/src/features/draw/GachaLeverMachine.tsx");

test("reference GL renderer avoids the frozen SDK54 experimental path and blocking probes", () => {
  assert.match(renderer, /createRenderer\(gl, wordmark.localUri\)/);
  assert.match(renderer, /gl\.endFrameEXP\(\)/);
  assert.doesNotMatch(renderer, /getWorkletContext|enableExperimentalWorkletSupport|readPixels|\.getError\(|\.finish\(|\.flushEXP\(|console\./);
  assert.match(renderer, /FRAME_INTERVAL_MS = 1000 \/ 30/);
});

test("the native GL surface itself is 176 physical pixels with no stale intermediate presentation pass", () => {
  assert.match(renderer, /PIXEL_RENDER_WIDTH = 176/);
  assert.match(renderer, /logicalWidth = PIXEL_RENDER_WIDTH \/ PixelRatio\.get\(\)/);
  assert.match(renderer, /logicalHeight = Math\.round\(PIXEL_RENDER_WIDTH \* viewportSize\.height \/ Math\.max\(1, viewportSize\.width\)\) \/ PixelRatio\.get\(\)/);
  assert.match(renderer, /width: logicalWidth, height: logicalHeight/);
  assert.match(renderer, /scale: Math\.max\(1, viewportSize\.width\) \/ logicalWidth/);
  assert.match(renderer, /gl\.bindFramebuffer\(gl\.FRAMEBUFFER, null\)/);
  assert.match(renderer, /gl\.clear\(gl\.COLOR_BUFFER_BIT\)/);
  assert.equal((renderer.match(/collapsable=\{false\}/g) ?? []).length, 2);
  assert.doesNotMatch(renderer, /createFramebuffer|framebufferTexture2D|presentProgram|PRESENT_SHADER/);
  assert.match(shaders, /pixelUv = \(floor\(vUv \* uResolution\) \+ 0\.5\) \/ uResolution/);
});

test("pre-rendered capsule mounts after measurement with stable native ancestors", () => {
  assert.match(machine, /import \{ GachaCapsuleFrames \}/);
  assert.doesNotMatch(machine, /import \{ GachaCapsule3D \}/);
  assert.match(machine, /\[stageSize, setStageSize\] = useState\(\{ width: 0, height: 0 \}\)/);
  assert.match(machine, /!threeUnavailable && !reduceMotion && stageSize\.width > 0 && stageSize\.height > 0/);
  assert.doesNotMatch(machine, /graphicsRequested/);
  assert.doesNotMatch(machine, /key=\{`\$\{stageSize\.width\}/);
  assert.match(machine, /<View collapsable=\{false\} style=\{styles\.container\}/);
  assert.match(machine, /<View collapsable=\{false\} style=\{styles\.machineSlot\} onLayout/);
  assert.match(machine, /<View[\s\S]*?collapsable=\{false\}[\s\S]*?style=\{styles\.cinematicLayer\}/);
  assert.match(machine, /<View collapsable=\{false\} style=\{styles\.cinematicThree\}/);
  assert.doesNotMatch(machine, /<Animated\.View[^>]*styles\.cinematicThree/);
});

test("3D loop stops on completion, cancellation, background and Reduced Motion without inventing a result", () => {
  assert.match(renderer, /cancelAnimationFrame\(frameHandle\.current\)/);
  assert.match(renderer, /run !== generation\.current \|\| !mounted\.current/);
  assert.match(renderer, /!foreground\.current \|\| options\.current\.reduceMotion \|\| active\.value <= 0/);
  assert.match(renderer, /if \(currentProgress >= 1\) \{\s*stopRendering\(\)/);
  assert.match(renderer, /disposeRenderer\(rendererRef\.current\)/);
  assert.doesNotMatch(renderer, /consumeDrawEntitlement|Math\.random|fetch\(/);
  assert.match(machine, /onUnavailable=\{handleThreeUnavailable\}/);
  assert.match(machine, /opacity: threeReady \|\| settled \? 0 : 1/);
});

test("opening preserves two perfectly spherical hollow halves with thin cut faces and smooth shading", () => {
  assert.match(shaders, /sphereRoots\(ro, rd, 1\.0\)/);
  assert.match(shaders, /sphereRoots\(ro, rd, INNER_RADIUS\)/);
  assert.doesNotMatch(shaders, /intersectProfile|gacha-capsule-profile/);
  assert.match(shaders, /intersectShell\(upperRo, upperRd, 1\.0\)/);
  assert.match(shaders, /intersectShell\(lowerRo, lowerRd, -1\.0\)/);
  assert.match(shaders, /radius >= INNER_RADIUS && radius <= COLLAR_RADIUS/);
  assert.match(shaders, /opening = uReveal.y/);
  assert.match(renderer, /light.seal, light.opening, light.innerLight/);
  assert.match(shaders, /targetRadius = max\(uProjection.z \/ max\(uViewWidth, 1\.0\), 0\.001\)/);
  assert.match(renderer, /sampleGachaCameraMotion\(frame.progress, frame.viewWidth, frame.viewHeight, false\)/);
  assert.doesNotMatch(shaders, /initialCenter|initialRadius|uOrigin/);
  assert.doesNotMatch(shaders, /orderedDither|floor\(clamp\(color/);
});

test("one capsule uses canonical PNG ink on its spherical lower half from pickup through opening", () => {
  assert.match(renderer, /require\("\.\.\/\.\.\/\.\.\/assets\/dabboba-wordmark\.png"\)/);
  assert.match(renderer, /Asset\.fromModule\(WORDMARK_ASSET\)\.downloadAsync\(\)/);
  assert.match(renderer, /localUri: wordmarkLocalUri/);
  assert.match(shaders, /longitude = atan\(localPoint\.x, localPoint\.z\)/);
  assert.match(shaders, /latitude = asin\(clamp\(localPoint\.y, -1\.0, 1\.0\)\)/);
  assert.match(shaders, /1\.36 \* 172\.0 \/ 1170\.0/);
  assert.match(shaders, /texture2D\(uWordmark, markUv\)/);
  assert.match(shaders, /base = mix\(base, mark\.rgb, ink\)/);
  assert.doesNotMatch(shaders, /outerD|innerD/);
  assert.match(renderer, /sampleGachaPickupMotion\(frame\.dispenseProgress, false\)/);
  assert.match(renderer, /camera\.capsuleX \+ pickup\.x \* pickupScale/);
  assert.match(renderer, /camera\.capsuleY \+ pickup\.y \* pickupScale/);
  assert.match(renderer, /pickup\.opacity \* light\.shellOpacity/);
  assert.match(renderer, /deleteTexture\(renderer\.wordmarkTexture\)/);
  assert.deepEqual(
    readFileSync(new URL("../apps/mobile/assets/dabboba-wordmark.png", import.meta.url)),
    readFileSync(new URL("../public/assets/dabboba/brand/dabboba-wordmark.png", import.meta.url)),
  );
});

test("light starts in the physical seal and is driven by the shared continuous reveal timeline", () => {
  assert.match(renderer, /sampleGachaRevealLighting\(frame\.progress, false\)/);
  assert.match(shaders, /crack = uReveal\.x/);
  assert.match(shaders, /opening = uReveal\.y/);
  assert.match(shaders, /energy = uReveal\.z/);
  assert.match(shaders, /emitterCenter = lowerCenter \+ lowerRotation \* vec3\(0\.0, -0\.08, 0\.0\)/);
  assert.match(shaders, /coreHit = intersectMouthLight\(lowerRo, lowerRd\)/);
  assert.doesNotMatch(shaders, /sphereRoots\(ro - emitterCenter/);
  assert.match(shaders, /toCore = emitterCenter - worldPoint/);
  assert.match(shaders, /bool coreVisible = energy > 0\.0 && coreHit < hit\.x/);
  assert.match(shaders, /if \(t <= 0\.001 \|\| length\(\(ro \+ t \* rd\).xz\) > 0\.84\) return FAR/);
  assert.ok(shaders.indexOf("if (coreVisible)") > shaders.indexOf("color = shadeShell("), "the soft emissive face is composited over the farther cavity, never overwritten by it");
  assert.match(shaders, /feather = 1\.0 - smoothstep\(0\.72, 1\.0, radial\)/);
  assert.doesNotMatch(shaders, /float pulse\(|pulse\(p,/);
});

test("native scenery and pre-rendered capsule share the UI clock without a GL presentation dependency", () => {
  assert.match(machine, /const cameraProgress = revealProgress/);
  assert.doesNotMatch(machine, /presentedCameraProgress/);
  assert.match(machine, /viewportSize=\{stageSize\}/);
  assert.match(renderer, /viewHeight: options.current.viewportSize.height/);
  assert.match(machine, /style=\{\[styles.pickupForegroundMachine, pickupForegroundStyle\]\}/);
  assert.match(machine, /sampleGachaCameraMotion\(cameraProgress.value, stageSize.width, stageSize.height/);
  assert.match(machine, /revealProgress.value = withDelay\([\s\S]*?scheduleOnRN\(handleRevealSettled, Boolean\(finished\), run\)/);
});
