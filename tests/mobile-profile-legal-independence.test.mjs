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
  assert.match(profileScreen, /useProfileSnapshot\("member"\)/);
  assert.match(profileScreen, /profileState\.status === "error"/);
});

test("every profile snapshot consumer declares a section scope", async () => {
  const { readdirSync, readFileSync: read } = await import("node:fs");
  const dirs = ["apps/mobile/src/features/profile", "apps/mobile/src/features/history"];
  for (const dir of dirs) {
    for (const file of readdirSync(new URL(`../${dir}`, import.meta.url))) {
      if (!file.endsWith(".tsx")) continue;
      const source = read(new URL(`../${dir}/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /useProfileSnapshot\(\)/, `${dir}/${file}`);
    }
  }
});
