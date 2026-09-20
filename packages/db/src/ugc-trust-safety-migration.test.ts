import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reportMigration = readFile(
  new URL("../migrations/0055_ugc_trust_safety.sql", import.meta.url),
  "utf8",
);
const policyMigration = readFile(
  new URL("../migrations/0057_ugc_operations_policy_evidence.sql", import.meta.url),
  "utf8",
);
const publicPolicy = readFile(
  new URL("../../../public/legal/community-operations/index.html", import.meta.url),
);

test("exchange and wanted content can use the existing report pipeline", async () => {
  const source = await reportMigration;

  assert.match(source, /content_reports_target_type_check/i);
  assert.match(source, /moderation_actions_action_check/i);
  assert.match(source, /'EXCHANGE_LISTING'/i);
  assert.match(source, /'WANTED_REQUEST'/i);
  assert.match(source, /'HIDE_EXCHANGE_LISTING'/i);
  assert.match(source, /'HIDE_WANTED_REQUEST'/i);
  assert.doesNotMatch(source, /GRANT\s+/i);
});

test("UGC policy acceptance binds the exact published document in append-only evidence", async () => {
  const [source, document] = await Promise.all([policyMigration, publicPolicy]);
  const digest = createHash("sha256").update(document).digest("hex");

  assert.match(source, /policy_key IN \('TERMS','PRIVACY','OPERATIONS'\)/i);
  assert.match(source, /source IN \('MOBILE_LOGIN','WEB_ACCOUNT_DELETION','UGC_OPERATION'\)/i);
  assert.match(source, /'https:\/\/dabboba\.com\/community-operations'/i);
  assert.match(source, new RegExp(`'OPERATIONS','2026-09-20','${digest}'`, "i"));
  assert.doesNotMatch(source, /GRANT\s+/i);
});
