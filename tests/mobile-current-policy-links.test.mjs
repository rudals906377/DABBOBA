import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("login policy links open the published full documents before consent", () => {
  const login = read("apps/mobile/src/features/auth/LoginScreen.tsx");

  assert.match(login, /resolvePublicAppLink\(kind\)/);
  assert.match(login, /Linking\.openURL\(url\)/);
  assert.match(login, /onOpen=\{\(\) => openCurrentPolicy\("terms"\)\}/);
  assert.match(login, /onOpen=\{\(\) => openCurrentPolicy\("privacy"\)\}/);
});

test("app legal summaries show the published policy effective date", () => {
  const policies = read("apps/mobile/src/features/profile/profile-policies.ts");
  const detail = read("apps/mobile/src/features/profile/ProfilePolicyDetailScreen.tsx");
  const terms = read("public/legal/terms/index.html");
  const privacy = read("public/legal/privacy/index.html");

  for (const document of [terms, privacy]) {
    assert.match(document, /시행일 2026년 10월 7일/);
  }
  assert.match(policies, /id: "terms",[\s\S]*?updatedAt: "2026\.10\.07"/);
  assert.match(policies, /id: "privacy",[\s\S]*?updatedAt: "2026\.10\.07"/);
  assert.match(detail, /공개 문서 시행일/);
  assert.match(detail, /\{policy\.updatedAt\}/);
  assert.match(detail, /핵심 안내/);
});
