import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("payment requery is a separate supervisor action and does not request another charge", async () => {
  const capabilities = await readFile(join(root, "lib/capabilities.ts"), "utf8");
  const actions = await readFile(join(root, "lib/actions.ts"), "utf8");
  const page = await readFile(join(root, "app/(admin)/commerce/payments/[paymentId]/page.tsx"), "utf8");
  assert.match(capabilities, /"payments\.reconcile": \["payments\.read", "payments\.reconcile"\]/);
  const action = actions.slice(
    actions.indexOf("export async function reconcilePortOnePayment"),
    actions.indexOf("export async function requestPortOneFullDrawRefund"),
  );
  assert.match(action, /mutate\("payments\.reconcile", form/);
  assert.match(action, /\/payments\/\$\{id\(form, "paymentId"\)\}\/reconcile`/);
  assert.doesNotMatch(action, /\/refund`|\/cancel`|\/v1\/orders/);
  assert.match(page, /payment\.providerReconciliationAvailable && can\(session\.actor, "payments\.reconcile"\)/);
  assert.match(page, /action=\{reconcilePortOnePayment\}/);
});
