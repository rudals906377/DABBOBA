import assert from "node:assert/strict";
import test from "node:test";
import { DrawAudio } from "../audio.mjs";
import { GACHA_CONTACT_TIMES, GACHA_SEAL_TIME, GACHA_DURATION } from "../motion.mjs";

class MockParam {
  value = 0;
  events = [];
  setValueAtTime(value, time) { this.events.push(["set", value, time]); }
  linearRampToValueAtTime(value, time) { this.events.push(["ramp", value, time]); }
  cancelScheduledValues(time) { this.events.push(["cancel", time]); }
  setTargetAtTime(value, time, constant) { this.events.push(["target", value, time, constant]); }
}

class MockNode {
  gain = new MockParam();
  frequency = new MockParam();
  Q = new MockParam();
  playbackRate = new MockParam();
  disconnected = false;
  startedAt = null;
  stoppedAt = null;
  connections = [];
  connect(node) { this.connections.push(node); }
  disconnect() { this.disconnected = true; }
  start(time) { this.startedAt = time; }
  stop(time) { this.stoppedAt = time; }
}

class MockBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(channel) { return this.channels[channel]; }
}

class MockAudioContext {
  state = "suspended";
  currentTime = 10;
  sampleRate = 8000;
  destination = {};
  sources = [];
  resumeCount = 0;
  constructor({ beforeDecode } = {}) { this.beforeDecode = beforeDecode; }
  createGain() { return new MockNode(); }
  createWaveShaper() { return new MockNode(); }
  createBiquadFilter() { return new MockNode(); }
  createBufferSource() {
    const node = new MockNode();
    this.sources.push(node);
    return node;
  }
  createBuffer(channels, length, rate) { return new MockBuffer(channels, length, rate); }
  async decodeAudioData(bytes) {
    await this.beforeDecode?.();
    const isDrop = new Uint8Array(bytes)[0] === 1;
    const buffer = new MockBuffer(1, Math.ceil((isDrop ? 0.46 : 1.34) * this.sampleRate), this.sampleRate);
    const samples = buffer.getChannelData(0);
    // Three separated contacts; the second/third deliberately have distinct
    // values so the cropped buffer cannot accidentally include either one.
    for (const [time, level] of (isDrop ? [[0.016, 0.4], [0.163, 0.8], [0.285, 1]] : [[0.11, 0.2]])) {
      samples.fill(level, Math.floor(time * this.sampleRate), Math.floor((time + 0.01) * this.sampleRate));
    }
    return buffer;
  }
  async resume() { this.resumeCount += 1; this.state = "running"; }
  async close() { this.state = "closed"; }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture({ beforeDecode, beforeFetch } = {}) {
  let contextCreations = 0;
  const context = new MockAudioContext({ beforeDecode });
  const requests = [];
  const audio = new DrawAudio({
    audioContextFactory: () => { contextCreations += 1; return context; },
    fetcher: async (url) => {
      requests.push(url);
      await beforeFetch?.();
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([url.pathname.includes("drop") ? 1 : 2]).buffer,
      };
    },
  });
  return { audio, context, requests, contextCreations: () => contextCreations };
}

async function readyFixture(options) {
  const result = fixture(options);
  await result.audio.unlock();
  result.audio.setMuted(false);
  return result;
}

test("preload is local and silent; explicit unlock still leaves sound muted", async () => {
  const { audio, context, requests, contextCreations } = fixture();
  assert.equal(contextCreations(), 0);
  assert.equal(audio.inspect().contextState, "not-created");
  assert.equal(audio.inspect().muted, true);
  audio.startGacha();
  audio.friction(1);
  audio.tear();
  assert.equal(contextCreations(), 0);
  assert.equal(audio.inspect().activeSources, 0);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => url.pathname.includes("/assets/audio/gacha-capsule-")));
  await audio.unlock();
  assert.equal(contextCreations(), 1);
  assert.equal(context.resumeCount, 1);
  assert.equal(audio.inspect().unlocked, true);
  assert.equal(audio.inspect().ready, true);
  assert.equal(audio.inspect().muted, true);
  assert.equal(context.sources.length, 0);
  audio.dispose();
});

