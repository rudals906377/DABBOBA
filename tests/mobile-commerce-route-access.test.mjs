import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveCommerceRouteAccess as access,
  resolveServerCapabilitySource,
} from "../apps/mobile/src/lib/runtime-config.ts";

test("PRELAUNCH builds deny every commerce route regardless of server state", () => {
  for (const server of [null, "LIVE", "PRELAUNCH"]) {
    for (const ready of [false, true]) {
      for (const previous of [null, "WAIT", "ALLOW", "DENY"]) {
        assert.equal(access("PRELAUNCH", server, ready, previous), "DENY");
      }
    }
  }
});

test("a new entry waits for the first answer and needs a verified LIVE", () => {
  assert.equal(access("LIVE", null, false), "WAIT");
  assert.equal(access("LIVE", "LIVE", false), "WAIT");
  assert.equal(access("LIVE", "LIVE", true), "ALLOW");
  assert.equal(access("LIVE", null, true), "DENY");
  assert.equal(access("LIVE", null, true, "WAIT"), "DENY");
  assert.equal(access("LIVE", null, true, "DENY"), "DENY");
});

test("an explicit server PRELAUNCH removes even an already rendered route", () => {
  assert.equal(access("LIVE", "PRELAUNCH", true), "DENY");
  assert.equal(access("LIVE", "PRELAUNCH", true, "ALLOW"), "DENY");
  assert.equal(access("LIVE", "PRELAUNCH", false, "ALLOW"), "DENY");
});

test("a failure-induced unknown capability keeps an already rendered route mounted", () => {
  assert.equal(access("LIVE", null, true, "ALLOW"), "ALLOW");
  assert.equal(access("LIVE", null, false, "ALLOW"), "ALLOW");
  // Sticky across repeated failures, then a verified LIVE keeps it, an explicit PRELAUNCH ends it.
  let rendered = access("LIVE", "LIVE", true);
  rendered = access("LIVE", null, true, rendered);
  rendered = access("LIVE", null, true, rendered);
  assert.equal(rendered, "ALLOW");
  rendered = access("LIVE", "LIVE", true, rendered);
  assert.equal(rendered, "ALLOW");
  rendered = access("LIVE", "PRELAUNCH", true, rendered);
  assert.equal(rendered, "DENY");
  assert.equal(access("LIVE", null, true, rendered), "DENY");
});

test("the server capability source distinguishes explicit answers from failure", () => {
  assert.equal(resolveServerCapabilitySource("LIVE"), "VERIFIED");
  assert.equal(resolveServerCapabilitySource("PRELAUNCH"), "VERIFIED");
  assert.equal(resolveServerCapabilitySource(null), "UNAVAILABLE");
});

test("the route gate feeds its last rendered decision back into the access matrix", async () => {
  const { readFileSync } = await import("node:fs");
  const gate = readFileSync(
    new URL("../apps/mobile/src/features/commerce/CommerceRouteGate.tsx", import.meta.url),
    "utf8",
  );
  assert.match(gate, /const renderedAccess = useRef<CommerceRouteAccess \| null>\(null\)/);
  assert.match(gate, /resolveCommerceRouteAccess\(\s*buildCapability,\s*serverCapability,\s*configReady,\s*renderedAccess\.current,\s*\)/);
  assert.match(gate, /renderedAccess\.current = access;/);
});
