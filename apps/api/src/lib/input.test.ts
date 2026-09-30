import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./errors.js";
import { escapeLikePattern, likeContainsPattern } from "./input.js";

test("LIKE metacharacters and the escape character are matched literally", () => {
  assert.equal(escapeLikePattern("100%_off\\now"), "100\\%\\_off\\\\now");
  assert.equal(likeContainsPattern("a_b"), "%a\\_b%");
  assert.equal(likeContainsPattern("포켓몬"), "%포켓몬%");
});

test("search text made only of wildcards is rejected instead of scanning every row", () => {
  for (const value of ["%", "_", "%%__", "\\", "% _"]) {
    assert.throws(() => likeContainsPattern(value), (error: unknown) => (
      error instanceof AppError && error.statusCode === 400
    ), value);
  }
});
