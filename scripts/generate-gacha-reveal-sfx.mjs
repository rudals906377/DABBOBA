import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(ROOT, "apps/mobile/assets/draw/gacha/sfx");
const SAMPLE_RATE = 44_100;

function createNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0xffff_ffff * 2 - 1;
  };
}

function smoothstep(value) {
  const unit = Math.max(0, Math.min(1, value));
  return unit * unit * (3 - 2 * unit);
}

function envelope(time, start, attack, decay) {
  if (time < start || time > start + attack + decay) return 0;
  const local = time - start;
  if (local < attack) return smoothstep(local / attack);
  return 1 - smoothstep((local - attack) / decay);
}

function softLimit(value) {
  return Math.tanh(value * 1.24) / Math.tanh(1.24);
}

function renderWav(name, durationSeconds, renderSample, outputDir = OUTPUT_DIR, limit = true) {
  const frameCount = Math.round(durationSeconds * SAMPLE_RATE);
  const pcmBytes = frameCount * 2;
  const buffer = Buffer.alloc(44 + pcmBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcmBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcmBytes, 40);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const fadeOut = 1 - smoothstep(Math.max(0, (time - durationSeconds + 0.025) / 0.025));
    const raw = renderSample(time, frame);
    const sample = (limit ? softLimit(raw) : raw) * fadeOut;
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32_767), 44 + frame * 2);
  }

  writeFileSync(resolve(outputDir, name), buffer);
}

function renderLeverSound() {
  // Author-permitted real capsule-machine recording, never the owner's reference Shorts.
  const source = readFileSync(resolve(OUTPUT_DIR, "source/gacha-crank-recording.wav"));
  if (createHash("sha256").update(source).digest("hex") !== "98d7d81d37f0eb83f33d01714e0c1797800c9801a8941b34e8ee574dddb65a06") {
    throw new Error("Gacha crank source differs from its reviewed provenance.");
  }
  const count = source.readUInt32LE(40) / 2;
  const samples = Array.from({ length: count }, (_, i) => source.readInt16LE(44 + i * 2) / 32768);
  const dc = samples.reduce((sum, value) => sum + value, 0) / count;
  const centered = samples.map((value) => value - dc);
  const rms = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0) / count);
  const peak = centered.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const gain = Math.min(0.12 / rms, 0.7 / peak);
  // Preserve the irregular real teeth/housing texture; only level and soften the cut.
  renderWav("gacha-lever-ratchet.wav", 0.2, (time, frame) => {
    const attack = smoothstep(time / 0.003);
    const release = 1 - smoothstep((time - 0.16) / 0.025);
    return centered[frame] * gain * attack * release;
  }, OUTPUT_DIR, false);
}

function renderDropSound() {
  const noise = createNoise(0x5eed_1105);
  let lowNoise = 0;
  const impacts = [
    { time: 0.003, gain: 1, frequency: 238 },
    { time: 0.173, gain: 0.28, frequency: 262 },
    { time: 0.309, gain: 0.10, frequency: 285 },
  ];
  renderWav("gacha-capsule-drop.wav", 0.46, (time) => {
    const raw = noise();
    lowNoise += (raw - lowNoise) * 0.11;
    const texturedNoise = raw - lowNoise * 0.72;
    let sample = 0;
    for (const impact of impacts) {
      const local = Math.max(0, time - impact.time);
      const transient = envelope(time, impact.time, 0.0015, 0.07);
      const body = envelope(time, impact.time, 0.003, 0.13);
      sample += impact.gain * (
        texturedNoise * transient * 0.14
        + Math.sin(Math.PI * 2 * impact.frequency * local) * body * 0.24
        + Math.sin(Math.PI * 2 * impact.frequency * 1.47 * local) * body * 0.07
      );
    }
    return sample;
  });
}

function renderOpenSound() {
  const noise = createNoise(0x1eaf_2120);
  let air = 0;
  renderWav("gacha-capsule-open.wav", 1.34, (time) => {
    const unit = Math.max(0, Math.min(1, time / 1.34));
    const rise = smoothstep(Math.min(1, unit / 0.72));
    const release = 1 - smoothstep(Math.max(0, (unit - 0.66) / 0.34));
    const bodyEnvelope = rise * release;
    const raw = noise();
    air += (raw - air) * (0.025 + unit * 0.035);
    const breath = (raw - air) * 0.075 * bodyEnvelope;
    const sweepPhase = Math.PI * 2 * (182 * time + 96 * time * time);
    const warmPhase = Math.PI * 2 * (91 * time + 24 * time * time);
    const shimmerPhase = Math.PI * 2 * (364 * time + 142 * time * time);
    const seam = envelope(time, 0.08, 0.035, 0.42);
    return breath
      + Math.sin(warmPhase) * bodyEnvelope * 0.025
      + Math.sin(sweepPhase) * bodyEnvelope * 0.032
      + Math.sin(shimmerPhase) * seam * 0.012;
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
renderLeverSound();
renderDropSound();
renderOpenSound();
const KUJI_DIR = resolve(ROOT, "apps/mobile/assets/draw/kuji/sfx");
mkdirSync(KUJI_DIR, { recursive: true });
for (const [name, duration, seed, strength] of [
  ["kuji-paper-peel.wav", 0.32, 0x7011, 0.22],
  ["kuji-paper-tear.wav", 0.22, 0x7022, 0.26],
  ["kuji-paper-release.wav", 0.16, 0x7033, 0.12],
]) {
  const noise = createNoise(seed);
  let low = 0;
  let body = 0;
  renderWav(name, duration, (time) => {
    const raw = noise();
    low += (raw - low) * 0.08;
    body += (raw - body) * 0.55;
    const paper = body - low;
    const env = envelope(time, 0, 0.006, duration - 0.006);
    const grain = name.includes("tear")
      ? 0.55 + 0.45 * Math.sin(2 * Math.PI * 43 * time) ** 2
      : 0.8 + 0.2 * Math.sin(2 * Math.PI * 19 * time) ** 2;
    return paper * strength * env * grain;
  }, KUJI_DIR);
}
console.log("Generated six deterministic gacha/kuji material sound effects");
