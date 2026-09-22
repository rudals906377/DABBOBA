import type { CatalogIp } from "@dabboba/contracts";

export type WantedIpOption = Pick<CatalogIp, "id" | "nameKo" | "nameEn" | "nameJa" | "aliases">;

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

function matchRank(option: WantedIpOption, query: string): number | null {
  const terms = [option.nameKo, option.nameEn, option.nameJa, ...option.aliases]
    .filter((value): value is string => Boolean(value))
    .map(normalize);
  if (terms.includes(query)) return 0;
  if (terms.some((term) => term.startsWith(query))) return 1;
  if (terms.some((term) => term.includes(query))) return 2;
  return null;
}

export function findWantedIpSuggestions<T extends WantedIpOption>(
  options: T[],
  value: string,
  limit = 5,
): T[] {
  const query = normalize(value);
  if (!query) return [];
  return options
    .map((option) => ({ option, rank: matchRank(option, query) }))
    .filter((entry): entry is { option: T; rank: number } => entry.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.option.nameKo.localeCompare(right.option.nameKo, "ko"))
    .slice(0, limit)
    .map(({ option }) => option);
}

export function resolveWantedIpSelection(
  options: WantedIpOption[],
  value: string,
): { ipId: string | null; ipNameKo: string } {
  const ipNameKo = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  const exact = ipNameKo
    ? options.find((option) => normalize(option.nameKo) === normalize(ipNameKo))
    : undefined;
  return { ipId: exact?.id ?? null, ipNameKo: exact?.nameKo ?? ipNameKo };
}
