import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAW_MOTION,
  advancePreviewRevealState,
  buildPreviewOpenActions,
  completePreviewRevealState,
  createKujiOpenMotionState,
  createPreviewResultItems,
  createPreviewRevealState,
  currentPreviewTicketIndex,
  resolveKujiDragProgress,
  resolvePreviewNextTicketAction,
  resolveKujiPeelRelease,
  resolveKujiTravelDuration,
  resolveKujiTravelSegments,
  selectHighestRankedResultId,
  startPreviewOpenAll,
  transitionKujiOpenMotion,
} from "../apps/mobile/src/features/draw/draw-reveal-state.ts";

test("kuji drag progress stays clamped and travel completion follows the remaining distance", () => {
  assert.equal(resolveKujiDragProgress(-20, 200), 0);
  assert.equal(resolveKujiDragProgress(50, 200), 0.25);
  assert.equal(resolveKujiDragProgress(240, 200), 1);
  assert.equal(resolveKujiDragProgress(50, 0), 0);
  assert.equal(resolveKujiDragProgress(Number.NaN, 200), 0);

  const startDuration = resolveKujiTravelDuration(0);
  const halfwayDuration = resolveKujiTravelDuration(0.5);
  const almostFinishedDuration = resolveKujiTravelDuration(0.95);
  assert.equal(startDuration, DRAW_MOTION.kujiTravelMaxMs);
  assert.equal(resolveKujiTravelDuration(1), DRAW_MOTION.kujiTravelMinMs);
  assert.ok(startDuration > halfwayDuration);
  assert.ok(halfwayDuration > almostFinishedDuration);
});

test("untouched kuji auto-open follows the reference hold, slow tear, and faster finish", () => {
  assert.deepEqual(resolveKujiTravelSegments(0), {
    holdMs: 280,
    slowTearMs: 540,
    fastTearMs: 350,
    splitProgress: 0.55,
  });
  assert.deepEqual(resolveKujiTravelSegments(0.55), {
    holdMs: 0,
    slowTearMs: 0,
    fastTearMs: 350,
    splitProgress: 0.55,
  });
  assert.deepEqual(resolveKujiTravelSegments(1), {
    holdMs: 0,
    slowTearMs: 0,
    fastTearMs: 0,
    splitProgress: 0.55,
  });
  assert.equal(
    DRAW_MOTION.kujiAutoHoldMs
      + DRAW_MOTION.kujiSlowTearMs
      + DRAW_MOTION.kujiFastTearMs
      + DRAW_MOTION.kujiResultHoldMs
      + DRAW_MOTION.kujiImpactMs,
    1570,
  );
  assert.equal(resolveKujiTravelSegments(0.25).holdMs, 0,
    "a user's direct drag must not replay the automatic opening pause");
  assert.equal(resolveKujiTravelSegments(0.25).slowTearMs, 295);
  assert.equal(resolveKujiTravelSegments(0.25).fastTearMs, 350);
});

test("kuji peel opens only after a deliberate rightward release", () => {
  assert.equal(resolveKujiPeelRelease(57, 100, 0), "reset");
  assert.equal(resolveKujiPeelRelease(58, 100, 0), "open");
  assert.equal(resolveKujiPeelRelease(18, 100, 0.64), "reset");
  assert.equal(resolveKujiPeelRelease(18, 100, 0.65), "open");
  assert.equal(resolveKujiPeelRelease(-80, 100, 2), "reset");
  assert.equal(resolveKujiPeelRelease(80, 0, 2), "reset");
  assert.equal(resolveKujiPeelRelease(Number.NaN, 100, 2), "reset");
});

test("kuji motion waits for both the committed result and travel before impact", () => {
  let transition = transitionKujiOpenMotion(
    createKujiOpenMotionState(false),
    { type: "request" },
  );
  assert.deepEqual(transition, {
    state: { phase: "finishing", resultReady: false, reduceMotion: false },
    effect: "request-and-animate",
  });

  const duplicateRequest = transitionKujiOpenMotion(transition.state, { type: "request" });
  assert.deepEqual(duplicateRequest, { state: transition.state, effect: "none" });

  transition = transitionKujiOpenMotion(transition.state, { type: "result-ready" });
  assert.deepEqual(transition, {
    state: { phase: "finishing", resultReady: true, reduceMotion: false },
    effect: "none",
  });

  transition = transitionKujiOpenMotion(
    transition.state,
    { type: "travel-settled", finished: true },
  );
  assert.deepEqual(transition, {
    state: { phase: "revealing", resultReady: true, reduceMotion: false },
    effect: "start-impact",
  });

  transition = transitionKujiOpenMotion(
    transition.state,
    { type: "impact-settled", finished: true },
  );
  assert.deepEqual(transition, {
    state: { phase: "revealed", resultReady: true, reduceMotion: false },
    effect: "notify-settled",
  });

  assert.deepEqual(
    transitionKujiOpenMotion(transition.state, { type: "impact-settled", finished: true }),
    { state: transition.state, effect: "none" },
  );
  assert.deepEqual(
    transitionKujiOpenMotion(transition.state, { type: "request" }),
    { state: transition.state, effect: "none" },
  );
});

