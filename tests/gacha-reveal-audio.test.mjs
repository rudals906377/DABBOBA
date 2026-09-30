import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const mobilePackage = JSON.parse(readFileSync(new URL("apps/mobile/package.json", root), "utf8"));
const audioSource = readFileSync(new URL("apps/mobile/src/features/draw/useGachaRevealAudio.ts", root), "utf8");
const machineSource = readFileSync(new URL("apps/mobile/src/features/draw/GachaLeverMachine.tsx", root), "utf8");
const screenSource = readFileSync(new URL("apps/mobile/src/features/draw/DrawRevealScreen.tsx", root), "utf8");
const databaseSource = readFileSync(new URL("apps/mobile/src/lib/local-database.ts", root), "utf8");
const timingSource = readFileSync(new URL("apps/mobile/src/features/draw/gacha-reveal-sound.ts", root), "utf8");

const wavFiles = [
  ["gacha-lever-ratchet.wav", 0.52],
  ["gacha-capsule-drop.wav", 0.46],
  ["gacha-capsule-open.wav", 1.34],
];

function inspectWav(fileName) {
  const buffer = readFileSync(new URL(`apps/mobile/assets/draw/gacha/sfx/${fileName}`, root));
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
  assert.equal(buffer.readUInt16LE(20), 1, "sound effect must be uncompressed PCM");
  assert.equal(buffer.readUInt16LE(22), 1, "sound effect must remain mono");
  assert.equal(buffer.readUInt32LE(24), 44_100);
  assert.equal(buffer.readUInt16LE(34), 16);
  const dataBytes = buffer.readUInt32LE(40);
  return dataBytes / 2 / 44_100;
}

test("gacha sound effects are short deterministic local PCM assets", () => {
  for (const [fileName, expectedDuration] of wavFiles) {
    assert.ok(Math.abs(inspectWav(fileName) - expectedDuration) < 0.002, fileName);
  }
});

test("gacha audio respects Silent Mode and never takes exclusive audio focus", () => {
  assert.match(mobilePackage.dependencies["expo-audio"], /^~57\.0\.5$/);
  assert.match(audioSource, /useAudioPlayer\(LEVER_SOUND, \{ downloadFirst: true/);
  assert.match(audioSource, /playsInSilentMode: false/);
  assert.match(audioSource, /interruptionMode: "mixWithOthers"/);
  assert.match(audioSource, /shouldPlayInBackground: false/);
  assert.match(audioSource, /Audio feedback must never block or fail a committed draw presentation/);
});

test("lever, first contact, and seam audio follow the existing reveal clock", async () => {
  const timing = await import("../apps/mobile/src/features/draw/gacha-reveal-sound.ts");
  const { GACHA_CAPSULE_DISPENSE_DURATION_MS } = await import("../apps/mobile/src/features/draw/gacha-camera-motion.ts");
  assert.equal(timing.GACHA_DROP_IMPACT_SOUND_PROGRESS, 0.65);
  assert.equal(timing.GACHA_SEAM_OPEN_SOUND_PROGRESS, 0.14);
  // Same wall-clock moments as the retired JS timers on the linear 1.7 s + 3 s clock.
  assert.deepEqual({ ...timing.GACHA_REVEAL_SOUND_TIMING }, {
    dropImpactMs: Math.round(GACHA_CAPSULE_DISPENSE_DURATION_MS * 0.65),
    seamOpenMs: GACHA_CAPSULE_DISPENSE_DURATION_MS + Math.round(3_000 * 0.14),
  });
  const stage = timing.resolveGachaRevealSoundStage;
  assert.equal(stage(0, 1, 1), 0, "an inactive (settled or reset) reveal never cues sound");
  assert.equal(stage(1, 0.649, 0), 0);
  assert.equal(stage(1, 0.65, 0), 1);
  assert.equal(stage(1, 1, 0.139), 1);
  assert.equal(stage(1, 1, 0.14), 2);
  assert.match(timingSource, /"worklet";/);
  // Cues fire from the native timeline, once per stage crossing, never from JS timers.
  assert.match(machineSource, /useAnimatedReaction\(\s*\(\) => resolveGachaRevealSoundStage\(revealActive\.value, dispenseProgress\.value, revealProgress\.value\),/);
  assert.match(machineSource, /if \(before < 1 && stage >= 1\) scheduleOnRN\(playDropImpactSound\);/);
  assert.match(machineSource, /if \(before < 2 && stage >= 2\) scheduleOnRN\(playSeamOpenSound\);/);
  assert.doesNotMatch(audioSource, /setTimeout|clearTimeout/);
  // Mute and cancel remain authoritative on the JS side.
  assert.match(audioSource, /const scheduleDispense = useCallback\(\(\) => \{\s*cuesRef\.current = \{ armed: true, dropPlayed: false, openPlayed: false \};/);
  assert.match(audioSource, /const cancelScheduled = useCallback\(\(\) => \{\s*cuesRef\.current = \{ armed: false, dropPlayed: false, openPlayed: false \};/);
  assert.match(audioSource, /if \(!cues\.armed \|\| cues\.dropPlayed\) return;/);
  assert.match(audioSource, /if \(!cues\.armed \|\| cues\.openPlayed\) return;/);
  assert.match(audioSource, /if \(!enabledRef\.current\) return;/);
  assert.match(audioSource, /useEffect\(\(\) => cancelScheduled, \[cancelScheduled\]\)/);
  assert.match(machineSource, /leverSoundPlayed\.value === 0/);
  assert.match(machineSource, /scheduleOnRN\(playLeverSound\)/);
  assert.match(machineSource, /transition\.effect === "start-dispense"[\s\S]*?scheduleDispenseSounds\(\)/);
  assert.match(machineSource, /transition\.effect === "reset"[\s\S]*?cancelRevealSounds\(\)/);
});

test("draw sound has an accessible persistent local toggle", () => {
  assert.match(databaseSource, /const DRAW_SOUND_ENABLED_KEY = "draw\.sound\.enabled\.v1"/);
  assert.match(databaseSource, /return row\?\.preference_value !== "disabled"/);
  assert.match(screenSource, /accessibilityRole="switch"/);
  assert.match(screenSource, /accessibilityLabel="가챠 효과음"/);
  assert.match(screenSource, /writeDrawSoundEnabled\(db, next\)/);
  assert.match(screenSource, /soundEnabled=\{soundPreferenceReady && soundEnabled\}/);
});
