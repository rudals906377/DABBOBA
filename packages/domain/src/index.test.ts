import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionInquiry,
  canTransitionReport,
  commerceModeForCategory,
  isAdminRole,
  isSuperAdminRole,
} from "./index.js";

test("commerce categories preserve the approved purchase and draw split", () => {
  assert.equal(commerceModeForCategory("gacha"), "draw");
  assert.equal(commerceModeForCategory("kuji"), "draw");
  assert.equal(commerceModeForCategory("figure"), "purchase");
  assert.equal(commerceModeForCategory("tcg"), "purchase");
});

test("admin role helpers keep USER out and reserve super-admin actions", () => {
  assert.equal(isAdminRole("USER"), false);
  assert.equal(isAdminRole("ADMIN"), true);
  assert.equal(isAdminRole("SUPER_ADMIN"), true);
  assert.equal(isSuperAdminRole("ADMIN"), false);
  assert.equal(isSuperAdminRole("SUPER_ADMIN"), true);
});

test("closed moderation workflows cannot silently reopen", () => {
  assert.equal(canTransitionInquiry("PENDING", "ANSWERED"), true);
  assert.equal(canTransitionInquiry("CLOSED", "IN_PROGRESS"), false);
  assert.equal(canTransitionInquiry("CLOSED", "CLOSED"), false);
  assert.equal(canTransitionReport("PENDING", "REVIEWING"), true);
  assert.equal(canTransitionReport("RESOLVED", "REVIEWING"), false);
  assert.equal(canTransitionReport("RESOLVED", "RESOLVED"), false);
});
