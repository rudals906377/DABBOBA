import assert from "node:assert/strict";
import test from "node:test";
import { nextAdminLoginFailureState } from "./auth.js";

test("an expired admin lock starts a fresh failure window without immediately relocking", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.deepEqual(
    nextAdminLoginFailureState({
      failedAttempts: 5,
      lockedUntil: new Date("2026-08-24T11:59:59.999Z"),
      now,
    }),
    { failedAttempts: 1, lockedUntil: null },
  );
  assert.deepEqual(
    nextAdminLoginFailureState({
      failedAttempts: 5,
      lockedUntil: now,
      now,
    }),
    { failedAttempts: 1, lockedUntil: null },
  );
});

test("a fresh admin failure window locks only on its fifth failure", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  assert.deepEqual(
    nextAdminLoginFailureState({ failedAttempts: 3, lockedUntil: null, now }),
    { failedAttempts: 4, lockedUntil: null },
  );
  assert.deepEqual(
    nextAdminLoginFailureState({ failedAttempts: 4, lockedUntil: null, now }),
    {
      failedAttempts: 5,
      lockedUntil: new Date("2026-08-24T12:15:00.000Z"),
    },
  );
});
