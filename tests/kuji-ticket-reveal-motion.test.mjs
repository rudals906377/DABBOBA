import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isKujiResultGateOpen,
  sampleKujiTicketRevealMotion,
} from "../apps/mobile/src/features/draw/kuji-ticket-reveal-motion.ts";
import { sampleKujiPeelPaperMotion } from "../apps/mobile/src/features/draw/kuji-peel-paper-motion.ts";

const componentSource = readFileSync(
  new URL("../apps/mobile/src/features/draw/KujiPeelTicket.tsx", import.meta.url),
  "utf8",
);

test("the server result gate keeps a pre-mounted kuji prize fully hidden", () => {
  for (const progress of [0, 0.25, 0.7, 1, NaN, Infinity, -Infinity]) {
    assert.deepEqual(sampleKujiTicketRevealMotion(progress, false), {
      glowOpacity: 0,
      glowScale: 1,
      ticketOpacity: 1,
      ticketTranslateY: 0,
      resultOpacity: 0,
      resultTranslateY: 18,
    });
  }
});

test("preloaded results stay sealed until a real reveal starts", () => {
  for (const phase of ["sealed", "finishing", "waiting-result"]) {
    assert.equal(isKujiResultGateOpen(phase, true, false), false);
  }
  assert.equal(isKujiResultGateOpen("revealing", true, false), true);
  assert.equal(isKujiResultGateOpen("revealed", true, false), true);
  assert.equal(isKujiResultGateOpen("revealing", false, false), false);
  assert.equal(
    isKujiResultGateOpen("revealed", false, true),
    true,
    "the completed preview must hold its final frame after resultReady resets",
  );
});

test("the handoff lifts the opened ticket and settles the fixed result without a flash or bounce", () => {
  const frames = [0, 0.18, 0.36, 0.64, 0.86, 1]
    .map((progress) => sampleKujiTicketRevealMotion(progress, true));

  assert.deepEqual(frames[0], {
    glowOpacity: 0,
    glowScale: 1,
    ticketOpacity: 1,
    ticketTranslateY: -0,
    resultOpacity: 0,
    resultTranslateY: 18,
  });
  assert.ok(frames[2].resultOpacity > 0, "the fixed result should ease in before the cover is gone");
  assert.equal(frames[2].ticketOpacity, 1);
  assert.ok(frames[3].ticketOpacity < 1);

  for (let index = 1; index < frames.length; index += 1) {
    assert.equal(frames[index].glowOpacity, 0);
    assert.equal(frames[index].glowScale, 1);
    assert.ok(frames[index].ticketOpacity <= frames[index - 1].ticketOpacity);
    assert.ok(frames[index].ticketTranslateY <= frames[index - 1].ticketTranslateY);
    assert.ok(frames[index].resultOpacity >= frames[index - 1].resultOpacity);
    assert.ok(frames[index].resultTranslateY <= frames[index - 1].resultTranslateY);
  }
});

test("all sampled values remain finite and bounded", () => {
  for (const progress of [NaN, -Infinity, Infinity, -2, 0, 0.1, 0.5, 0.9, 1, 4]) {
    const frame = sampleKujiTicketRevealMotion(progress, true);
    for (const [key, value] of Object.entries(frame)) {
      assert.ok(Number.isFinite(value), `${key} must remain finite at ${progress}`);
    }
    assert.ok(frame.glowOpacity >= 0 && frame.glowOpacity <= 1);
    assert.equal(frame.glowScale, 1);
    assert.ok(frame.ticketOpacity >= 0 && frame.ticketOpacity <= 1);
    assert.ok(frame.ticketTranslateY >= -34 && frame.ticketTranslateY <= 0);
    assert.ok(frame.resultOpacity >= 0 && frame.resultOpacity <= 1);
    assert.ok(frame.resultTranslateY >= 0 && frame.resultTranslateY <= 18);
  }

  assert.deepEqual(
    sampleKujiTicketRevealMotion(-10, true),
    sampleKujiTicketRevealMotion(0, true),
  );
  assert.deepEqual(
    sampleKujiTicketRevealMotion(10, true),
    sampleKujiTicketRevealMotion(1, true),
  );
});

test("the finite payoff holds one stable final result", () => {
  const finalFrame = sampleKujiTicketRevealMotion(1, true);
  assert.deepEqual(finalFrame, {
    glowOpacity: 0,
    glowScale: 1,
    ticketOpacity: 0,
    ticketTranslateY: -34,
    resultOpacity: 1,
    resultTranslateY: 0,
  });
  assert.deepEqual(sampleKujiTicketRevealMotion(2, true), finalFrame);
});

