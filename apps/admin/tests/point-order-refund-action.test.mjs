import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("points-only orders get their own confirmed refund action, separate from the card cancellation", async () => {
  const actions = await readFile(join(root, "lib/actions.ts"), "utf8");
  const page = await readFile(join(root, "app/(admin)/commerce/payments/[paymentId]/page.tsx"), "utf8");
  const types = await readFile(join(root, "lib/admin-types.ts"), "utf8");
  const pointAction = actions.slice(
    actions.indexOf("export async function requestPointOrderRefund"),
    actions.indexOf("export async function requestPortOneLateRefund"),
  );
  assert.match(pointAction, /mutate\("refunds\.cancel", form/);
  assert.match(pointAction, /confirmPointRefund/);
  assert.match(pointAction, /\/payments\/\$\{id\(form, "paymentId"\)\}\/point-refund`/);
  assert.doesNotMatch(pointAction, /\/refund`|\/cancel`/);

  assert.match(types, /refundActionKind: "CARD_CANCELLATION" \| "POINT_ORDER" \| null/);
  assert.match(page, /payment\.refundActionKind === "CARD_CANCELLATION" && payment\.refundActionAvailable/);
  assert.match(page, /payment\.refundActionKind === "POINT_ORDER" && payment\.refundActionAvailable/);
  assert.match(page, /action=\{requestPointOrderRefund\}/);
  assert.match(page, /포인트 주문 환불/);
  assert.match(page, /사용한 포인트 \$\{usedPoints\}를 회원에게 되돌리고 뽑기권을 취소합니다\./);
});
