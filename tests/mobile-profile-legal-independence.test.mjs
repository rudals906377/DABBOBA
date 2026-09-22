import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
  path.join(root, "apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx"),
  "utf8",
);

test("static member legal route does not wait for or render profile snapshot state", () => {
  assert.match(source, /section === "legal"\s*\?\s*<StaticLegalScreen title=\{meta\.title\} \/>/);

  const staticStart = source.indexOf("function StaticLegalScreen(");
  const profileStart = source.indexOf("function ProfileBackedMemberDetailScreen(");
  assert.ok(staticStart > -1 && profileStart > staticStart);

  const staticScreen = source.slice(staticStart, profileStart);
  assert.match(staticScreen, /<Legal \/>/);
  assert.doesNotMatch(staticScreen, /useProfileSnapshot|ErrorState|Loading|RefreshControl/);

  const profileScreen = source.slice(profileStart, source.indexOf("\nfunction MemberContent(", profileStart));
  assert.match(profileScreen, /useProfileSnapshot\(\)/);
  assert.match(profileScreen, /profileState\.status === "error"/);
});
