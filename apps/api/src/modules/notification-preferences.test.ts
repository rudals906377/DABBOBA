import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AppError } from "../lib/errors.js";
import { notificationPreferenceInput } from "./notification-preferences.js";

const completeInput = {
  exchangeUpdates: true,
  requestUpdates: true,
  restockUpdates: false,
  marketingSms: false,
  marketingEmail: false,
  marketingPush: false,
  expectedVersion: 1,
};

test("notification preference updates require the exact six optional-consent booleans and expected version", () => {
  assert.deepEqual(notificationPreferenceInput(completeInput), completeInput);
  // App builds before the 2026-10-07 privacy policy still send the withdrawn
  // personalized-recommendation consent: it is validated and then ignored.
  assert.deepEqual(notificationPreferenceInput({ ...completeInput, personalizedRecommendations: true }), completeInput);
  assert.throws(
    () => notificationPreferenceInput({ ...completeInput, personalizedRecommendations: "true" }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => notificationPreferenceInput({ ...completeInput, orderUpdates: false }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  const { marketingSms: _missing, ...missingBoolean } = completeInput;
  assert.throws(
    () => notificationPreferenceInput(missingBoolean),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
  assert.throws(
    () => notificationPreferenceInput({ ...completeInput, exchangeUpdates: "false" }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test("notification preference migration backfills USER defaults and preserves append-only consent evidence", async () => {
  const sql = await readFile(
    new URL("../../../../packages/db/migrations/0015_notification_preferences.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE notification_preferences/);
  assert.match(sql, /exchange_updates boolean NOT NULL DEFAULT true/);
  assert.match(sql, /request_updates boolean NOT NULL DEFAULT true/);
  assert.match(sql, /marketing_sms boolean NOT NULL DEFAULT false/);
  assert.match(sql, /personalized_recommendations boolean NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /order_updates boolean/i);
  assert.match(sql, /CREATE TABLE notification_preference_events/);
  assert.match(sql, /notification_preference_events_immutable/);
  assert.match(sql, /EXECUTE FUNCTION reject_row_mutation/);
  assert.match(sql, /AFTER INSERT ON users/);
  assert.match(sql, /SELECT id FROM users WHERE role='USER'/);
  assert.match(sql, /before_state jsonb/);
  assert.match(sql, /after_state jsonb NOT NULL/);
});
