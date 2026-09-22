import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const canonicalWordmark = path.join(root, "apps/mobile/assets/brand/dabboba-wordmark.png");

test("every shipped DABBOBA wordmark PNG is byte-identical to the approved mobile asset", async () => {
  const approved = await readFile(canonicalWordmark);
  for (const candidate of [
    "public/assets/dabboba/brand/dabboba-wordmark.png",
    "apps/storefront/public/assets/brand/dabboba-wordmark.png",
  ]) {
    assert.deepEqual(await readFile(path.join(root, candidate)), approved, `${candidate} diverged from the approved wordmark`);
  }

  for (const retiredAsset of [
    "public/assets/dabboba/brand/dabboba-wordmark.svg",
    "apps/storefront/public/assets/brand/dabboba-wordmark.svg",
  ]) {
    await assert.rejects(access(path.join(root, retiredAsset)));
  }
});

test("customer and operator surfaces render the approved PNG instead of text or alternate artwork", async () => {
  const storefront = await readFile(path.join(root, "apps/storefront/src/App.tsx"), "utf8");
  const adminShell = await readFile(path.join(root, "apps/admin/components/admin-shell.tsx"), "utf8");
  const adminLogin = await readFile(path.join(root, "apps/admin/app/login/page.tsx"), "utf8");
  const adminWordmark = await readFile(path.join(root, "apps/admin/components/brand-wordmark.tsx"), "utf8");
  const kujiTicket = await readFile(path.join(root, "apps/mobile/src/features/draw/KujiPeelTicket.tsx"), "utf8");

  assert.match(storefront, /\/assets\/brand\/dabboba-wordmark\.png/);
  assert.doesNotMatch(storefront, /dabboba-wordmark\.svg/);
  assert.match(adminWordmark, /public\/assets\/dabboba\/brand\/dabboba-wordmark\.png/);
  assert.match(adminShell, /<BrandWordmark/);
  assert.match(adminLogin, /<BrandWordmark/);
  assert.doesNotMatch(`${adminShell}\n${adminLogin}`, /<strong>DABBOBA<\/strong>/);
  assert.match(kujiTicket, /source=\{DABBOBA_WORDMARK\}/);
  assert.doesNotMatch(kujiTicket, />DABBOBA(?: ONLINE)? KUJI</);
});

test("every public policy page uses the approved PNG wordmark", async () => {
  const legalRoot = path.join(root, "public/legal");
  const directories = await readdir(legalRoot, { withFileTypes: true });
  const htmlFiles = [path.join(legalRoot, "index.html")];

  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const entries = await readdir(path.join(legalRoot, directory.name));
    for (const entry of entries) {
      if (entry.endsWith(".html")) htmlFiles.push(path.join(legalRoot, directory.name, entry));
    }
  }

  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    assert.match(html, /<img[^>]+src="\/assets\/brand\/dabboba-wordmark\.png"[^>]+alt="DABBOBA"/);
    assert.doesNotMatch(html, /<div class="brand">DABBOBA<\/div>/);
  }
});
