import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0076_legal_policy_business_phone.sql", import.meta.url),
  "utf8",
);

const revisedDocuments = [
  {
    key: "TERMS",
    path: new URL("../../../public/legal/terms/index.html", import.meta.url),
    publicUrl: "https://dabboba.net/terms",
    previousSha256: "48b0950d22e7d2716b1824bfa895ed70d86c8ef35e9acbf6778025965b4b9ec6",
  },
  {
    key: "PRIVACY",
    path: new URL("../../../public/legal/privacy/index.html", import.meta.url),
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
    const html = await readFile(document.path);
    const digest = createHash("sha256").update(html).digest("hex");
    assert.notEqual(digest, document.previousSha256, `${document.key} content must differ from the 2026-09-22 version`);
    assert.match(source, new RegExp(`'${document.key}'[\\s\\S]*?'2026-09-22'[\\s\\S]*?'${document.previousSha256}'`, "i"));
    assert.match(
      source,
      new RegExp(
        `\\('${document.key}','2026-09-30','${digest}'[\\s\\S]*?'${document.publicUrl.replaceAll(".", "\\.")}','2026-09-30T00:00:00\\+09:00'\\)`,
        "i",
      ),
    );
    const text = html.toString("utf8");
    assert.match(text, /시행일 2026년 9월 30일/);
    assert.match(text, /<a href="tel:0319479996">031-947-9996<\/a>/);
    assert.doesNotMatch(text, /010-6374-4900|01063744900/);
  }
});
