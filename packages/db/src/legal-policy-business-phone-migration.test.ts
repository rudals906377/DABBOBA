import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0076_legal_policy_business_phone.sql", import.meta.url),
  "utf8",
);

// TERMS and PRIVACY were revised again by migration 0090 (LIVE 2026-10-07), so
// their 2026-09-30 evidence is pinned here as immutable history instead of
// being recomputed from the current public HTML.
const revisedDocuments = [
  {
    key: "TERMS",
    sha256: "213e14a2499ed6a929c81455e736b5aa3d60f0e05f0d59fe5d9fc662e0782f23",
    publicUrl: "https://dabboba.net/terms",
    previousSha256: "48b0950d22e7d2716b1824bfa895ed70d86c8ef35e9acbf6778025965b4b9ec6",
  },
  {
    key: "PRIVACY",
    sha256: "6053eb3dd4c02cfe44fb30983910f4a9d7bade3a1f03d8f58a00a490119e89dd",
    publicUrl: "https://dabboba.net/privacy",
    previousSha256: "6c1067c30ca2fd55628f0c443975fbfc243537d1e5c99217011e1d5714d88739",
  },
] as const;

test("publishes the business-phone policy revision as a new version bound to the current HTML", async () => {
  const source = await migration;

  assert.match(source, /Unexpected current TERMS\/PRIVACY evidence before business phone revision/i);
  assert.match(source, /SET superseded_at = '2026-09-30T00:00:00\+09:00'/i);
  assert.doesNotMatch(source, /'OPERATIONS'/);

  for (const document of revisedDocuments) {
    assert.notEqual(document.sha256, document.previousSha256, `${document.key} content must differ from the 2026-09-22 version`);
    assert.match(source, new RegExp(`'${document.key}'[\\s\\S]*?'2026-09-22'[\\s\\S]*?'${document.previousSha256}'`, "i"));
    assert.match(
      source,
      new RegExp(
        `\\('${document.key}','2026-09-30','${document.sha256}'[\\s\\S]*?'${document.publicUrl.replaceAll(".", "\\.")}','2026-09-30T00:00:00\\+09:00'\\)`,
        "i",
      ),
    );
  }
});
