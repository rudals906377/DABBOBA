import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isKujiResultGateOpen,
  sampleKujiTicketRevealMotion,
} from "../apps/mobile/src/features/draw/kuji-ticket-reveal-motion.ts";

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
      resultOpacity: 0,
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

test("the payoff orders warm light, ticket fade, and result fade", () => {
  const light = sampleKujiTicketRevealMotion(0.18, true);
  const ticketFade = sampleKujiTicketRevealMotion(0.36, true);
  const resultFade = sampleKujiTicketRevealMotion(0.64, true);

  assert.ok(light.glowOpacity > 0.7);
  assert.equal(light.ticketOpacity, 1);
  assert.equal(light.resultOpacity, 0);

  assert.ok(ticketFade.glowOpacity > 0);
  assert.ok(ticketFade.ticketOpacity < 1);
  assert.equal(ticketFade.resultOpacity, 0);

  assert.ok(resultFade.ticketOpacity < 0.01);
  assert.ok(resultFade.resultOpacity > 0);
});

test("all sampled values remain finite and bounded", () => {
  for (const progress of [NaN, -Infinity, Infinity, -2, 0, 0.1, 0.5, 0.9, 1, 4]) {
    const frame = sampleKujiTicketRevealMotion(progress, true);
    for (const [key, value] of Object.entries(frame)) {
      assert.ok(Number.isFinite(value), `${key} must remain finite at ${progress}`);
    }
    assert.ok(frame.glowOpacity >= 0 && frame.glowOpacity <= 1);
    assert.ok(frame.glowScale >= 0.78 && frame.glowScale <= 1.08);
    assert.ok(frame.ticketOpacity >= 0 && frame.ticketOpacity <= 1);
    assert.ok(frame.resultOpacity >= 0 && frame.resultOpacity <= 1);
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
    glowScale: 1.08,
    ticketOpacity: 0,
    resultOpacity: 1,
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
      resultOpacity: 1,
    });
  }
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

test("the warm edge light follows the actual peel boundary and stays clipped", () => {
  assert.match(componentSource, /style=\{styles\.ticketGlowClip\}/);
  assert.match(
    componentSource,
    /ticketGlowClip: \{[\s\S]*?overflow: "hidden"/,
  );
  assert.match(
    componentSource,
    /translateX: dragProgress\.value \* \(ticketWidth \+ 34\) - 18/,
  );
  assert.match(componentSource, /styles\.ticketPeelEdgeGlow,[\s\S]*?peelEdgeGlowStyle/);
  assert.match(componentSource, /duration: DRAW_MOTION\.kujiImpactMs, easing: Easing\.linear/);
  assert.doesNotMatch(componentSource, /IMPACT_PARTICLES|impactFlash|committedResultStyle/);
});

test("both native glow images keep measured numeric geometry and stable sibling stacking", () => {
  assert.match(
    componentSource,
    /style=\{\[styles\.ticketPayoffGlow, \{[\s\S]*?left: ticketWidth \* 0\.14,[\s\S]*?top: \(ticketWidth \/ 1\.46 - ticketWidth \* 0\.72\) \/ 2,[\s\S]*?width: ticketWidth \* 0\.72,[\s\S]*?height: ticketWidth \* 0\.72,[\s\S]*?\}, glowStyle\]\}/,
  );
  assert.match(
    componentSource,
    /style=\{\[styles\.ticketPeelEdgeGlow, \{[\s\S]*?top: -ticketWidth \/ 1\.46 \* 0\.05,[\s\S]*?height: ticketWidth \/ 1\.46 \* 1\.1,[\s\S]*?\}, peelEdgeGlowStyle\]\}/,
  );
  assert.match(
    componentSource,
    /ticketPeelEdgeGlow: \{[\s\S]*?left: 0,[\s\S]*?width: 44,/,
  );
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
});
