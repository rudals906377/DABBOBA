import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileSourceRoot = path.join(root, "apps/mobile/src");
const seedComponentsSource = readFileSync(
  path.join(mobileSourceRoot, "design-system/components.tsx"),
  "utf8",
);

function collectTsxSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxSources(entryPath);
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) return [];
    return [[path.relative(root, entryPath), readFileSync(entryPath, "utf8")]];
  });
}

test("every native search field uses a neutral resting border and dark-green focus border", () => {
  assert.match(seedComponentsSource, /variant\?: "default" \| "search"/);
  assert.match(seedComponentsSource, /variant === "search" && styles\.inputSearch/);
  assert.match(seedComponentsSource, /inputSearch:\s*\{\s*borderColor:\s*seed\.color\.stroke\.neutral\s*\}/);
  assert.match(seedComponentsSource, /inputFocused:\s*\{\s*borderColor:\s*seed\.color\.stroke\.focus,\s*borderWidth:\s*2\s*\}/);
  assert.match(seedComponentsSource, /inputError:\s*\{\s*borderColor:\s*seed\.color\.stroke\.critical\s*\}/);
  assert.match(
    seedComponentsSource,
    /styles\.inputShell,[\s\S]*?style,[\s\S]*?variant === "search"[\s\S]*?focused && styles\.inputFocused,[\s\S]*?error && styles\.inputError/,
    "screen layout styles must not override the shared search, focus, or error border",
  );

  const searchSurfaces = collectTsxSources(mobileSourceRoot).filter(([, source]) =>
    source.includes('returnKeyType="search"'),
  );
  assert.ok(searchSurfaces.length > 0, "the native app must expose at least one search field");

  for (const [relativePath, source] of searchSurfaces) {
    assert.match(
      source,
      /<SeedInputShell[^>]*variant="search"/,
      `${relativePath} must use the shared search shell`,
    );
    assert.doesNotMatch(source, /placeholderTextColor="#8D948C"/);
    assert.match(source, /placeholderTextColor=\{colors\.muted\}/);
  }
});