test("a slow server result keeps the kuji sealed until the result can be revealed", () => {
  let transition = transitionKujiOpenMotion(
    createKujiOpenMotionState(false),
    { type: "request" },
  );

  transition = transitionKujiOpenMotion(
    transition.state,
    { type: "travel-settled", finished: true },
  );
  assert.deepEqual(transition, {
    state: { phase: "waiting-result", resultReady: false, reduceMotion: false },
    effect: "none",
  });

  transition = transitionKujiOpenMotion(transition.state, { type: "result-ready" });
  assert.deepEqual(transition, {
    state: { phase: "revealing", resultReady: true, reduceMotion: false },
    effect: "start-impact",
  });

  transition = transitionKujiOpenMotion(
    transition.state,
    { type: "impact-settled", finished: true },
  );
  assert.equal(transition.effect, "notify-settled");
  assert.equal(transition.state.phase, "revealed");
});

test("reduced motion still waits for the committed result and notifies only once", () => {
  let transition = transitionKujiOpenMotion(
    createKujiOpenMotionState(true),
    { type: "request" },
  );
  assert.deepEqual(transition, {
    state: { phase: "waiting-result", resultReady: false, reduceMotion: true },
    effect: "request-and-wait",
  });

  transition = transitionKujiOpenMotion(transition.state, { type: "result-ready" });
  assert.deepEqual(transition, {
    state: { phase: "revealed", resultReady: true, reduceMotion: true },
    effect: "notify-settled",
  });

  assert.deepEqual(
    transitionKujiOpenMotion(transition.state, { type: "result-ready" }),
    { state: transition.state, effect: "none" },
  );
  assert.deepEqual(
    transitionKujiOpenMotion(transition.state, { type: "request" }),
    { state: transition.state, effect: "none" },
  );
});

test("an already committed reduced-motion kuji still waits for explicit open and settles once", () => {
  const ready = transitionKujiOpenMotion(createKujiOpenMotionState(true), { type: "result-ready" });
  assert.equal(ready.state.phase, "sealed");
  assert.equal(ready.effect, "none");
  const opened = transitionKujiOpenMotion(ready.state, { type: "request" });
  assert.equal(opened.state.phase, "revealed");
  assert.equal(opened.effect, "notify-settled");
  assert.equal(transitionKujiOpenMotion(opened.state, { type: "request" }).effect, "none");
  assert.equal(transitionKujiOpenMotion(opened.state, { type: "result-ready" }).effect, "none");
});

test("enabling reduced motion mid-open skips impact without exposing an absent result", () => {
  let transition = transitionKujiOpenMotion(
    createKujiOpenMotionState(false),
    { type: "request" },
  );

  transition = transitionKujiOpenMotion(
    transition.state,
    { type: "reduce-motion", enabled: true },
  );
  assert.deepEqual(transition, {
    state: { phase: "waiting-result", resultReady: false, reduceMotion: true },
    effect: "none",
  });

  transition = transitionKujiOpenMotion(transition.state, { type: "result-ready" });
  assert.deepEqual(transition, {
    state: { phase: "revealed", resultReady: true, reduceMotion: true },
    effect: "notify-settled",
  });
});

test("reset clears result readiness while preserving the motion preference", () => {
  const waiting = transitionKujiOpenMotion(
    createKujiOpenMotionState(true),
    { type: "request" },
  );
  const ready = transitionKujiOpenMotion(waiting.state, { type: "result-ready" });

  assert.deepEqual(transitionKujiOpenMotion(ready.state, { type: "reset" }), {
    state: { phase: "sealed", resultReady: false, reduceMotion: true },
    effect: "reset",
  });
});

test("cancelled travel and impact callbacks never advance the reveal", () => {
  const requested = transitionKujiOpenMotion(
    createKujiOpenMotionState(false),
    { type: "request" },
  );
  assert.deepEqual(
    transitionKujiOpenMotion(requested.state, { type: "travel-settled", finished: false }),
    { state: requested.state, effect: "none" },
  );

  const ready = transitionKujiOpenMotion(requested.state, { type: "result-ready" });
  const revealing = transitionKujiOpenMotion(
    ready.state,
    { type: "travel-settled", finished: true },
  );
  assert.equal(revealing.state.phase, "revealing");
  assert.deepEqual(
    transitionKujiOpenMotion(revealing.state, { type: "impact-settled", finished: false }),
    { state: revealing.state, effect: "none" },
  );
});

