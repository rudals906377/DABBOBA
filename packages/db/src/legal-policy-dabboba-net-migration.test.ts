import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0065_legal_policy_dabboba_net.sql", import.meta.url),
  "utf8",
);

const publishedDocuments = [
  {
    key: "TERMS",
    path: new URL("../../../public/legal/terms/index.html", import.meta.url),
    publicUrl: "https://dabboba.net/terms",
  },
  {
    key: "PRIVACY",
    path: new URL("../../../public/legal/privacy/index.html", import.meta.url),
    publicUrl: "https://dabboba.net/privacy",
  },
  {
    key: "OPERATIONS",
    path: new URL("../../../public/legal/community-operations/index.html", import.meta.url),
    publicUrl: "https://dabboba.net/community-operations",
  },
] as const;

test("publishes dabboba.net policy evidence without rewriting historical rows", async () => {
  const source = await migration;

  assert.match(source, /Unexpected current policy evidence before dabboba\.net publication/i);
  assert.match(source, /SET superseded_at = '2026-09-22T00:00:00\+09:00'/i);
  assert.match(source, /'https:\/\/dabboba\.com\/terms'/i);
  assert.match(source, /'https:\/\/dabboba\.net\/terms'/i);

  for (const document of publishedDocuments) {
    const digest = createHash("sha256").update(await readFile(document.path)).digest("hex");
    assert.match(
      source,
      new RegExp(
        `\\('${document.key}','2026-09-22','${digest}'[\\s\\S]*?'${document.publicUrl.replaceAll(".", "\\.")}'`,
        "i",
      ),
    );
  }
});