test("gacha shares motion timings for three diminishing contacts and one seam sound", async () => {
  const { audio, context } = await readyFixture();
  assert.deepEqual(GACHA_CONTACT_TIMES, [0.5, 0.89, 1.1]);
  assert.equal(GACHA_SEAL_TIME, 1.8);
  audio.startGacha();
  assert.equal(audio.inspect().activeSources, 4);
  assert.deepEqual(context.sources.map((source) => source.startedAt), [10.5, 10.89, 11.1, 11.8]);
  const [contact, rebound, smallRebound, seam] = context.sources;
  assert.equal(contact.buffer.duration, 0.14);
  assert.equal(rebound.buffer, contact.buffer);
  assert.equal(smallRebound.buffer, contact.buffer);
  assert.equal(seam.buffer.duration, 0.19);
  assert.ok(Math.max(...contact.buffer.getChannelData(0)) < 0.41, "second and third impacts must be excluded");
  const entries = Array.from(audio.sources);
  const firstGain = entries[0].volume.gain.events.find(([event]) => event === "ramp")[1];
  const secondGain = entries[1].volume.gain.events.find(([event]) => event === "ramp")[1];
  const lastGain = entries[2].volume.gain.events.find(([event]) => event === "ramp")[1];
  assert.ok(secondGain < firstGain / 2, "first rebound must be quieter than the initial contact");
  assert.ok(lastGain < secondGain / 2, "last small landing must diminish again");
  for (let index = 0; index < 3; index += 1) {
    assert.ok(context.sources[index].stoppedAt < context.sources[index + 1].startedAt, "cropped contacts must not overlap");
  }
  audio.dispose();
});

test("twenty replay/reset cycles cancel scheduled sources without accumulation", async () => {
  const { audio, context } = await readyFixture();
  for (let count = 0; count < 20; count += 1) {
    audio.startGacha();
    assert.equal(audio.inspect().activeSources, 4);
    audio.stop();
    assert.equal(audio.inspect().activeSources, 0);
    assert.ok(context.sources.every((source) => source.stoppedAt === context.currentTime));
    assert.ok(context.sources.every((source) => source.disconnected));
  }
  audio.dispose();
});

test("reset or host skip immediately stops all three contacts and the seal at any phase", async () => {
  for (const elapsed of [0.1, 0.51, 0.90, 1.11, 1.61, 1.81, GACHA_DURATION]) {
    const { audio, context } = await readyFixture();
    audio.startGacha();
    context.currentTime += elapsed;
    audio.stop();
    assert.equal(audio.inspect().activeSources, 0);
    assert.ok(context.sources.every((source) => source.stoppedAt === context.currentTime));
    assert.ok(context.sources.every((source) => source.onended === null && source.disconnected));
    audio.dispose();
  }
});

test("mute cancels ramps immediately; unmute does not restart or resume audio", async () => {
  const { audio, context } = await readyFixture();
  audio.startGacha();
  const entries = Array.from(audio.sources);
  audio.setMuted(true);
  assert.equal(audio.inspect().activeSources, 0);
  for (const entry of entries) {
    assert.deepEqual(entry.volume.gain.events.slice(-2), [["cancel", 10], ["set", 0, 10]]);
    assert.equal(entry.source.onended, null);
  }
  audio.setMuted(false);
  assert.equal(context.resumeCount, 1);
  assert.equal(audio.inspect().activeSources, 0);
  audio.dispose();
});

