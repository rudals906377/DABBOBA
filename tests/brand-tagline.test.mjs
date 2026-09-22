import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("every active customer surface uses the approved DABBOBA tagline", async () => {
  for (const relativePath of [
    "src/Prototype.tsx",
    "apps/mobile/src/features/home/HomeScreen.tsx",
    "apps/storefront/src/App.tsx",
    "apps/storefront/index.html",
    "public/legal/index.html",
  ]) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    assert.match(source, /원하는 거 다 뽀바/, `${relativePath} is missing the approved tagline`);
    assert.doesNotMatch(source, /원하는 거 다 뽑아/, `${relativePath} still contains the retired tagline`);
  }
});
