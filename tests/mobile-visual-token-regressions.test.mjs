import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("customer catalog surfaces use canonical radius tokens without changing geometry", () => {
  const seedSource = readSource("apps/mobile/src/design-system/seed.ts");
  const sources = [
    "apps/mobile/src/components/FloatingBottomActionPanel.tsx",
    "apps/mobile/src/features/home/HomeScreen.tsx",
    "apps/mobile/src/features/home/AnnouncementTicker.tsx",
    "apps/mobile/src/features/shop/ShopScreen.tsx",
    "apps/mobile/src/features/shop/ProductDetailScreen.tsx",
    "apps/mobile/src/features/dukroom/DukroomScreen.tsx",
    "apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx",
  ].map(readSource).join("\n");

  assert.match(seedSource, /radius:\s*\{[\s\S]*?none:\s*0,[\s\S]*?r0_25:\s*1,[\s\S]*?r1_75:\s*7,[\s\S]*?r5_5:\s*22,/);
  assert.match(sources, /borderRadius:\s*seed\.radius\.r5_5/);
  assert.match(sources, /borderRadius:\s*seed\.radius\.r1_75/);
  assert.match(sources, /borderRadius:\s*seed\.radius\.full/);
  assert.doesNotMatch(sources, /borderRadius:\s*\d+(?:\.\d+)?(?:\D|$)/);
});

test("kuji Android notification light reuses the side-effect-free app theme token", () => {
  const source = readSource("apps/mobile/src/features/kuji/kuji-notifications.ts");

  assert.match(source, /import \{ colors \} from "@\/theme";/);
  assert.match(source, /lightColor:\s*colors\.brand/);
  assert.doesNotMatch(source, /lightColor:\s*"#91E98E"/);
});
