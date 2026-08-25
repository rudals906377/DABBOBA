import assert from "node:assert/strict";
import test from "node:test";
import { dabbobaTokens } from "./index.js";

test("shared UI keeps the approved DABBOBA brand colors", () => {
  assert.equal(dabbobaTokens.color.brand, "#91E98E");
  assert.equal(dabbobaTokens.color.ink, "#111411");
});
