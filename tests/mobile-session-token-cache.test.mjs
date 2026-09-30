import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = mobileRequire("typescript");
const code = ts.transpileModule(
  readFileSync(new URL("../apps/mobile/src/lib/session-store.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const access = "access-token-000000000001";
const refresh = "refresh-token-00000000001";

function loadStore(initial = {}) {
  const items = new Map(Object.entries(initial));
  const reads = [];
  const writes = [];
  const secureStore = {
    getItemAsync: async (key) => { reads.push(key); return items.get(key) ?? null; },
    setItemAsync: async (key, value) => { writes.push(key); items.set(key, value); },
    deleteItemAsync: async (key) => { writes.push(`-${key}`); items.delete(key); },
  };
  const module = { exports: {} };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name === "expo-secure-store") return secureStore;
      throw new Error(`Unexpected dependency ${name}`);
    },
    JSON,
    Date,
    Number,
    Promise,
    Set,
    Array,
  });
  return { store: module.exports, items, reads, writes };
}

const record = (accessToken, refreshToken) => JSON.stringify({ version: 1, accessToken, refreshToken });

test("repeated and concurrent token reads hit SecureStore once until a change", async () => {
  const { store, reads } = loadStore({ "dabboba.auth.session.v1": record(access, refresh) });
  const [first, second] = await Promise.all([store.readAuthTokens(), store.readAuthTokens()]);
  assert.equal(first.accessToken, access);
  assert.equal(second.accessToken, access);
  await store.readAuthTokens();
  assert.equal(reads.filter((key) => key === "dabboba.auth.session.v1").length, 1);
});

test("a token write invalidates the cache so the next read returns the new session", async () => {
  const { store, reads } = loadStore({ "dabboba.auth.session.v1": record(access, refresh) });
  await store.readAuthTokens();
  let notified = 0;
  let observed = null;
  store.subscribeAuthTokens(() => {
    notified += 1;
    void store.readAuthTokens().then((value) => { observed = value; });
  });
  await store.writeAuthTokens({ accessToken: "access-token-000000000002", refreshToken: "refresh-token-00000000002" });
  assert.equal(notified, 1);
  const next = await store.readAuthTokens();
  assert.equal(next.accessToken, "access-token-000000000002");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(observed.accessToken, "access-token-000000000002");
  const recordReads = reads.filter((key) => key === "dabboba.auth.session.v1").length;
  await store.readAuthTokens();
  assert.equal(reads.filter((key) => key === "dabboba.auth.session.v1").length, recordReads);
});

test("compare-and-swap still compares against SecureStore, not the cached copy", async () => {
  const { store, items } = loadStore({ "dabboba.auth.session.v1": record(access, refresh) });
  await store.readAuthTokens();
  // Another writer changed the stored record behind the cache.
  items.set("dabboba.auth.session.v1", record("access-token-000000000003", "refresh-token-00000000003"));
  const result = await store.replaceAuthTokensIfCurrent(
    { accessToken: access, refreshToken: refresh },
    { accessToken: "access-token-000000000004", refreshToken: "refresh-token-00000000004" },
  );
  assert.equal(result.accessToken, "access-token-000000000003");
  assert.equal(await store.clearAuthTokensIfCurrent({ accessToken: access, refreshToken: refresh }), false);
  assert.equal(await store.clearAuthTokensIfCurrent({ accessToken: "access-token-000000000003", refreshToken: "refresh-token-00000000003" }), true);
  assert.equal(await store.readAuthTokens(), null);
});

test("legacy individual keys keep being written until the retirement flag exists", async () => {
  const mirrored = loadStore();
  await mirrored.store.writeAuthTokens({ accessToken: access, refreshToken: refresh });
  assert.equal(mirrored.items.get("dabboba.auth.access-token"), access);

  const retired = loadStore({ "dabboba.auth.legacy-keys-retired.v1": "1" });
  await retired.store.writeAuthTokens({ accessToken: access, refreshToken: refresh });
  assert.equal(retired.items.has("dabboba.auth.access-token"), false);
  assert.equal(JSON.parse(retired.items.get("dabboba.auth.session.v1")).accessToken, access);
  // Legacy keys are still read when no versioned record exists.
  const legacyOnly = loadStore({ "dabboba.auth.access-token": access, "dabboba.auth.refresh-token": refresh });
  assert.equal((await legacyOnly.store.readAuthTokens()).refreshToken, refresh);
});
