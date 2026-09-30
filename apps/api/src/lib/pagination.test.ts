import assert from "node:assert/strict";
import test from "node:test";
import { encodeCursor } from "@dabboba/db";
import { AppError } from "./errors.js";
import { pagination } from "./pagination.js";

const createdAt = "2026-09-30T00:00:00.000Z";
const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
const rejects = (fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof AppError && error.statusCode === 400);

test("cursor ids are validated against the paged table's key format", () => {
  assert.equal(pagination({ cursor: encodeCursor({ createdAt, id: uuid }) }, "uuid").cursor?.id, uuid);
  assert.equal(pagination({ cursor: encodeCursor({ createdAt, id: "demon-slayer" }) }, "slug").cursor?.id, "demon-slayer");
  rejects(() => pagination({ cursor: encodeCursor({ createdAt, id: "not-a-uuid" }) }, "uuid"));
  rejects(() => pagination({ cursor: encodeCursor({ createdAt, id: "x' OR '1'='1" }) }, "slug"));
  rejects(() => pagination({ cursor: encodeCursor({ createdAt, id: "Upper" }) }, "slug"));
  rejects(() => pagination({ cursor: "%%%" }, "uuid"));
  assert.equal(pagination({}, "uuid").cursor, null);
});
