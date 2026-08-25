import assert from "node:assert/strict";
import test from "node:test";
import { errorMessage } from "./index.js";

test("API error helper exposes safe contract messages only", () => {
  assert.equal(errorMessage({ error: { message: "로그인이 필요합니다." } }), "로그인이 필요합니다.");
  assert.equal(errorMessage(new Error("secret")), "요청을 처리하지 못했습니다.");
});
