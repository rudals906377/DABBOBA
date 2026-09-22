import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../migrations/0040_customer_auth_providers.sql", import.meta.url),
  "utf8",
);

test("0040 enables the five customer methods without deleting legacy phone identities", () => {
  for (const provider of ["KAKAO", "NAVER", "GOOGLE", "APPLE", "EMAIL"]) {
    assert.match(sql, new RegExp(`'${provider}'`));
  }
  assert.match(sql, /'PHONE'/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+auth_identities/i);
  assert.match(sql, /DROP CONSTRAINT auth_identities_provider_check/i);
  assert.match(sql, /ADD CONSTRAINT auth_identities_provider_check/i);
});
