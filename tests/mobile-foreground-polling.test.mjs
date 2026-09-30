import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isAppStateActive, startForegroundInterval } from "../apps/mobile/src/lib/foreground-interval.ts";

const read = (path) => readFileSync(new URL(`../apps/mobile/src/${path}`, import.meta.url), "utf8");

function harness(initialState = "active") {
  let listener = null;
  let removed = false;
  const intervals = new Map();
  let nextHandle = 1;
  const appState = {
    currentState: initialState,
    addEventListener: (_type, callback) => {
      listener = callback;
      return { remove: () => { removed = true; } };
    },
  };
  const timers = {
    setInterval: (callback, ms) => {
      const handle = nextHandle++;
      intervals.set(handle, { callback, ms });
      return handle;
    },
    clearInterval: (handle) => { intervals.delete(handle); },
  };
  return {
    appState,
    timers,
    intervals,
    emit: (state) => listener(state),
    get removed() { return removed; },
  };
}

test("foreground polling runs only while the app is active and catches up on return", () => {
  const h = harness("active");
  let ticks = 0;
  const stop = startForegroundInterval(h.appState, () => { ticks += 1; }, 30_000, { timers: h.timers });
  assert.equal(h.intervals.size, 1);
  assert.equal([...h.intervals.values()][0].ms, 30_000);

  h.emit("inactive");
  assert.equal(h.intervals.size, 0);
  h.emit("background");
  assert.equal(h.intervals.size, 0);

  h.emit("active");
  assert.equal(ticks, 1, "a return to the foreground refreshes immediately");
  assert.equal(h.intervals.size, 1);
  h.emit("active");
  assert.equal(h.intervals.size, 1, "repeated active events never stack intervals");

  stop();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.removed, true);
});

test("a background launch does not start polling until the app becomes active", () => {
  const h = harness("background");
  let ticks = 0;
  startForegroundInterval(h.appState, () => { ticks += 1; }, 1_000, { timers: h.timers, refreshOnForeground: false });
  assert.equal(h.intervals.size, 0);
  h.emit("active");
  assert.equal(ticks, 0);
  assert.equal(h.intervals.size, 1);
  assert.equal(isAppStateActive("unknown"), true);
  assert.equal(isAppStateActive(null), true);
});

test("providers and the kuji room poll use foreground-only intervals", () => {
  const categories = read("features/catalog/StorefrontCategorySettingsProvider.tsx");
  assert.match(categories, /const CATEGORY_REFRESH_INTERVAL_MS = 5 \* 60_000;/);
  assert.match(categories, /startForegroundInterval\(AppState, \(\) => void refresh\(\), CATEGORY_REFRESH_INTERVAL_MS\)/);
  assert.doesNotMatch(categories, /setInterval\(/);

  const commerce = read("features/commerce/CommerceCapabilityProvider.tsx");
  assert.match(commerce, /const PUBLIC_CONFIG_REFRESH_INTERVAL_MS = 30_000;/);
  assert.match(commerce, /startForegroundInterval\(AppState, \(\) => void refresh\(\), PUBLIC_CONFIG_REFRESH_INTERVAL_MS\)/);
  assert.doesNotMatch(commerce, /setInterval\(/);

  const queue = read("features/kuji/KujiQueueScreen.tsx");
  assert.match(queue, /const KUJI_ROOM_POLL_INTERVAL_MS = 2_000;/);
  assert.match(queue, /useFocusEffect\(useCallback\(\(\) => \{\s*if \(!shouldPoll \|\| !entryId\) return undefined;[\s\S]*?startForegroundInterval\(AppState, \(\) => void poll\(\), KUJI_ROOM_POLL_INTERVAL_MS\)/);
  assert.doesNotMatch(queue, /setInterval\(/);
});