test("Reduced Motion removes glow and immediately settles only after the gate", () => {
  assert.equal(sampleKujiTicketRevealMotion(1, false, true).resultOpacity, 0);
  for (const progress of [0, 0.5, 1, NaN, Infinity]) {
    assert.deepEqual(sampleKujiTicketRevealMotion(progress, true, true), {
      glowOpacity: 0,
      glowScale: 1,
      ticketOpacity: 0,
      ticketTranslateY: 0,
      resultOpacity: 1,
      resultTranslateY: 0,
    });
  }
});

test("the paper sampler keeps the prize fixed while the cover peels and its white back folds", () => {
  const sealed = sampleKujiPeelPaperMotion(0);
  const dragStarted = sampleKujiPeelPaperMotion(0, true);
  const firstFold = sampleKujiPeelPaperMotion(0.5);
  const wideFold = sampleKujiPeelPaperMotion(0.75);
  const opened = sampleKujiPeelPaperMotion(1);

  assert.equal(sealed.coverTravelRatio, 0);
  assert.equal(sealed.foldOpacity, 0);
  assert.ok(dragStarted.foldOpacity > 0,
    "the paper curl must appear as soon as a horizontal drag becomes active");
  assert.ok(dragStarted.foldShadowOpacity > 0,
    "the immediate curl should include its depth shadow");
  assert.ok(firstFold.coverTravelRatio > 0);
  assert.ok(firstFold.foldOpacity > 0);
  assert.ok(wideFold.foldScaleX > firstFold.foldScaleX);
  assert.ok(wideFold.foldShadowOpacity > 0);
  assert.equal(opened.coverTravelRatio, 1.12);
  assert.ok(Math.abs(opened.coverOpacity - 0.1) < Number.EPSILON * 4);
  assert.equal(opened.foldOpacity, 0);
  assert.ok(opened.coverRotationDeg < 0 && opened.coverRotationDeg >= -0.8);

  assert.ok(
    sampleKujiPeelPaperMotion(0.5, true).edgeLightOpacity
      > sampleKujiPeelPaperMotion(0.5, false).edgeLightOpacity,
    "an active drag may strengthen only the moving paper edge cue",
  );
});

test("paper peel samples stay finite, clamped, and spatially still under Reduced Motion", () => {
  for (const progress of [NaN, -Infinity, Infinity, -3, 0, 0.43, 0.8, 1, 4]) {
    const frame = sampleKujiPeelPaperMotion(progress, true);
    for (const [key, value] of Object.entries(frame)) {
      assert.ok(Number.isFinite(value), `${key} must remain finite at ${progress}`);
    }
    assert.ok(frame.coverTravelRatio >= 0 && frame.coverTravelRatio <= 1.12);
    assert.ok(frame.coverRotationDeg >= -0.8 && frame.coverRotationDeg <= 0);
    assert.ok(frame.coverOpacity >= 0.1 - Number.EPSILON && frame.coverOpacity <= 1);
    assert.ok(frame.foldScaleX >= 0 && frame.foldScaleX <= 1);
    assert.ok(frame.foldOpacity >= 0 && frame.foldOpacity <= 1);
    assert.ok(frame.foldShadowOpacity >= 0 && frame.foldShadowOpacity <= 0.3);
    assert.ok(frame.edgeLightOpacity >= 0 && frame.edgeLightOpacity <= 0.5);
  }

  assert.deepEqual(sampleKujiPeelPaperMotion(-10), sampleKujiPeelPaperMotion(0));
  assert.deepEqual(sampleKujiPeelPaperMotion(10), sampleKujiPeelPaperMotion(1));
  assert.deepEqual(sampleKujiPeelPaperMotion(0.8, true, true), {
    coverTravelRatio: 0,
    coverRotationDeg: 0,
    coverOpacity: 1,
    foldScaleX: 0,
    foldOpacity: 0,
    foldShadowOpacity: 0,
    edgeLightOpacity: 0,
  });
  assert.deepEqual(sampleKujiPeelPaperMotion(1, true, true), {
    coverTravelRatio: 1.12,
    coverRotationDeg: 0,
    coverOpacity: 0,
    foldScaleX: 0,
    foldOpacity: 0,
    foldShadowOpacity: 0,
    edgeLightOpacity: 0,
  });
});

