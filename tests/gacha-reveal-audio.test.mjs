import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { resolveGachaLeverSoundSegment } from "../apps/mobile/src/features/draw/gacha-reveal-sound.ts";
import { GACHA_LEVER_TARGET_RADIANS } from "../apps/mobile/src/features/draw/gacha-lever-motion.ts";
import { sampleGachaRevealLighting } from "../apps/mobile/src/features/draw/gacha-reveal-timeline.ts";
import { resolveKujiFeedbackStage } from "../apps/mobile/src/features/draw/kuji-reveal-feedback.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const mobilePackage = JSON.parse(read("apps/mobile/package.json"));
const audioSource = read("apps/mobile/src/features/draw/useDrawRevealFeedback.ts");
const machineSource = read("apps/mobile/src/features/draw/GachaLeverMachine.tsx");
const kujiSource = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");
const screenSource = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
const databaseSource = read("apps/mobile/src/lib/local-database.ts");

function inspectWav(category, name) {
  const buffer = readFileSync(new URL(`apps/mobile/assets/draw/${category}/sfx/${name}.wav`, root));
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  assert.equal(buffer.readUInt16LE(20), 1);
  assert.equal(buffer.readUInt16LE(22), 1);
  assert.equal(buffer.readUInt32LE(24), 44_100);
  assert.equal(buffer.readUInt16LE(34), 16);
  const count = buffer.readUInt32LE(40) / 2;
  const samples = Array.from({ length: count }, (_, index) => buffer.readInt16LE(44 + index * 2) / 32768);
  return { duration: count / 44100, samples };
}
const rms = (samples) => Math.sqrt(samples.reduce((sum, n) => sum + n*n, 0) / samples.length);

