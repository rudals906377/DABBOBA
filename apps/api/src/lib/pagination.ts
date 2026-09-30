import { boundedLimit, decodeCursor, encodeCursor } from "@dabboba/db";
import { badRequest } from "./errors.js";

/**
 * Primary-key shape of the table a cursor pages through. UUID tables must
 * reject non-UUID cursor ids before PostgreSQL casts them (22P02), and text
 * slug tables must reject values their CHECK constraint could never contain.
 */
export type CursorIdFormat = "uuid" | "slug";

const UUID_CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_CURSOR_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function cursorIdMatches(id: string, format: CursorIdFormat): boolean {
  return format === "uuid"
    ? UUID_CURSOR_ID.test(id)
    : id.length <= 120 && SLUG_CURSOR_ID.test(id);
}

export function pagination(query: Record<string, unknown>, idFormat: CursorIdFormat) {
  const limit = boundedLimit(query.limit);
  const rawCursor = typeof query.cursor === "string" ? query.cursor : undefined;
  const cursor = decodeCursor(rawCursor);
  if ((rawCursor && !cursor) || (cursor && !cursorIdMatches(cursor.id, idFormat))) {
    throw badRequest("페이지 커서가 올바르지 않습니다.");
  }
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
