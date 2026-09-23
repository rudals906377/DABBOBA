/**
 * Local, gesture-gated audio for the independent draw preview.
 *
 * The gacha WAVs are copied from the app; they are not edited in place. Their
 * decoded buffers are cropped in memory. Kuji uses deterministic, synthesized
 * paper noise for this prototype, not recorded foley. No music or remote service.
 * This live interaction layer is separate from the silent, seekable composition.
 */

import { GACHA_CONTACT_TIMES, GACHA_SEAL_TIME } from "./motion.mjs";

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const ASSETS = {
  drop: new URL("./assets/audio/gacha-capsule-drop.wav", import.meta.url),
  open: new URL("./assets/audio/gacha-capsule-open.wav", import.meta.url),
};

function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function crop(context, original, startSeconds, durationSeconds) {
  const count = Math.max(1, Math.round(durationSeconds * original.sampleRate));
  const offset = Math.round(startSeconds * original.sampleRate);
  const output = context.createBuffer(original.numberOfChannels, count, original.sampleRate);
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const from = original.getChannelData(channel);
    const to = output.getChannelData(channel);
    for (let i = 0; i < count; i += 1) {
      // Short anti-click attack; 18 ms fade ends before the original second hit.
      const envelope = Math.min(1, i / (original.sampleRate * 0.001), (count - i - 1) / (original.sampleRate * 0.018));
      to[i] = (from[offset + i] || 0) * Math.max(0, envelope);
    }
  }
  return output;
}

function paperBuffer(context, duration, seed, isTear = false) {
  const rate = context.sampleRate;
  const output = context.createBuffer(1, Math.ceil(duration * rate), rate);
  const samples = output.getChannelData(0);
  const noise = seededNoise(seed);
  let soft = 0;
  let previous = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / rate;
    const unit = i / Math.max(1, samples.length - 1);
    const raw = noise();
    soft += (raw - soft) * 0.21;
    const fibers = soft - previous * 0.82;
    previous = soft;
    // Irregular short fiber clusters, not a periodic machine/generator loop.
    const roughness = 0.63 + 0.22 * Math.sin(t * 83.2 + Math.sin(t * 19.7) * 2.8)
      + 0.15 * Math.sin(t * 217.1 + Math.sin(t * 47.3) * 1.4);
    const envelope = isTear
      ? Math.min(1, t / 0.018) * Math.pow(Math.max(0, 1 - unit), 0.8)
      : Math.min(1, t / 0.015, (duration - t) / 0.015);
    samples[i] = clamp(fibers * roughness * envelope * (isTear ? 2.1 : 1.5), -0.8, 0.8);
  }
  return output;
}

