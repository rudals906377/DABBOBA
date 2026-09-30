import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const home = readFileSync(new URL("../apps/mobile/src/features/home/HomeScreen.tsx", import.meta.url), "utf8");

test("Home joins an in-flight load instead of starting a duplicate from mount and focus", () => {
  assert.match(home, /if \(!manual && loadInFlight\.current\?\.key === key\) return loadInFlight\.current\.promise;/);
  assert.match(home, /const generation = \+\+loadGeneration\.current;/);
  // Superseded loads never write state or the cache after a newer load started.
  assert.match(home, /const cached = await readHomeCatalogCache\(db\)\.catch\(\(\) => null\);\s*if \(!isCurrent\(\)\) return;/);
  assert.match(home, /if \(loadInFlight\.current\?\.generation === generation\) loadInFlight\.current = null;/);
  assert.match(home, /useEffect\(\(\) => \{\s*void load\(\);\s*\}, \[load\]\);/);
  assert.match(home, /useFocusEffect\(\s*useCallback\(\(\) => \{\s*if \(!initialLoadCompleted\.current\) return undefined;\s*void load\(\);/);
});
