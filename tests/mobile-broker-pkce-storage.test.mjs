import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createPkceOnlyStorage } from "../apps/mobile/src/features/auth/broker-pkce-storage.ts";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const { createClient } = mobileRequire("@supabase/supabase-js");

test("OAuth keeps its PKCE verifier in secure storage without persisting the broker session", async () => {
  const saved = new Map();
  const backing = {
    getItem: async (key) => saved.get(key) ?? null,
    setItem: async (key, value) => { saved.set(key, value); },
    removeItem: async (key) => { saved.delete(key); },
  };
  const storageKey = "dabboba.auth.broker.test";
  const storage = createPkceOnlyStorage(storageKey, backing);
  const client = createClient("https://example.supabase.co", "sb_publishable_test_only_1234567890", {
    auth: {
      storageKey,
      storage,
      flowType: "pkce",
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      experimental: { appendPkceFlowIdToRedirects: true },
    },
  });

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: "dabboba://auth/callback", skipBrowserRedirect: true },
  });
  assert.equal(error, null);
  assert.ok(data.flowId);
  assert.ok(await storage.getItem(`${storageKey}-flow-${data.flowId}-code-verifier`));
  assert.ok(saved.has(`${storageKey}-flows-code-verifier`));

  await storage.setItem(storageKey, "test-session");
  assert.equal(await storage.getItem(storageKey), null);
  assert.equal(saved.has(storageKey), false);
});
