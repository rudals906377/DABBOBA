import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const screen = readFileSync(new URL(
  "../apps/mobile/src/features/draw/DrawRevealScreen.tsx",
  import.meta.url,
), "utf8");
const guardBody = screen.match(
  /const isCurrentRequest = useCallback\(\(generation: number, owner: string\) => \(([\s\S]*?)\n  \), \[\]\);/,
)?.[1];
assert.ok(guardBody, "late responses must be owned by one mounted draw route and request generation");

test("a late draw response cannot write into a changed, superseded, or unmounted route", () => {
  const scope = {
    requestMountedRef: { current: true },
    requestGenerationRef: { current: 1 },
    activeRouteKeyRef: { current: "committed:entitlement-a:product-a" },
  };
  const isCurrent = runInNewContext(`(generation, owner) => (${guardBody})`, scope);
  const originalOwner = scope.activeRouteKeyRef.current;
  assert.equal(isCurrent(1, originalOwner), true);

  // Route ownership changes during render, before the reset effect runs.
  scope.activeRouteKeyRef.current = "committed:entitlement-b:product-b";
  assert.equal(isCurrent(1, originalOwner), false);

  scope.activeRouteKeyRef.current = originalOwner;
  scope.requestGenerationRef.current = 2;
  assert.equal(isCurrent(1, originalOwner), false);
  assert.equal(isCurrent(2, originalOwner), true);

  scope.requestMountedRef.current = false;
  assert.equal(isCurrent(2, originalOwner), false);
});

test("consume completion, failure, and final cleanup all check the current request owner", () => {
  const openProduct = screen.slice(
    screen.indexOf("  const openProduct = async () => {"),
    screen.indexOf("  const handleRevealSettled = () => {"),
  );
  assert.match(openProduct, /const generation = \+\+requestGenerationRef\.current/);
  assert.match(openProduct, /const owner = routeKey/);
  assert.match(openProduct, /await readAuthTokens\(\);\s*if \(!isCurrentRequest\(generation, owner\)\) return/);
  assert.match(openProduct, /await consumeDrawEntitlement\([\s\S]*?\);\s*if \(!isCurrentRequest\(generation, owner\)\) return/);
  assert.match(openProduct, /committedSnapshot = null;\s*\}\s*if \(!isCurrentRequest\(generation, owner\)\) return/);
  assert.match(openProduct, /catch \(error\) \{\s*if \(!isCurrentRequest\(generation, owner\)\) return/);
  assert.match(openProduct, /finally \{\s*if \(isCurrentRequest\(generation, owner\)\) setOpening\(false\)/);
  assert.match(screen, /setResult\(null\);[\s\S]*?\}, \[routeKey\]\)/);
  // The initial mount already starts fresh; only a later route change resets the stage.
  assert.match(screen, /const resetRouteKeyRef = useRef\(routeKey\);\s*useEffect\(\(\) => \{\s*if \(resetRouteKeyRef\.current === routeKey\) return;\s*resetRouteKeyRef\.current = routeKey;/);
});
