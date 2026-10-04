import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const { createClient } = mobileRequire("@supabase/supabase-js");
const ts = mobileRequire("typescript");
const storageKey = "dabboba.auth.broker";

function loadAdapter() {
  const source = readFileSync(new URL("../apps/mobile/src/features/auth/broker-secure-storage.ts", import.meta.url), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Map });
  return module.exports.createBrokerSecureStorage;
}

function makeClient(storage, fetch = async () => { throw new Error("Unexpected network request"); }) {
  return createClient("https://pkce-storage-test.invalid", "public-test-key-not-a-secret-0000", {
    auth: {
      storageKey, storage, flowType: "pkce", persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false,
      experimental: { appendPkceFlowIdToRedirects: true },
    },
    global: { fetch },
  });
}

test("broker opts into the SDK adapter, without using it to persist broker session tokens", () => {
  const source = readFileSync(new URL("../apps/mobile/src/features/auth/supabase-broker.ts", import.meta.url), "utf8");
  assert.match(source, /persistSession:\s*true/);
  assert.match(source, /createBrokerSecureStorage\(BROKER_STORAGE_KEY/);
});

test("real SDK stores PKCE securely and a restarted client can exchange the same flow", async () => {
  const durable = new Map();
  const backend = {
    getItem: async key => durable.get(key) ?? null,
    setItem: async (key, value) => { durable.set(key, value); },
    removeItem: async key => { durable.delete(key); },
  };
  const adapter = loadAdapter()(storageKey, backend);
  const first = makeClient(adapter);
  const { data, error } = await first.auth.signInWithOAuth({
    provider: "google", options: { redirectTo: "dabbobapgreview://auth/callback?state=synthetic-state", skipBrowserRedirect: true },
  });
  assert.equal(error, null);
  assert.ok(data.flowId);
  const verifierKey = `${storageKey}-flow-${data.flowId}-code-verifier`;
  const serializedVerifier = durable.get(verifierKey);
  assert.ok(serializedVerifier, "OAuth verifier must be in secure storage before opening the browser");
  assert.match(data.url, /code_challenge_method=s256/);
  const verifier = JSON.parse(serializedVerifier).split("/")[0];
  let exchanges = 0;
  const restarted = makeClient(loadAdapter()(storageKey, backend), async (url, init) => {
    assert.equal(new URL(url).pathname, "/auth/v1/token");
    assert.equal(new URL(url).searchParams.get("grant_type"), "pkce");
    const body = JSON.parse(init.body);
    assert.equal(body.auth_code, "synthetic-one-time-code");
    assert.equal(body.code_verifier, verifier);
    exchanges += 1;
    return new Response(JSON.stringify({
      access_token: "synthetic-access-token-not-a-credential",
      refresh_token: "synthetic-refresh-token-not-a-credential",
      token_type: "bearer", expires_in: 3600,
      user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-02T00:00:00Z" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await restarted.auth.exchangeCodeForSession("synthetic-one-time-code", { flowId: data.flowId });
  assert.equal(result.error, null);
  assert.equal(result.data.session.access_token, "synthetic-access-token-not-a-credential");
  assert.equal(exchanges, 1);
  assert.equal(durable.has(verifierKey), false, "consumed verifier must be removed");
  assert.equal(durable.has(storageKey), false, "broker access/refresh tokens must never be written to secure storage");
  assert.ok([...durable.values()].every(value => !value.includes("synthetic-access-token") && !value.includes("synthetic-refresh-token")));
  await first.auth.signOut({ scope: "local" });
  await restarted.auth.signOut({ scope: "local" });
});

test("session and unknown SDK keys stay transient; verifier deletion reaches secure storage", async () => {
  const durable = new Map();
  const adapterFactory = loadAdapter();
  const backend = {
    getItem: async key => durable.get(key) ?? null,
    setItem: async (key, value) => { durable.set(key, value); },
    removeItem: async key => { durable.delete(key); },
  };
  const adapter = adapterFactory(storageKey, backend);
  for (const key of [storageKey, `${storageKey}-user`, "unrelated-key", `${storageKey}-flow-../foreign-code-verifier`]) {
    await adapter.setItem(key, "transient");
    assert.equal(await adapter.getItem(key), "transient");
    assert.equal(durable.has(key), false);
    assert.equal(await adapterFactory(storageKey, backend).getItem(key), null);
    await adapter.removeItem(key);
    assert.equal(await adapter.getItem(key), null);
  }
  for (const key of [`${storageKey}-flow-0123456789abcdef-code-verifier`, `${storageKey}-flows-code-verifier`, `${storageKey}-code-verifier`]) {
    await adapter.setItem(key, "secure");
    assert.equal(await adapterFactory(storageKey, backend).getItem(key), "secure");
    await adapter.removeItem(key);
    assert.equal(durable.has(key), false);
  }
});

test("secure storage failures propagate instead of falling back to insecure persistence", async () => {
  const adapter = loadAdapter()(storageKey, {
    getItem: async () => { throw new Error("Secure read failed"); },
    setItem: async () => { throw new Error("Secure write failed"); },
    removeItem: async () => { throw new Error("Secure delete failed"); },
  });
  const key = `${storageKey}-flow-0123456789abcdef-code-verifier`;
  await assert.rejects(adapter.setItem(key, "synthetic-verifier"), /Secure write failed/);
  await assert.rejects(adapter.getItem(key), /Secure read failed/);
  await assert.rejects(adapter.removeItem(key), /Secure delete failed/);
});