export class DrawAudio {
  constructor({ audioContextFactory, fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
    this.muted = true;
    this.unlocked = false;
    this.disposed = false;
    this.context = null;
    this.master = null;
    this.ceiling = null;
    this.buffers = {};
    this.sources = new Set();
    this.frictionVoice = null;
    this.epoch = 0;
    this.loadingError = null;
    this.decodePromise = null;
    this.contextFactory = audioContextFactory || (() => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      return Context ? new Context({ latencyHint: "interactive" }) : null;
    });
    // Local file preload is allowed while muted; construction creates no context,
    // plays nothing, and never resumes browser audio on its own.
    this.bytes = Promise.all(Object.entries(ASSETS).map(async ([key, url]) => {
      if (!fetcher) throw new Error("Audio preload is unavailable");
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`Local ${key} sound unavailable (${response.status})`);
      return [key, await response.arrayBuffer()];
    })).catch((error) => {
      this.loadingError = error.message;
      return [];
    });
  }

  async unlock() {
    if (this.disposed) return false;
    if (!this.context) {
      try {
        this.context = this.contextFactory();
      } catch (error) {
        this.loadingError = error.message;
        return false;
      }
      if (!this.context) return false;
      const context = this.context;
      this.master = context.createGain();
      this.master.gain.value = 0.72;
      // Hard output ceiling at 0.62 (-4.15 dBFS), with a soft approach. The
      // conservative source gains below keep the ordinary signal far below it.
      this.ceiling = context.createWaveShaper();
      const curve = new Float32Array(2049);
      for (let i = 0; i < curve.length; i += 1) {
        const sample = i / (curve.length - 1) * 2 - 1;
        curve[i] = 0.62 * Math.tanh(sample / 0.62);
      }
      this.ceiling.curve = curve;
      this.master.connect(this.ceiling);
      this.ceiling.connect(context.destination);
      this.decodePromise = this.bytes.then(async (files) => {
        const decoded = await Promise.all(files.map(async ([key, bytes]) => [key, await context.decodeAudioData(bytes.slice(0))]));
        if (this.disposed) return;
        for (const [key, buffer] of decoded) {
          // Source impacts are at 0.015, 0.162 and 0.284; retain only the first.
          this.buffers[key] = key === "drop"
            ? crop(context, buffer, 0.015, 0.14)
            : crop(context, buffer, 0.085, 0.19);
        }
        this.buffers.friction = paperBuffer(context, 1.7, 0x50a4e21);
        this.buffers.tear = paperBuffer(context, 0.36, 0x7ea42a1, true);
      }).catch((error) => { this.loadingError = error.message; });
    }
    try {
      // The host calls this only from its explicit sound or playback button.
      await this.context.resume();
      if (this.disposed) return false;
      this.unlocked = this.context.state === "running";
      await this.decodePromise;
      return this.unlocked && !this.disposed;
    } catch (error) {
      this.loadingError = error.message;
      return false;
    }
  }

  setMuted(value) {
    this.muted = Boolean(value);
    if (this.muted) this.stop();
    // Unmuting never restarts a previous scene or resumes an AudioContext.
  }

  canPlay() {
    return !this.disposed && !this.muted && this.unlocked && this.context?.state === "running";
  }

  voice(buffer, { when, gain = 0.25, duration = buffer?.duration, rate = 1, highpass = 80, lowpass = 5000, loop = false } = {}) {
    if (!this.canPlay() || !buffer) return null;
    const context = this.context;
    const source = context.createBufferSource();
    const high = context.createBiquadFilter();
    const low = context.createBiquadFilter();
    const volume = context.createGain();
    const startedAt = Math.max(context.currentTime, when ?? context.currentTime);
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    high.type = "highpass";
    high.frequency.value = highpass;
    high.Q.value = 0.55;
    low.type = "lowpass";
    low.frequency.value = lowpass;
    low.Q.value = 0.55;
    volume.gain.setValueAtTime(0, startedAt);
    volume.gain.linearRampToValueAtTime(clamp(gain, 0, 0.6), startedAt + 0.003);
    if (!loop) {
      volume.gain.setValueAtTime(clamp(gain, 0, 0.6), startedAt + Math.max(0.003, duration - 0.025));
      volume.gain.linearRampToValueAtTime(0, startedAt + duration);
    }
    source.connect(high);
    high.connect(low);
    low.connect(volume);
    volume.connect(this.master);
    const entry = { source, volume, nodes: [source, high, low, volume] };
    this.sources.add(entry);
    source.onended = () => this.clearVoice(entry);
    source.start(startedAt);
    if (!loop) source.stop(startedAt + duration + 0.003);
    return entry;
  }

  clearVoice(entry) {
    if (!entry) return;
    this.sources.delete(entry);
    if (this.frictionVoice === entry) this.frictionVoice = null;
    entry.source.onended = null;
    for (const node of entry.nodes) {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
  }

  stopVoice(entry) {
    if (!entry) return;
    const now = this.context?.currentTime || 0;
    entry.volume.gain.cancelScheduledValues(now);
    entry.volume.gain.setValueAtTime(0, now);
    try { entry.source.stop(now); } catch { /* Already stopped. */ }
    this.clearVoice(entry);
  }

  startGacha() {
    this.stop();
    if (!this.canPlay()) return;
    const epoch = this.epoch;
    const startedAt = this.context.currentTime;
    const schedule = () => {
      // A late decode must never replay a reset/muted/hidden scene. Missed
      // contact times are skipped, rather than catching up out of sync.
      if (epoch !== this.epoch || !this.canPlay()) return;
      const at = (seconds, buffer, options) => {
        if (startedAt + seconds < this.context.currentTime) return;
        this.voice(buffer, { ...options, when: startedAt + seconds });
      };
      // Three surface contacts correspond to the first landing and two short
      // bounces. The 0.14 s crop fits even the final 0.21 s contact interval,
      // so no original later impacts or overlapping tails are introduced.
      at(GACHA_CONTACT_TIMES[0], this.buffers.drop, { gain: 0.54, highpass: 80, lowpass: 3700 });
      at(GACHA_CONTACT_TIMES[1], this.buffers.drop, { gain: 0.17, rate: 1.06, highpass: 130, lowpass: 3400 });
      at(GACHA_CONTACT_TIMES[2], this.buffers.drop, { gain: 0.07, rate: 1.1, highpass: 155, lowpass: 3100 });
      // High-pass away the source's 100–450 Hz musical sweep; retain only
      // its short noise texture as a very quiet plastic seam movement.
      at(GACHA_SEAL_TIME, this.buffers.open, { gain: 0.38, highpass: 1350, lowpass: 4100 });
    };
    if (this.buffers.drop) schedule();
    else this.decodePromise?.then(schedule);
  }

  friction(speed) {
    const strength = clamp(Number.isFinite(speed) ? speed : 0);
    if (!this.canPlay() || strength <= 0) {
      this.stopVoice(this.frictionVoice);
      return;
    }
    if (!this.frictionVoice) {
      this.frictionVoice = this.voice(this.buffers.friction, {
        gain: 0, loop: true, highpass: 650, lowpass: 4600,
      });
    }
    if (!this.frictionVoice) return;
    const now = this.context.currentTime;
    const param = this.frictionVoice.volume.gain;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(0.026 + Math.sqrt(strength) * 0.13, now, 0.022);
    this.frictionVoice.source.playbackRate.setTargetAtTime(0.78 + strength * 0.38, now, 0.035);
  }

  tear() {
    this.friction(0);
    this.voice(this.buffers.tear, { gain: 0.34, highpass: 800, lowpass: 4900 });
  }

  stop() {
    this.epoch += 1;
    for (const entry of Array.from(this.sources)) this.stopVoice(entry);
    this.frictionVoice = null;
  }

  dispose() {
    this.stop();
    this.disposed = true;
    this.unlocked = false;
    this.master?.disconnect();
    this.ceiling?.disconnect();
    this.context?.close().catch(() => {});
  }

  inspect() {
    return {
      muted: this.muted,
      unlocked: this.unlocked,
      activeSources: this.sources.size,
      ready: Boolean(this.buffers.drop && this.buffers.open),
      disposed: this.disposed,
      contextState: this.context?.state || "not-created",
      loadingError: this.loadingError,
      paperAudio: "seeded procedural prototype, not recorded foley",
    };
  }
}
