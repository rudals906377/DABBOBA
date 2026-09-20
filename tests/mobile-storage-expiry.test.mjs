import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { storageExpiryState } from "../apps/mobile/src/features/profile/storage-expiry.ts";

const profileSectionSource = readFileSync(
  new URL("../apps/mobile/src/features/profile/ProfileSectionScreen.tsx", import.meta.url),
  "utf8",
);
const accountApiSource = readFileSync(
  new URL("../apps/api/src/modules/account.ts", import.meta.url),
  "utf8",
);

const DAY_MS = 86_400_000;

test("storage expiry uses only the server deadline and rounds a partial day up", () => {
  const nowMs = Date.parse("2026-09-14T00:00:00.000Z");
  const sixtyDays = storageExpiryState(
    new Date(nowMs + 60 * DAY_MS).toISOString(),
    nowMs,
  );
  const partialDay = storageExpiryState(
    new Date(nowMs + 1).toISOString(),
    nowMs,
  );

  assert.deepEqual(sixtyDays, {
    expiresAtMs: nowMs + 60 * DAY_MS,
    remainingDays: 60,
    isExpired: false,
  });
  assert.equal(partialDay?.remainingDays, 1);
  assert.equal(partialDay?.isExpired, false);
});

test("storage expiry reports the deadline as expired without negative days", () => {
  const deadlineMs = Date.parse("2026-09-14T00:00:00.000Z");

  assert.deepEqual(
    storageExpiryState(new Date(deadlineMs).toISOString(), deadlineMs),
    { expiresAtMs: deadlineMs, remainingDays: 0, isExpired: true },
  );
  assert.deepEqual(
    storageExpiryState(new Date(deadlineMs - DAY_MS).toISOString(), deadlineMs),
    { expiresAtMs: deadlineMs - DAY_MS, remainingDays: 0, isExpired: true },
  );
});

test("storage expiry never invents a deadline when the server value is absent or invalid", () => {
  assert.equal(storageExpiryState(undefined, 0), null);
  assert.equal(storageExpiryState("not-a-date", 0), null);
  assert.equal(storageExpiryState("2026-09-14T00:00:00.000Z", Number.NaN), null);
});

test("stored inventory cards show the 60-day policy, server expiry date, and remaining days", () => {
  assert.match(profileSectionSource, /storageExpiresAt=\{item\.storageExpiresAt\}/);
  assert.match(profileSectionSource, /보관 만료 60일/);
  assert.match(profileSectionSource, /만료일 \{formatDate\(storageExpiresAt\)\} · \{remainingLabel\}/);
  assert.match(profileSectionSource, /disabled=\{storageExpiry\?\.isExpired \?\? false\}/);
  assert.doesNotMatch(profileSectionSource, /acquiredAt[\s\S]{0,120}60\s*\*/);
});

test("expired inventory is returned only in the explicit non-actionable hold state", () => {
  assert.match(
    accountApiSource,
    /iu\.status IN \('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED','SHIPPING','EXPIRED_HOLD'\)/,
  );
  assert.match(
    accountApiSource,
    /\(iu\.status IN \('SHIPPING','EXPIRED_HOLD'\) OR iu\.storage_expires_at>now\(\)\)/,
  );
  assert.match(
    accountApiSource,
    /UPDATE inventory_units SET status='SHIPPING'[\s\S]*?storage_expires_at>now\(\)/,
  );
  assert.match(
    accountApiSource,
    /UPDATE inventory_units SET status='POINT_RETURNED'[\s\S]*?storage_expires_at>now\(\)/,
  );
  assert.match(profileSectionSource, /item\.status === "OWNED" \|\| item\.status === "EXPIRED_HOLD"/);
  assert.match(profileSectionSource, /item\.status === "EXPIRED_HOLD"[\s\S]*?자동 폐기되지 않아요/);
  assert.match(profileSectionSource, /selectable=\{commerceEnabled && item\.status === "OWNED"/);
});
