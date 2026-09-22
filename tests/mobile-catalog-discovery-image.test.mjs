import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MIN_SAFE_COVER_VISIBLE_FRACTION,
  catalogArtworkVisibleFraction,
} from "../apps/mobile/src/components/catalog-discovery-image-state.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const componentPath = path.join(root, "apps/mobile/src/components/CatalogDiscoveryImage.tsx");
const source = existsSync(componentPath) ? readFileSync(componentPath, "utf8") : "";

test("discovery imagery keeps unsafe artwork complete on a flat neutral surface", () => {
  assert.match(source, /export function CatalogDiscoveryImage/);
  assert.match(source, /catalogArtworkVisibleFraction/);
  assert.doesNotMatch(source, /blurRadius/);
  assert.doesNotMatch(source, /styles\.backdrop/);
  assert.doesNotMatch(source, /backdropScrim/);
  assert.match(source, /backgroundColor:\s*seed\.color\.background\.neutralWeak/);
  assert.match(source, /resizeMode=\{primaryResizeMode\}/);
  assert.match(source, /const fallbackSources:[\s\S]*?storefrontUri && primaryUri/);
  assert.match(source, /fallbackSources=\{fallbackSources\}/);
  assert.match(source, /onDimensions=\{handleDimensions\}/);
});

test("cover safety uses the actual visible fraction for each reference frame", () => {
  assert.equal(MIN_SAFE_COVER_VISIBLE_FRACTION, 0.8);
  assert.equal(catalogArtworkVisibleFraction(1_000, 1_000, 8 / 7), 7 / 8);
  assert.equal(catalogArtworkVisibleFraction(1_000, 1_000, 7 / 4), 4 / 7);
  assert.ok(Math.abs(catalogArtworkVisibleFraction(1_400, 1_000, 7 / 4) - 0.8) < Number.EPSILON);
  assert.equal(catalogArtworkVisibleFraction(0, 1_000, 8 / 7), 0);
  assert.equal(catalogArtworkVisibleFraction(1_000, 0, 8 / 7), 0);
});
