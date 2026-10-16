import assert from "node:assert/strict";
import test from "node:test";
import { createDrawFeedbackController } from "../apps/mobile/src/features/draw/draw-feedback-controller.ts";
import { resolveKujiFeedbackStage } from "../apps/mobile/src/features/draw/kuji-reveal-feedback.ts";
import { readDrawSoundEnabled, writeDrawSoundEnabled, readDrawHapticsEnabled, writeDrawHapticsEnabled } from "../apps/mobile/src/lib/local-database.ts";

function fixture(seek = async () => {}) {
  const options = { sound: true, haptics: true, foreground: true };
  const events = [];
  const player = { seekTo: seek, play: () => events.push("play"), pause: () => events.push("pause") };
  const controller = createDrawFeedbackController({ primary: player }, () => options, async (cue) => { events.push(`haptic:${cue}`); });
  return { options, events, controller };
}

test("feedback starts only after explicit arming and fires each material cue once per run", async () => {
  const { controller, events } = fixture();
  await controller.emit("primary", 1);
  assert.deepEqual(events, []);
  for (const invalid of [-1, NaN, Infinity, 0.5]) {
    controller.begin(invalid);
    await controller.emit("primary", invalid);
  }
  assert.deepEqual(events, []);
  controller.begin(1);
  await controller.emit("primary", 1);
  await controller.emit("primary", 1);
  assert.equal(events.filter((e) => e === "play").length, 1);
  assert.equal(events.filter((e) => e === "haptic:primary").length, 1);
});

test("cancellation silences players and invalidates a seek already in flight", async () => {
  let complete;
  const { controller, events } = fixture(() => new Promise((resolve) => { complete = resolve; }));
  controller.begin(1);
  const pending = controller.emit("primary", 1);
  controller.cancel();
  complete();
  await pending;
  assert.ok(events.includes("pause"));
  assert.ok(!events.includes("play"));
  await controller.emit("primary", 1);
  assert.equal(events.filter((e) => e.startsWith("haptic")).length, 1);
});

test("new runs reject both stale cues and old seek completions", async () => {
  const completions = [];
  const { controller, events } = fixture(() => new Promise((resolve) => completions.push(resolve)));
  controller.begin(1);
  const old = controller.emit("primary", 1);
  controller.begin(2);
  controller.begin(1);
  await controller.emit("primary", 1);
  const current = controller.emit("primary", 2);
  completions[0](); await old;
  assert.ok(!events.includes("play"));
  completions[1](); await current;
  assert.equal(events.filter((e) => e === "play").length, 1);
});

test("each new lever movement can sound within one run, but duplicate and stale occurrences cannot", async () => {
  const { controller, events } = fixture();
  controller.begin(1);
  for (const occurrence of [1, 1, 2, 1, 3, NaN, -1, Infinity, .5]) {
    await controller.emit("primary", 1, occurrence);
  }
  assert.equal(events.filter((e) => e === "play").length, 3);
  assert.equal(events.filter((e) => e === "haptic:primary").length, 3);
  controller.cancel();
  await controller.emit("primary", 1, 4);
  assert.equal(events.filter((e) => e === "play").length, 3);
});

test("a newer lever sector supersedes an older pending seek without a late audio restart", async () => {
  const completions = [];
  const { controller, events } = fixture(() => new Promise((resolve) => completions.push(resolve)));
  controller.begin(1);
  const old = controller.emit("primary", 1, 1);
  const current = controller.emit("primary", 1, 2);
  completions[1](); await current;
  completions[0](); await old;
  assert.equal(events.filter((e) => e === "play").length, 1);
});

test("muting an in-flight sound keeps haptics independent and prevents late playback after unmute", async () => {
  let complete;
  const { controller, options, events } = fixture(() => new Promise((resolve) => { complete = resolve; }));
  controller.begin(1);
  const pending = controller.emit("primary", 1);
  options.sound = false; controller.stopSound();
  options.sound = true;
  complete(); await pending;
  assert.ok(!events.includes("play"));
  assert.ok(events.includes("haptic:primary"));
  await controller.emit("primary", 1);
  assert.ok(!events.includes("play"), "unmuting must not replay an already passed cue");
});

test("background or blur cancels feedback and foregrounding does not catch up old cues", async () => {
  const { controller, options, events } = fixture();
  controller.begin(1);
  options.foreground = false; controller.cancel();
  await controller.emit("primary", 1);
  options.foreground = true;
  await controller.emit("primary", 1);
  assert.ok(!events.includes("play"));
  controller.begin(2); await controller.emit("primary", 2);
  assert.ok(events.includes("play"));
});

test("sound and haptic preferences can be disabled separately", async () => {
  const { controller, options, events } = fixture();
  options.haptics = false;
  controller.begin(1); await controller.emit("primary", 1);
  assert.ok(events.includes("play"));
  assert.ok(!events.some((e) => e.startsWith("haptic")));
  options.sound = false; options.haptics = true;
  controller.begin(2); await controller.emit("primary", 2);
  assert.equal(events.filter((e) => e === "play").length, 1);
  assert.ok(events.includes("haptic:primary"));
});

test("failed or unavailable native feedback never rejects the presentation", async () => {
  const broken = createDrawFeedbackController({ primary: { seekTo: async () => { throw Error("missing"); },
    play: () => { throw Error("released"); }, pause: () => { throw Error("released"); } } },
  () => ({ sound: true, haptics: true, foreground: true }), async () => { throw Error("unsupported"); });
  broken.begin(1);
  await assert.doesNotReject(broken.emit("primary", 1));
  assert.doesNotThrow(() => broken.cancel());
});

test("Kuji sound stages follow material movement rather than mount, result readiness or elapsed JS time", () => {
  assert.equal(resolveKujiFeedbackStage(0, 0), 0);
  assert.equal(resolveKujiFeedbackStage(0.005, 0), 0);
  assert.equal(resolveKujiFeedbackStage(0.02, 0), 1);
  assert.equal(resolveKujiFeedbackStage(0.55, 0), 2);
  assert.equal(resolveKujiFeedbackStage(1, 0), 2);
  assert.equal(resolveKujiFeedbackStage(1, 0.001), 3);
  assert.equal(resolveKujiFeedbackStage(0.9, 1), 2, "attached paper must not play its departure sound");
  for (const value of [NaN, Infinity, -Infinity, -1]) assert.equal(resolveKujiFeedbackStage(value, 0), 0);
});

test("sound and vibration settings persist in independent local preference keys", async () => {
  const rows = new Map();
  const db = { getFirstAsync: async (_query, key) => rows.has(key) ? { preference_value: rows.get(key) } : null,
    runAsync: async (_query, key, value) => { rows.set(key, value); } };
  assert.equal(await readDrawSoundEnabled(db), true);
  assert.equal(await readDrawHapticsEnabled(db), true);
  await writeDrawSoundEnabled(db, false);
  assert.equal(await readDrawSoundEnabled(db), false);
  assert.equal(await readDrawHapticsEnabled(db), true);
  await writeDrawHapticsEnabled(db, false);
  await writeDrawSoundEnabled(db, true);
  assert.equal(await readDrawSoundEnabled(db), true);
  assert.equal(await readDrawHapticsEnabled(db), false);
  assert.equal(rows.size, 2);
});
