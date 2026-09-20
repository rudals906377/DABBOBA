import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0059_expo_push_delivery.sql", import.meta.url),
  "utf8",
);

test("Expo push migration binds tokens to sessions and persists bounded delivery state", async () => {
  const source = await migration;

  assert.match(source, /CREATE TABLE public\.push_device_tokens/i);
  assert.match(source, /session_id uuid NOT NULL REFERENCES public\.sessions\(id\) ON DELETE CASCADE/i);
  assert.match(source, /UNIQUE \(user_id, installation_id\)/i);
  assert.match(source, /push_device_tokens_active_expo_token_idx/i);
  assert.match(source, /CREATE TABLE public\.push_notification_deliveries/i);
  assert.match(source, /UNIQUE \(notification_id, push_device_token_id\)/i);
  assert.match(source, /send_attempt_count BETWEEN 0 AND 8/i);
  assert.match(source, /receipt_attempt_count BETWEEN 0 AND 8/i);
  assert.match(source, /ENABLE ROW LEVEL SECURITY/gi);
  assert.match(source, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.push_device_tokens TO dabboba_runtime/i);
  assert.match(source, /GRANT SELECT, UPDATE, DELETE ON TABLE public\.push_device_tokens TO dabboba_worker/i);
  assert.match(source, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.push_notification_deliveries TO dabboba_worker/i);
  assert.match(source, /GRANT SELECT \(id,user_id,session_kind,revoked_at,expires_at\)[\s\S]*?public\.sessions TO dabboba_worker/i);
  assert.doesNotMatch(source, /GRANT .* TO (?:PUBLIC|anon|authenticated)/i);
});
