import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("refund provider requery is restricted to refunds.cancel and never calls cancel", async () => {
  const capabilities = await readFile(join(root, "lib/capabilities.ts"), "utf8");
  const actions = await readFile(join(root, "lib/actions.ts"), "utf8");
  const page = await readFile(join(root, "app/(admin)/commerce/refunds/[paymentId]/page.tsx"), "utf8");

  assert.match(capabilities, /"refunds\.reconcile": \["refunds\.read", "refunds\.cancel"\]/);
  assert.match(actions, /mutate\("refunds\.reconcile", form/);
  assert.match(actions, /\/cancellation\/reconcile`/);
  assert.doesNotMatch(actions.slice(actions.indexOf("export async function reconcilePortOneRefundCancellation"), actions.indexOf("export async function requestPortOneFullDrawRefund")), /\/cancel`/);
  assert.match(page, /detail\.providerReconciliationAvailable && can\(session\.actor, "refunds\.reconcile"\)/);
  assert.match(page, /action=\{reconcilePortOneRefundCancellation\}/);
});

test("late full refund is an explicit super-admin action, not a requery or note save", async () => {
  const actions = await readFile(join(root, "lib/actions.ts"), "utf8");
  const page = await readFile(join(root, "app/(admin)/commerce/refunds/[paymentId]/page.tsx"), "utf8");
  const lateAction = actions.slice(
    actions.indexOf("export async function requestPortOneLateRefund"),
    actions.indexOf("export async function adjustInventory"),
  );
  assert.match(lateAction, /mutate\("refunds\.cancel", form/);
  assert.match(lateAction, /confirmFullRefund/);
  assert.match(lateAction, /\/refund-reviews\/\$\{id\(form, "paymentId"\)\}\/cancel`/);
  assert.match(page, /detail\.providerActionAvailable && can\(session\.actor, "refunds\.cancel"\)/);
  assert.match(page, /action=\{requestPortOneLateRefund\}/);
});
