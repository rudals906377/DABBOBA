import { mkdirSync, writeFileSync } from "node:fs";
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

function renderWav(name, durationSeconds, renderSample) {
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
    const sample = softLimit(renderSample(time, frame)) * fadeOut;
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32_767), 44 + frame * 2);
  }

  writeFileSync(resolve(OUTPUT_DIR, name), buffer);
}

function renderLeverSound() {
  const noise = createNoise(0x0dab_b0ba);
  let previousNoise = 0;
  const clicks = [0.015, 0.125, 0.238, 0.354];
  renderWav("gacha-lever-ratchet.wav", 0.52, (time) => {
    const rawNoise = noise();
    const softenedNoise = previousNoise * 0.76 + rawNoise * 0.24;
    previousNoise = softenedNoise;
    let sample = 0;
    for (let index = 0; index < clicks.length; index += 1) {
      const start = clicks[index];
      const click = envelope(time, start, 0.0018, 0.047 + index * 0.004);
      const local = Math.max(0, time - start);
      sample += click * (
        Math.sin(Math.PI * 2 * (1_520 - local * 1_650) * local) * 0.18
        + softenedNoise * 0.12
      );
    }
    const body = envelope(time, 0, 0.014, 0.45);
    sample += body * Math.sin(Math.PI * 2 * 82 * time) * 0.025;
    return sample;
  });
}

function renderDropSound() {
  const noise = createNoise(0x5eed_1105);
  let lowNoise = 0;
  const impacts = [
    { time: 0.015, gain: 1, frequency: 168 },
    { time: 0.162, gain: 0.31, frequency: 194 },
    { time: 0.284, gain: 0.12, frequency: 220 },
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
        texturedNoise * transient * 0.19
        + Math.sin(Math.PI * 2 * impact.frequency * local) * body * 0.34
        + Math.sin(Math.PI * 2 * impact.frequency * 2.26 * local) * body * 0.08
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
    const breath = (raw - air) * 0.05 * bodyEnvelope;
    const sweepPhase = Math.PI * 2 * (182 * time + 96 * time * time);
    const warmPhase = Math.PI * 2 * (91 * time + 24 * time * time);
    const shimmerPhase = Math.PI * 2 * (364 * time + 142 * time * time);
    const seam = envelope(time, 0.08, 0.035, 0.42);
    return breath
      + Math.sin(warmPhase) * bodyEnvelope * 0.09
      + Math.sin(sweepPhase) * bodyEnvelope * 0.105
      + Math.sin(shimmerPhase) * seam * 0.035;
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
renderLeverSound();
renderDropSound();
renderOpenSound();
console.log(`Generated three deterministic gacha sound effects in ${OUTPUT_DIR}`);
