import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_PUBLIC_CONFIG_STATE,
  PUBLIC_CONFIG_GRACE_MS,
  parsePublicConfig,
  resolvePublicConfigState,
} from "../apps/mobile/src/features/commerce/public-config-grace.ts";

const live = { commerceMode: "LIVE", requiredPolicyVersions: { terms: "t-2", privacy: "p-2" } };
const prelaunch = { commerceMode: "PRELAUNCH", requiredPolicyVersions: { terms: "t-3", privacy: "p-3" } };
const T0 = 1_800_000_000_000;

function verified(response, at) {
  return resolvePublicConfigState({
    previous: EMPTY_PUBLIC_CONFIG_STATE,
    fetched: response,
    now: at,
    lastSuccessAt: null,
  });
}

function fail(previous, now) {
  return resolvePublicConfigState({
    previous,
    fetched: null,
    error: new Error("network"),
    now,
    lastSuccessAt: previous.lastSuccessAt,
  });
}

test("grace window is ten minutes", () => {
  assert.equal(PUBLIC_CONFIG_GRACE_MS, 10 * 60_000);
});

test("a valid response replaces the state and stamps the success time", () => {
  const state = verified(live, T0);
  assert.deepEqual(state, {
    serverCapability: "LIVE",
    requiredPolicyVersions: { terms: "t-2", privacy: "p-2" },
    lastSuccessAt: T0,
  });
});

test("an explicit PRELAUNCH response applies immediately over a verified LIVE state", () => {
  const liveState = verified(live, T0);
  const next = resolvePublicConfigState({
    previous: liveState,
    fetched: prelaunch,
    now: T0 + 1_000,
    lastSuccessAt: liveState.lastSuccessAt,
  });
  assert.equal(next.serverCapability, "PRELAUNCH");
  assert.deepEqual(next.requiredPolicyVersions, { terms: "t-3", privacy: "p-3" });
  assert.equal(next.lastSuccessAt, T0 + 1_000);
});

test("a failure inside the grace window keeps the last verified answer", () => {
  const liveState = verified(live, T0);
  for (const elapsed of [1, 30_000, PUBLIC_CONFIG_GRACE_MS]) {
    const next = fail(liveState, T0 + elapsed);
    assert.equal(next.serverCapability, "LIVE");
    assert.deepEqual(next.requiredPolicyVersions, live.requiredPolicyVersions);
    assert.equal(next.lastSuccessAt, T0, "a failure must not extend the grace window");
  }
});

test("repeated failures cannot extend the grace window past ten minutes of the last success", () => {
  let state = verified(live, T0);
  state = fail(state, T0 + 5 * 60_000);
  state = fail(state, T0 + 9 * 60_000);
  assert.equal(state.serverCapability, "LIVE");
  state = fail(state, T0 + PUBLIC_CONFIG_GRACE_MS + 1);
  assert.deepEqual(state, EMPTY_PUBLIC_CONFIG_STATE);
});

test("a failure after the grace window nulls commerce and legal versions", () => {
  const next = fail(verified(live, T0), T0 + PUBLIC_CONFIG_GRACE_MS + 1);
  assert.equal(next.serverCapability, null);
  assert.equal(next.requiredPolicyVersions, null);
  assert.equal(next.lastSuccessAt, null);
});

test("a failure before any success stays null", () => {
  const next = fail(EMPTY_PUBLIC_CONFIG_STATE, T0);
  assert.deepEqual(next, EMPTY_PUBLIC_CONFIG_STATE);
});

test("a success after expiry restores authority", () => {
  const expired = fail(verified(live, T0), T0 + PUBLIC_CONFIG_GRACE_MS + 1);
  const restored = resolvePublicConfigState({
    previous: expired,
    fetched: live,
    now: T0 + PUBLIC_CONFIG_GRACE_MS + 2,
    lastSuccessAt: expired.lastSuccessAt,
  });
  assert.equal(restored.serverCapability, "LIVE");
  assert.equal(restored.lastSuccessAt, T0 + PUBLIC_CONFIG_GRACE_MS + 2);
});

test("a clock that moved backwards does not keep stale authority", () => {
  const next = fail(verified(live, T0), T0 - 1);
  assert.deepEqual(next, EMPTY_PUBLIC_CONFIG_STATE);
});

test("parsePublicConfig accepts only complete LIVE/PRELAUNCH answers", () => {
  assert.deepEqual(parsePublicConfig(live), live);
  assert.deepEqual(parsePublicConfig(prelaunch), prelaunch);
  for (const invalid of [
    null,
    "LIVE",
    {},
    { commerceMode: "OPEN", requiredPolicyVersions: { terms: "t", privacy: "p" } },
    { commerceMode: "LIVE" },
    { commerceMode: "LIVE", requiredPolicyVersions: { terms: "", privacy: "p" } },
    { commerceMode: "LIVE", requiredPolicyVersions: { terms: "t", privacy: 3 } },
  ]) {
    assert.equal(parsePublicConfig(invalid), null);
  }
});
