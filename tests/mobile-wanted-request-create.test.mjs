import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("wanted request compose accepts a typed work, registered-IP suggestions, and one photo", () => {
  const screen = read("apps/mobile/src/features/profile/WantedRequestCreateScreen.tsx");
  const api = read("apps/mobile/src/features/profile/wanted-request-api.ts");

  assert.match(screen, /value=\{ipQuery\}/);
  assert.match(screen, /searchWantedIps/);
  assert.match(screen, /등록 IP/);
  assert.match(screen, /pickWantedRequestImage/);
  assert.match(screen, /사진 첨부/);
  assert.match(screen, /uploadWantedRequestImage/);
  assert.match(screen, /mediaId/);
  assert.doesNotMatch(screen, /ipOptions\[0\]/);
  assert.match(api, /WANTED_REQUEST/);
  assert.match(api, /\/v1\/media\/uploads/);
  assert.match(api, /\/v1\/media\/\{mediaId\}\/complete/);
});

test("wanted request compose blocks a coming-soon figure category through the shared availability state", () => {
  const screen = read("apps/mobile/src/features/profile/WantedRequestCreateScreen.tsx");

  assert.match(screen, /isCustomerProductCategoryComingSoon\(category\)/);
  assert.match(screen, /<CategoryAvailabilityState category=\{category\}/);
  assert.match(screen, /categoryComingSoon \? \(/);
  assert.match(screen, /if \(categoryComingSoon\)[\s\S]*?return;/);
});

test("wanted request persistence supports a custom work name and a public attached photo", () => {
  const contract = read("packages/contracts/openapi/dabboba.openapi.yaml");
  const wantedApi = read("apps/api/src/modules/wanted.ts");
  const mediaApi = read("apps/api/src/modules/media.ts");
  const migration = read("packages/db/migrations/0020_wanted_request_custom_ip_media.sql");
  const detail = read("apps/mobile/src/features/profile/WantedRequestDetailScreen.tsx");

  assert.match(contract, /MediaPurpose: \{ type: string, enum: \[[^\]]*WANTED_REQUEST/);
  assert.match(contract, /ipNameKo: \{ type: string, minLength: 1, maxLength: 160 \}/);
  assert.match(contract, /mediaId: \{ type: \[string, "null"\], format: uuid \}/);
  assert.match(wantedApi, /assertReadyOwnedMedia/);
  assert.match(wantedApi, /w\.ip_name_ko/);
  assert.match(mediaApi, /wanted_requests WHERE media_id=\$1/);
  assert.match(migration, /ALTER COLUMN ip_id DROP NOT NULL/);
  assert.match(migration, /ADD COLUMN media_id uuid/);
  assert.match(detail, /request\.mediaUrl/);
});