test("paper friction reuses one source, stops at zero, and tear has a short bounded buffer", async () => {
  const { audio, context } = await readyFixture();
  audio.friction(0.1);
  audio.friction(0.9);
  audio.friction(2);
  assert.equal(context.sources.length, 1);
  assert.equal(audio.inspect().activeSources, 1);
  audio.friction(0);
  assert.equal(audio.inspect().activeSources, 0);
  audio.friction(Number.NaN);
  assert.equal(audio.inspect().activeSources, 0);
  audio.friction(0.5);
  audio.tear();
  assert.equal(audio.inspect().activeSources, 1, "tear must replace continuous friction");
  const tear = context.sources.at(-1);
  assert.ok(tear.buffer.duration <= 0.45);
  assert.ok(Math.max(...tear.buffer.getChannelData(0)) <= 0.8);
  assert.match(audio.inspect().paperAudio, /not recorded foley/);
  audio.dispose();
});

test("paper synthesis is deterministic and source completion cleans up nodes", async () => {
  const first = await readyFixture();
  const second = await readyFixture();
  assert.deepEqual(first.audio.buffers.friction.getChannelData(0), second.audio.buffers.friction.getChannelData(0));
  assert.deepEqual(first.audio.buffers.tear.getChannelData(0), second.audio.buffers.tear.getChannelData(0));
  first.audio.tear();
  const source = first.context.sources.at(-1);
  source.onended();
  assert.equal(first.audio.inspect().activeSources, 0);
  assert.equal(source.disconnected, true);
  first.audio.dispose();
  second.audio.dispose();
});

for (const action of ["stop", "mute", "dispose"]) {
  test(`${action} invalidates a gacha request while asynchronous decode is pending`, async () => {
    const gate = deferred();
    const { audio, context } = fixture({ beforeDecode: () => gate.promise });
    const unlock = audio.unlock();
    await flush();
    audio.setMuted(false);
    audio.startGacha();
    assert.equal(audio.inspect().activeSources, 0);
    if (action === "mute") audio.setMuted(true);
    else audio[action]();
    gate.resolve();
    await unlock;
    await flush();
    assert.equal(audio.inspect().activeSources, 0);
    assert.equal(context.sources.length, 0, "late decode must not resurrect a previous interaction");
    audio.dispose();
  });
}

test("a pending local preload cannot replay a reset scene", async () => {
  const gate = deferred();
  const { audio, context } = fixture({ beforeFetch: () => gate.promise });
  const unlock = audio.unlock();
  await flush();
  audio.setMuted(false);
  audio.startGacha();
  audio.stop();
  gate.resolve();
  await unlock;
  await flush();
  assert.equal(context.sources.length, 0);
  assert.equal(audio.inspect().activeSources, 0);
  audio.dispose();
});

test("delayed decode skips missed contacts instead of playing catch-up", async () => {
  const gate = deferred();
  const { audio, context } = fixture({ beforeDecode: () => gate.promise });
  const unlock = audio.unlock();
  await flush();
  audio.setMuted(false);
  audio.startGacha();
  context.currentTime = 11.2;
  gate.resolve();
  await unlock;
  await flush();
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].startedAt, 11.8);
  audio.dispose();
});

test("decode completing between bounces schedules only the remaining small landing and seal", async () => {
  const gate = deferred();
  const { audio, context } = fixture({ beforeDecode: () => gate.promise });
  const unlock = audio.unlock();
  await flush();
  audio.setMuted(false);
  audio.startGacha();
  context.currentTime = 10.9;
  gate.resolve();
  await unlock;
  await flush();
  assert.deepEqual(context.sources.map((source) => source.startedAt), [11.1, 11.8]);
  assert.equal(audio.inspect().activeSources, 2);
  audio.dispose();
});

test("dispose closes the context and subsequent actions remain inert", async () => {
  const { audio, context } = await readyFixture();
  audio.startGacha();
  audio.dispose();
  await flush();
  assert.equal(audio.inspect().disposed, true);
  assert.equal(audio.inspect().unlocked, false);
  assert.equal(audio.inspect().activeSources, 0);
  assert.equal(context.state, "closed");
  const sourceCount = context.sources.length;
  assert.equal(await audio.unlock(), false);
  audio.setMuted(false);
  audio.startGacha();
  audio.friction(1);
  audio.tear();
  assert.equal(context.sources.length, sourceCount);
});
