import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0065_legal_policy_dabboba_net.sql", import.meta.url),
  "utf8",
);

// TERMS and PRIVACY were revised again by migration 0076 (business phone), so
// their 2026-09-22 evidence is pinned here as immutable history instead of
// being recomputed from the current public HTML.
const publishedDocuments = [
  {
    key: "TERMS",
    sha256: "48b0950d22e7d2716b1824bfa895ed70d86c8ef35e9acbf6778025965b4b9ec6",
    publicUrl: "https://dabboba.net/terms",
  },
  {
    key: "PRIVACY",
    sha256: "6c1067c30ca2fd55628f0c443975fbfc243537d1e5c99217011e1d5714d88739",
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
    const digest = "path" in document
      ? createHash("sha256").update(await readFile(document.path)).digest("hex")
      : document.sha256;
    assert.match(
      source,
      new RegExp(
        `\\('${document.key}','2026-09-22','${digest}'[\\s\\S]*?'${document.publicUrl.replaceAll(".", "\\.")}'`,
        "i",
      ),
    );
  }
});