test("one-by-one opening returns to a sealed ticket between results", () => {
  let state = createPreviewRevealState("single", 3);
  assert.deepEqual(state, { mode: "single", count: 3, openedCount: 0, phase: "sealed" });
  assert.equal(currentPreviewTicketIndex(state), 0);

  state = advancePreviewRevealState(state);
  assert.deepEqual(state, { mode: "single", count: 3, openedCount: 1, phase: "revealed" });
  assert.equal(currentPreviewTicketIndex(state), 0);

  state = advancePreviewRevealState(state);
  assert.deepEqual(state, { mode: "single", count: 3, openedCount: 1, phase: "sealed" });
  assert.equal(currentPreviewTicketIndex(state), 1);

  state = advancePreviewRevealState(state);
  state = advancePreviewRevealState(state);
  state = advancePreviewRevealState(state);
  assert.deepEqual(state, { mode: "single", count: 3, openedCount: 3, phase: "revealed" });

  state = advancePreviewRevealState(state);
  assert.deepEqual(state, { mode: "single", count: 3, openedCount: 3, phase: "summary" });
  assert.deepEqual(advancePreviewRevealState(state), state);
});

test("the next-ticket action prepares a sealed draggable ticket before it can auto-open", () => {
  const initial = createPreviewRevealState("single", 3);
  assert.equal(resolvePreviewNextTicketAction(initial), "open");
  assert.equal(buildPreviewOpenActions(initial).nextLabel, "1번째 쿠지 열기");

  const firstResult = advancePreviewRevealState(initial);
  assert.equal(resolvePreviewNextTicketAction(firstResult), "prepare");
  assert.equal(buildPreviewOpenActions(firstResult).nextLabel, "2번째 쿠지 선택");

  const secondTicket = advancePreviewRevealState(firstResult);
  assert.deepEqual(secondTicket, {
    mode: "single",
    count: 3,
    openedCount: 1,
    phase: "sealed",
  });
  assert.equal(resolvePreviewNextTicketAction(secondTicket), "open");
  assert.equal(buildPreviewOpenActions(secondTicket).nextLabel, "2번째 쿠지 열기");

  assert.equal(resolvePreviewNextTicketAction({ ...firstResult, openedCount: 3 }), "none");
  assert.equal(resolvePreviewNextTicketAction({ ...firstResult, phase: "summary" }), "none");
});

test("open-all reveals the complete result set in one action", () => {
  const initial = createPreviewRevealState("all", 50);
  const summary = advancePreviewRevealState(initial);

  assert.deepEqual(summary, { mode: "all", count: 50, openedCount: 50, phase: "summary" });
  assert.equal(createPreviewResultItems([], 50).length, 50);
  assert.deepEqual(completePreviewRevealState(initial), summary);
});

test("one-by-one reveal can switch the unopened kuji tickets to open-all", () => {
  let state = createPreviewRevealState("single", 7);

  assert.deepEqual(buildPreviewOpenActions(state), {
    nextLabel: "1번째 쿠지 열기",
    openAllLabel: "7개 한 번에 열기",
  });

  state = advancePreviewRevealState(state);
  assert.deepEqual(buildPreviewOpenActions(state), {
    nextLabel: "2번째 쿠지 선택",
    openAllLabel: "6개 한 번에 열기",
  });

  const batch = startPreviewOpenAll(state);
  assert.deepEqual(batch, {
    mode: "all",
    count: 7,
    openedCount: 1,
    phase: "sealed",
  });
  assert.deepEqual(advancePreviewRevealState(batch), {
    mode: "all",
    count: 7,
    openedCount: 7,
    phase: "summary",
  });

  assert.deepEqual(buildPreviewOpenActions(createPreviewRevealState("single", 1)), {
    nextLabel: "1번째 쿠지 열기",
    openAllLabel: null,
  });
});

test("preview result items preserve selected ticket numbers", () => {
  const items = createPreviewResultItems(["02", "17", "50"], 3);

  assert.deepEqual(items.map(({ ticketNumber }) => ticketNumber), ["02", "17", "50"]);
  assert.equal(new Set(items.map(({ id }) => id)).size, 3);
});

test("the featured committed result requires explicit server tier ranks", () => {
  const results = [
    { id: "b", rarity: "B" },
    { id: "s-first", rarity: "S" },
    { id: "a", rarity: "A" },
    { id: "s-second", rarity: "S" },
    { id: "unknown", rarity: "LAST" },
  ];

  assert.equal(selectHighestRankedResultId(results, { B: 3, S: 1, A: 2 }), "s-first");
  assert.equal(selectHighestRankedResultId(results, {}), "b");
});