test("reset and unmount invalidate stale travel and payoff callbacks", () => {
  assert.match(componentSource, /const runGenerationRef = useRef\(0\)/);
  assert.match(
    componentSource,
    /scheduleOnRN\(handleTravelSettled, generation, Boolean\(finished\)\)/,
  );
  assert.match(
    componentSource,
    /scheduleOnRN\(handleImpactSettled, generation, Boolean\(finished\)\)/,
  );
  assert.match(
    componentSource,
    /if \(generation !== runGenerationRef\.current\) return;/,
  );
  assert.ok(
    componentSource.match(/runGenerationRef\.current \+= 1;/g)?.length >= 3,
    "new runs, resets, and unmounts must invalidate older callbacks",
  );
});

test("the restrained edge cue follows the paper boundary and stays clipped", () => {
  assert.match(componentSource, /const dragging = useSharedValue\(0\)/);
  assert.match(componentSource, /\.onStart\(\(\) => \{\s*dragging\.value = 1;/);
  assert.match(componentSource, /\.onFinalize\(\(\) => \{\s*dragging\.value = 0;/);
  assert.match(componentSource, /style=\{styles\.ticketGlowClip\}/);
  assert.match(
    componentSource,
    /ticketGlowClip: \{[\s\S]*?overflow: "hidden"/,
  );
  assert.match(
    componentSource,
    /frame\.coverTravelRatio \* ticketWidth - 10/,
  );
  assert.match(componentSource, /styles\.ticketPeelEdgeGlow,[\s\S]*?peelEdgeGlowStyle/);
  assert.match(
    componentSource,
    /withDelay\(\s*DRAW_MOTION\.kujiResultHoldMs,[\s\S]*?duration: DRAW_MOTION\.kujiImpactMs, easing: Easing\.out\(Easing\.cubic\)/,
  );
  assert.doesNotMatch(
    componentSource,
    /IMPACT_PARTICLES|impactFlash|ticketPayoffGlow|withSpring|KUJI_TICKET_GLOW/,
  );
});

test("the peel claims early horizontal intent and tells the parent scroll when it owns the drag", () => {
  assert.match(componentSource, /activeOffsetX\(\[-4, 4\]\)/);
  assert.match(componentSource, /failOffsetY\(\[-8, 8\]\)/);
  assert.match(componentSource, /onDragActiveChange\?: \(active: boolean\) => void/);
  assert.match(componentSource, /scheduleOnRN\(notifyDragActive, true\)/);
  assert.match(componentSource, /scheduleOnRN\(notifyDragActive, false\)/);
});

test("the stationary result underlay, orange cover, and three-tone paper fold keep stable stacking", () => {
  const resultIndex = componentSource.indexOf('<View style={styles.resultTicketLayer}>');
  const outerIndex = componentSource.indexOf('<View pointerEvents="none" style={styles.ticketOuterLayer}>');
  const peelIndex = componentSource.indexOf('<Animated.View style={[styles.ticketPeelLayer, peelLayerStyle]}>');
  assert.ok(resultIndex >= 0 && resultIndex < outerIndex && outerIndex < peelIndex);
  assert.match(
    componentSource,
    /ticketShell: \{[\s\S]*?backgroundColor: "transparent"/,
  );
  assert.match(
    componentSource,
    /style=\{\[styles\.ticketPeelEdgeGlow, \{[\s\S]*?top: -ticketWidth \/ 1\.46 \* 0\.05,[\s\S]*?height: ticketWidth \/ 1\.46 \* 1\.1,[\s\S]*?\}, peelEdgeGlowStyle\]\}/,
  );
  assert.match(
    componentSource,
    /ticketPeelEdgeGlow: \{[\s\S]*?left: 0,[\s\S]*?width: 20,/,
  );
  assert.match(componentSource, /styles\.paperFold,[\s\S]*?paperFoldStyle/);
  assert.match(componentSource, /styles\.paperFoldShadow, paperFoldShadowStyle/);
  assert.match(componentSource, /styles\.paperFoldMidtone/);
  assert.match(componentSource, /styles\.paperFoldHighlight/);
  assert.match(
    componentSource,
    /<View collapsable=\{false\} pointerEvents="none" style=\{styles\.ticketGlowClip\}>/,
  );
  assert.match(
    componentSource,
    /<Animated\.View collapsable=\{false\} pointerEvents="none" style=\{\[styles\.ticketSurface, ticketRevealStyle\]\}>/,
  );
  assert.match(componentSource, /ticketGlowClip: \{[\s\S]*?zIndex: 3,/);
  assert.match(componentSource, /ticketSurface: \{[\s\S]*?zIndex: 2,/);
  assert.doesNotMatch(componentSource, /ticketPayoffGlow|KUJI_TICKET_GLOW/);
});
