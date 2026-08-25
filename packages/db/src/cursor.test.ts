import assert from "node:assert/strict";
import test from "node:test";
import { boundedLimit, decodeCursor, encodeCursor } from "./index.js";

test("cursor round-trips stable ordering keys", () => {
  const value = { createdAt: "2026-08-24T12:00:00.000Z", id: "abc" };
  assert.deepEqual(decodeCursor(encodeCursor(value)), value);
});

test("invalid cursors and unbounded limits fail closed", () => {
  assert.equal(decodeCursor("not-a-cursor"), null);
  assert.equal(boundedLimit("0"), 30);
  assert.equal(boundedLimit("999"), 100);
});
