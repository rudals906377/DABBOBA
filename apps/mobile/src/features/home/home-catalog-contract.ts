import type { HomeCatalogSectionList } from "@dabboba/contracts";
import { HOME_SECTION_SOURCE_KINDS } from "./home-feed.ts";

const sourceKinds = new Set<string>(HOME_SECTION_SOURCE_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isCurrentHomeSectionList(value: unknown): value is HomeCatalogSectionList {
  if (!isRecord(value)
    || typeof value.configured !== "boolean"
    || !Array.isArray(value.items)
    || (!value.configured && value.items.length > 0)
    || !(value.bestProductId === null || typeof value.bestProductId === "string")
    || typeof value.evaluatedAt !== "string"
    || !Number.isFinite(Date.parse(value.evaluatedAt))) return false;

  return value.items.every((section: unknown) => {
    if (!isRecord(section)
      || typeof section.id !== "string" || !section.id
      || typeof section.title !== "string" || !section.title.trim()
      || (section.layoutKind !== "gacha" && section.layoutKind !== "kuji")
      || !sourceKinds.has(String(section.sourceKind))
      || !Number.isInteger(section.visibleLimit) || (section.visibleLimit as number) < 1
      || !Number.isInteger(section.sortOrder)
      || typeof section.isActive !== "boolean"
      || !Array.isArray(section.products)) return false;

    return section.products.every((product: unknown) => (
      isRecord(product)
      && typeof product.id === "string"
      && typeof product.name === "string"
      && product.category === section.layoutKind
    ));
  });
}
