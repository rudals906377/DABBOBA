import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { resolveKujiFeedbackStage, resolveKujiPeelGrain } from "../apps/mobile/src/features/draw/kuji-reveal-feedback.ts";

const component = readFileSync(new URL("../apps/mobile/src/features/draw/KujiPeelTicket.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../apps/mobile/src/features/draw/useDrawRevealFeedback.ts", import.meta.url), "utf8");

test("paper separation and flutter follow the real departure, never an attached or invalid pose", () => {
  assert.equal(resolveKujiFeedbackStage(1, .001), 3);
  assert.equal(resolveKujiFeedbackStage(1, .199), 3);
  assert.equal(resolveKujiFeedbackStage(1, .2), 4);
  assert.equal(resolveKujiFeedbackStage(.9, 1), 2);
  assert.equal(resolveKujiPeelGrain(.01), 0);
  assert.equal(resolveKujiPeelGrain(.02), 1);
  assert.equal(resolveKujiPeelGrain(.20), 2);
  assert.equal(resolveKujiPeelGrain(.40), 3);
  assert.equal(resolveKujiPeelGrain(.55), 4);
  assert.equal(resolveKujiPeelGrain(.70), 5);
  assert.equal(resolveKujiPeelGrain(.85), 6);
  assert.equal(resolveKujiPeelGrain(1), 6);
  for (const n of [NaN, Infinity, -Infinity, -1]) assert.equal(resolveKujiPeelGrain(n), 0);
});

test("the actual native paper reaction follows forward fibers, holds, reversals and full detachment", () => {
  const callback = component.match(/\(\{ stage, grain, run \}, previous\) => \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(callback);
  const events = [];
  const scope = { feedbackGrainSequence: { value: 0 },
    playFeedback: (...args) => events.push(["stage", ...args]),
    playGrain: (...args) => events.push(["fiber", ...args]), scheduleOnRN: (fn, ...args) => fn(...args) };
  const react = runInNewContext(`(${callback})`, scope);
  let previous = { stage: 0, grain: 0, run: 2 };
  const move = (progress, flight = 0) => {
    const next = { stage: resolveKujiFeedbackStage(progress, flight), grain: resolveKujiPeelGrain(progress), run: 2 };
    react(next, previous); previous = next;
  };
  move(0); move(.02); move(.02); move(.20); move(.40);
  assert.deepEqual(events, [["stage", 1, 2], ["fiber", 1, 2, 1], ["fiber", 1, 2, 2]]);
  move(.30); move(.40);
  assert.deepEqual(events.at(-1), ["fiber", 1, 2, 3]);
  move(.56); move(.72); move(.9); move(1); move(1, .01); move(1, .19); move(1, .20); move(1, .8);
  assert.deepEqual(events.slice(-5), [["stage", 2, 2], ["fiber", 2, 2, 4], ["fiber", 2, 2, 5], ["stage", 3, 2], ["stage", 4, 2]]);
  const count = events.length;
  move(1, .8); move(.1, 0);
  assert.equal(events.length, count, "holding and rewinding emit no new texture");
  previous = { stage: 0, grain: 0, run: 2 }; events.length = 0;
  move(.9);
  assert.deepEqual(events, [["stage", 2, 2]], "a skipped frame emits only its current cue, not accumulated fibers");
  assert.match(component, /if \(run !== feedbackRun.value\) return;/);
});

test("repeated paper fibers and departure rustle never add vibration, while gacha strokes still do", async () => {
  const callback = hook.match(/\(cue: DrawFeedbackCue, occurrence: number\) => \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(callback);
  const events = [];
  const scope = { category: "kuji", Platform: { OS: "ios" },
    Haptics: { selectionAsync: async () => events.push("selection"), impactAsync: async (style) => events.push(style),
      ImpactFeedbackStyle: { Light: "light", Soft: "soft" } } };
  const vibrate = runInNewContext(`(${callback.replace(/: DrawFeedbackCue|: number/g, "")})`, scope);
  for (const cue of ["primary", "secondary", "tertiary"]) await vibrate(cue, 0);
  for (const cue of ["primary", "secondary", "flutter"]) await vibrate(cue, 2);
  await vibrate("flutter", 0);
  assert.deepEqual(events, ["soft", "selection", "light"]);
  scope.category = "gacha"; await vibrate("primary", 6);
  assert.deepEqual(events, ["soft", "selection", "light", "selection"]);
});
