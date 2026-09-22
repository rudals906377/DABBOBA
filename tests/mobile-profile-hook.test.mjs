import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireMobile = createRequire(`${root}/apps/mobile/package.json`);
const ts = requireMobile("typescript");
const stateHelpers = await import(`${root}/apps/mobile/src/features/profile/profile-session-state.ts`);
const { createGuestSnapshot } = await import(`${root}/apps/mobile/src/features/profile/guest-profile-snapshot.ts`);
const source = readFileSync(`${root}/apps/mobile/src/features/profile/use-profile-snapshot.ts`, "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

class ProfileApiError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

const guest = () => createGuestSnapshot([], {}, [], []);
const member = (name = "member") => ({
  ...guest(),
  isExample: false,
  actor: { userId: name },
  profile: { nickname: name },
  pointBalance: 3200,
  inventory: [{ id: "owned" }],
});
const tokens = (accessToken) => ({ accessToken, refreshToken: "test-only-refresh" });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let index = 0; index < 12; index += 1) await new Promise(setImmediate);
};

function mount(initialTokens, fetchSnapshot) {
  const values = [];
  const effects = [];
  const emissions = [];
  let stored = initialTokens;
  const scope = {
    exports: {},
    process: { env: {} },
    __DEV__: true,
    require(name) {
      if (name === "expo-constants") return { default: { expoConfig: {} } };
      if (name === "react-native") return { Platform: { OS: "ios" } };
      if (name === "react") {
        return {
          useCallback: (fn) => fn,
          useMemo: (fn) => fn(),
          useRef: (value) => ({ current: value }),
          useEffect: (fn) => effects.push(fn),
          useState(value) {
            const index = values.length;
            values.push(typeof value === "function" ? value() : value);
            return [values[index], (update) => {
              values[index] = typeof update === "function" ? update(values[index]) : update;
              if (index === 0) emissions.push(values[index]);
            }];
          },
        };
      }
      if (name.endsWith("/profile-api")) {
        return { fetchProfileSnapshot: fetchSnapshot, createGuestSnapshot, ProfileApiError };
      }
      if (name.endsWith("/profile-session-state")) return stateHelpers;
      if (name.endsWith("/StorefrontCategorySettingsProvider")) {
        return { useStorefrontCategorySettings: () => ({ revision: 0 }) };
      }
      if (name.endsWith("/runtime-config")) {
        return { resolveMobileRuntimeConfig: () => ({ apiBaseUrl: "http://test.invalid" }) };
      }
      if (name.endsWith("/session-store")) return { readAuthTokens: async () => stored };
      throw new Error(`Unexpected dependency ${name}`);
    },
  };
  runInNewContext(code, scope);
  const hook = scope.exports.useProfileSnapshot();
  const cleanups = effects.map((effect) => effect());
  return {
    hook,
    emissions,
    get state() { return values[0]; },
    setTokens(value) { stored = value; },
    unmount() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

test("guest login is available while public data is still pending", async () => {
  const pending = deferred();
  const harness = mount(null, () => pending.promise);
  await flush();
  assert.equal(harness.state.status, "guest");
  assert.equal(harness.state.publicLoading, true);
  assert.equal(harness.state.snapshot.profile.nickname, "");
  pending.resolve(guest());
  await flush();
  assert.equal(harness.state.publicLoading, false);
  harness.unmount();
});

test("late guest fetch cannot overwrite a new login", async () => {
  const pending = deferred();
  const harness = mount(null, (_url, token) => (
    token ? Promise.resolve(member("new")) : pending.promise
  ));
  await flush();
  harness.setTokens(tokens("new"));
  pending.resolve(guest());
  await flush();
  assert.equal(harness.state.status, "authenticated");
  assert.equal(harness.state.snapshot.profile.nickname, "new");
  harness.unmount();
});

test("late old-account response clears private data before loading the current account", async () => {
  const pending = deferred();
  const current = deferred();
  const harness = mount(tokens("old"), (_url, token) => (
    token === "old" ? pending.promise : current.promise
  ));
  await flush();
  harness.setTokens(tokens("new"));
  pending.resolve(member("old"));
  await flush();
  assert.equal(harness.state.status, "loading");
  assert.equal(harness.state.snapshot, null);
  current.resolve(member("new"));
  await flush();
  assert.equal(harness.state.status, "authenticated");
  assert.equal(harness.state.accessToken, "new");
  assert.equal(harness.state.snapshot.profile.nickname, "new");
  harness.unmount();
});

test("401 clears private data and late public fallback cannot replace a new login", async () => {
  const failed = deferred();
  const publicPending = deferred();
  const harness = mount(tokens("old"), (_url, token) => {
    if (token === "old") return failed.promise;
    if (token) return Promise.resolve(member("new"));
    return publicPending.promise;
  });
  await flush();
  harness.setTokens(null);
  failed.reject(new ProfileApiError(401));
  await flush();
  assert.equal(harness.state.status, "expired");
  assert.equal(harness.state.accessToken, null);
  assert.equal(harness.state.snapshot.profile.nickname, "");
  harness.setTokens(tokens("new"));
  publicPending.resolve(guest());
  await flush();
  assert.equal(harness.state.status, "authenticated");
  assert.equal(harness.state.accessToken, "new");
  harness.unmount();
});

test("newer reload wins even when an earlier response arrives last", async () => {
  const old = deferred();
  const current = deferred();
  let call = 0;
  const harness = mount(tokens("same"), () => (++call === 1 ? old.promise : current.promise));
  await flush();
  const reload = harness.hook.reload();
  await flush();
  current.resolve(member("current"));
  await reload;
  old.resolve(member("stale"));
  await flush();
  assert.equal(harness.state.snapshot.profile.nickname, "current");
  harness.unmount();
});

test("unmount prevents all late state writes", async () => {
  const pending = deferred();
  const harness = mount(tokens("same"), () => pending.promise);
  await flush();
  harness.unmount();
  const count = harness.emissions.length;
  pending.resolve(member());
  await flush();
  assert.equal(harness.emissions.length, count);
});

test("same-token refresh keeps authoritative private data through a transient failure", async () => {
  const refresh = deferred();
  let call = 0;
  const harness = mount(tokens("same"), () => (++call === 1 ? Promise.resolve(member()) : refresh.promise));
  await flush();
  assert.equal(harness.state.snapshot.pointBalance, 3200);
  const reload = harness.hook.reload();
  await flush();
  assert.equal(harness.state.status, "authenticated");
  assert.equal(harness.state.snapshot.pointBalance, 3200);
  refresh.reject(new ProfileApiError(503));
  await reload;
  assert.equal(harness.state.status, "authenticated");
  assert.equal(harness.state.snapshot.pointBalance, 3200);
  assert.ok(harness.state.message);
  harness.unmount();
});

test("initial authenticated failure never invents or preserves private data", async () => {
  const harness = mount(tokens("same"), async () => { throw new ProfileApiError(503); });
  await flush();
  assert.equal(harness.state.status, "error");
  assert.equal(harness.state.snapshot, null);
  harness.unmount();
});

test("public network failure preserves guest login with an explicit public error", async () => {
  const harness = mount(null, async () => { throw new Error("network"); });
  await flush();
  assert.equal(harness.state.status, "guest");
  assert.equal(harness.state.publicLoading, false);
  assert.ok(harness.state.message);
  assert.equal(harness.state.snapshot.inquiries.length, 0);
  harness.unmount();
});
