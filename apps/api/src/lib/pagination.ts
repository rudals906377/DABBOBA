import { boundedLimit, decodeCursor, encodeCursor } from "@dabboba/db";
import { badRequest } from "./errors.js";

export function pagination(query: Record<string, unknown>) {
  const limit = boundedLimit(query.limit);
  const rawCursor = typeof query.cursor === "string" ? query.cursor : undefined;
  const cursor = decodeCursor(rawCursor);
  if (rawCursor && !cursor) throw badRequest("페이지 커서가 올바르지 않습니다.");
  return { limit, cursor };
}

export function cursorPage<Row extends { id: string; created_at: Date | string }, Output>(
  rows: Row[],
  limit: number,
  map: (row: Row) => Output,
  sort?: (row: Row) => string,
) {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(map),
    nextCursor: hasMore && last
      ? encodeCursor({
          createdAt: new Date(last.created_at).toISOString(),
          id: last.id,
          ...(sort ? { sort: sort(last) } : {}),
        })
      : null,
  };
}