test("native lever sound follows six forward movements, with no touch-down, stationary or reverse cue", () => {
  const source = machineSource.match(/\(\{ segment, run \}, previous\) => \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(source, "execute the real UI-thread sound reaction");
  const events = [];
  const scope = { phase: "ready", leverSoundSequence: { value: 0 },
    playLeverSound: (run, occurrence) => events.push([run, occurrence]),
    scheduleOnRN: (fn, ...args) => fn(...args) };
  const react = runInNewContext(`(${source})`, scope);
  let previous = { segment: 0, run: 5 };
  const move = (radians, run = 5) => {
    const next = { segment: resolveGachaLeverSoundSegment(radians), run };
    react(next, previous); previous = next;
  };
  move(0); move(0);
  assert.equal(events.length, 0);
  for (let tap = 1; tap <= 6; tap++) {
    move(GACHA_LEVER_TARGET_RADIANS * tap / 6);
    move(GACHA_LEVER_TARGET_RADIANS * tap / 6);
  }
  assert.deepEqual(events, Array.from({ length: 6 }, (_, i) => [5, i + 1]));
  move(0); // An unfinished gesture may unwind to its start.
  assert.equal(events.length, 6);
  move(GACHA_LEVER_TARGET_RADIANS / 6);
  assert.deepEqual(events.at(-1), [5, 7], "a new forward gesture can sound at the same angle");
  move(GACHA_LEVER_TARGET_RADIANS);
  assert.equal(events.length, 8, "a jumped frame must not burst through skipped sectors");
  move(GACHA_LEVER_TARGET_RADIANS, 6);
  assert.equal(events.length, 8, "run changes must not sound an old pose");
  scope.phase = "dispensing";
  move(0, 6); move(1, 6);
  assert.equal(events.length, 8);
  const down = machineSource.match(/\.onTouchesDown\([\s\S]*?\.onTouchesUp/)?.[0];
  assert.ok(down);
  assert.doesNotMatch(down, /playLeverSound/);
  assert.match(machineSource, /resolveGachaLeverSoundSegment\(leverRadians.value\)/);
  for (const invalid of [NaN, Infinity, -Infinity, -1, 0]) assert.equal(resolveGachaLeverSoundSegment(invalid), 0);
});

test("draw effects use small local PCM assets with quiet tails and no clipping or DC offset", () => {
  for (const [category, name, duration] of [
    ["gacha", "gacha-lever-ratchet", .2], ["gacha", "gacha-capsule-drop", .46], ["gacha", "gacha-capsule-open", 1.34],
    ["gacha", "gacha-coin-drop", .28], ["gacha", "gacha-capsules-rattle", .48],
    ["kuji", "kuji-paper-peel", .32], ["kuji", "kuji-paper-tear", .22], ["kuji", "kuji-paper-release", .16],
  ]) {
    const wav = inspectWav(category, name);
    assert.ok(Math.abs(wav.duration - duration) < .002, name);
    assert.ok(wav.samples.every((n) => Math.abs(n) < .9), `${name} clips`);
    assert.ok(rms(wav.samples) > .003 && rms(wav.samples) < .2, `${name} has an unsuitable level`);
    assert.ok(Math.abs(wav.samples.reduce((sum, n) => sum + n, 0) / wav.samples.length) < .005, `${name} has DC offset`);
    assert.equal(wav.samples[0], 0);
    assert.ok(rms(wav.samples.slice(-441)) < .001, `${name} has a hard ending`);
  }
  const { samples } = inspectWav("gacha", "gacha-capsule-drop");
  const energy = (start) => rms(samples.slice(Math.round(start * 44100), Math.round((start + .07) * 44100)));
  assert.ok(energy(0) > energy(.17) && energy(.17) > energy(.306), "plastic bounce sounds must diminish with the physical bounce heights");
});

test("native feedback respects Silent Mode, focus and backgrounding without exclusive audio", () => {
  assert.match(mobilePackage.dependencies["expo-audio"], /^~57\.0\.5$/);
  assert.match(mobilePackage.dependencies["expo-haptics"], /^~57\.0\.3$/);
  assert.match(audioSource, /downloadFirst: true/);
  assert.match(audioSource, /playsInSilentMode: false/);
  assert.match(audioSource, /interruptionMode: "mixWithOthers"/);
  assert.match(audioSource, /shouldPlayInBackground: false/);
  assert.match(audioSource, /sound: preferences.current.sound && audioModeReady.current/);
  assert.match(audioSource, /useFocusEffect/);
  assert.match(audioSource, /AppState.addEventListener\("change"/);
  assert.match(audioSource, /controller.cancel\(\)/);
  assert.match(audioSource, /performAndroidHapticsAsync/);
  assert.doesNotMatch(audioSource, /setTimeout|setInterval|withRepeat/);
  assert.match(audioSource, /cue === "coin" \|\| cue === "chamber"\) return Promise.resolve\(\)/);
  assert.match(audioSource, /\[primary, secondary, tertiary, coin, chamber\]/);
  const gachaAudio = read("apps/mobile/src/features/draw/useGachaRevealAudio.ts");
  assert.match(gachaAudio, /gacha-coin-drop.wav/);
  assert.match(gachaAudio, /gacha-capsules-rattle.wav/);
  assert.match(machineSource, /scheduleOnRN\(playCoinSound, animationRun.value\)/);
  assert.match(machineSource, /playCoinSound\(run\)/);
});

test("material cues follow real native travel and carry run identity", async () => {
  const timing = await import("../apps/mobile/src/features/draw/gacha-reveal-sound.ts");
  const stage = timing.resolveGachaRevealSoundStage;
  assert.equal(stage(0, 1, 1), 0);
  assert.equal(stage(1, .649, 0), 0);
  assert.equal(stage(1, .65, 0), 1);
  assert.equal(stage(1, .75, 0), 2);
  assert.equal(stage(1, 1, .179), 2);
  assert.equal(stage(1, 1, .18), 3);
  assert.equal(sampleGachaRevealLighting(.18).innerLight, 0);
  assert.ok(sampleGachaRevealLighting(.181).innerLight > 0);
  assert.deepEqual({ ...timing.GACHA_REVEAL_SOUND_TIMING }, { dropImpactMs: 1105, seamOpenMs: 2240 });
  for (const n of [NaN, Infinity, -Infinity]) {
    assert.equal(stage(1, n, 0), 0);
    assert.equal(stage(1, 1, n), 0);
    assert.equal(resolveKujiFeedbackStage(1, n), 0);
  }
  assert.match(machineSource, /run: animationRun.value/);
  assert.match(machineSource, /scheduleOnRN\(playDropImpactSound, run\)/);
  assert.match(machineSource, /scheduleOnRN\(playReboundSound, run\)/);
  assert.match(machineSource, /scheduleOnRN\(playSeamOpenSound, run\)/);
  assert.match(machineSource, /scheduleOnRN\(playLeverSound, run, leverSoundSequence.value\)/);
  assert.match(kujiSource, /resolveKujiFeedbackStage\(dragProgress.value, paperFlightProgress.value\)/);
  assert.match(kujiSource, /scheduleOnRN\(playFeedback, stage, run\)/);
  assert.match(kujiSource, /scheduleOnRN\(cancelFeedback\)/);
});

test("both categories have independent persistent sound and vibration controls", () => {
  assert.match(databaseSource, /draw.sound.enabled.v1/);
  assert.match(databaseSource, /draw.haptics.enabled.v1/);
  assert.match(screenSource, /isDrawCategory && !drawSequenceFinished/);
  assert.match(screenSource, /"가챠 효과음" : "쿠지 효과음"/);
  assert.match(screenSource, /"가챠 진동" : "쿠지 진동"/);
  assert.equal((screenSource.match(/soundEnabled=\{soundPreferenceReady && soundEnabled\}/g) ?? []).length, 2);
  assert.equal((screenSource.match(/hapticsEnabled=\{hapticsPreferenceReady && hapticsEnabled\}/g) ?? []).length, 2);
  assert.match(screenSource, /writeDrawSoundEnabled\(db, next\)/);
  assert.match(screenSource, /writeDrawHapticsEnabled\(db, next\)/);
});
