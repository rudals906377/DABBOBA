import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  abandonedPaymentDestination,
  interpretPaymentAbandonResponse,
  isPortOneUserCancel,
  isPortOneUserCancelError,
  paymentAbandonIdempotencyKey,
  PaymentAbandonError,
} from "../apps/mobile/src/features/checkout/payment-abandon.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the abandon idempotency key is stable per paymentId and server-valid", () => {
  const key = paymentAbandonIdempotencyKey("pay_01J8 x/y");
  assert.equal(key, paymentAbandonIdempotencyKey("pay_01J8 x/y"));
  assert.notEqual(key, paymentAbandonIdempotencyKey("pay_other"));
  assert.match(key, /^[A-Za-z0-9._:-]{16,200}$/);
  assert.ok(paymentAbandonIdempotencyKey("p".repeat(500)).length <= 200);
});

test("abandon responses map 200 to cancel and 409 to the confirm fallback", () => {
  assert.deepEqual(
    interpretPaymentAbandonResponse(200, { paymentId: "pay-1", orderId: "order-1" }, "pay-1"),
    { kind: "ABANDONED", paymentId: "pay-1", orderId: "order-1" },
  );
  assert.deepEqual(interpretPaymentAbandonResponse(409, null, "pay-1"), { kind: "PAYMENT_EVIDENCE" });
  assert.throws(
    () => interpretPaymentAbandonResponse(200, { paymentId: "pay-2" }, "pay-1"),
    PaymentAbandonError,
  );
  assert.throws(
    () => interpretPaymentAbandonResponse(503, { error: { message: "잠시 후 다시 시도해 주세요." } }, "pay-1"),
    /잠시 후 다시 시도해 주세요/,
  );
});

test("only a PortOne user cancellation is classified as a closed payment window", () => {
  assert.equal(isPortOneUserCancel({ code: "FAILURE_TYPE_PG", message: "[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다" }), true);
  assert.equal(isPortOneUserCancel({ code: "FAILURE_TYPE_PG", pgCode: "PAY_PROCESS_CANCELED" }), true);
  assert.equal(isPortOneUserCancel({ code: "Cancelled" }), true);
  assert.equal(isPortOneUserCancel({ txId: "tx-1", paymentId: "pay-1" }), false);
  assert.equal(isPortOneUserCancel({ code: "FAILURE_TYPE_PG", message: "카드 한도가 초과되었습니다" }), false);
  assert.equal(isPortOneUserCancel({ code: "PGProviderError", message: "승인 거절" }), false);
  assert.equal(isPortOneUserCancel(null), false);
  assert.equal(isPortOneUserCancelError(new Error("[PAY_PROCESS_CANCELED] 사용자가 결제를 취소하였습니다")), true);
  assert.equal(isPortOneUserCancelError(new Error("Network request failed")), false);
});

test("an abandoned payment returns to the product, never to checkout", () => {
  assert.equal(
    abandonedPaymentDestination({ orderKind: "PRODUCT", lines: [{ productId: "kuji 1" }] }),
    "/product/kuji%201",
  );
  assert.equal(abandonedPaymentDestination({ lines: [] }, "p-2"), "/product/p-2");
  assert.equal(
    abandonedPaymentDestination({ orderKind: "SHIPPING_FEE", shippingRequestId: "s-1", lines: [] }),
    "/profile/shipping/s-1",
  );
  assert.equal(abandonedPaymentDestination({ lines: [] }), "/profile/orders");
});

test("the payment screen abandons on user cancel and confirms every other outcome", () => {
  const source = read("apps/mobile/src/features/checkout/PortOnePaymentScreen.tsx");
  const complete = source.split("onComplete={")[1]?.split("onError={")[0] ?? "";
  const error = source.split("onError={")[1]?.split("style={styles.payment}")[0] ?? "";
  assert.match(complete, /isPortOneUserCancel\(response\)\) void abandonPayment\(order\)[\s\S]*?else void confirmPayment\(order\)/);
  assert.match(error, /isPortOneUserCancelError\(error\)\) void abandonPayment\(order\)[\s\S]*?else void confirmPayment\(order\)/);
  const abandon = source.slice(source.indexOf("const abandonPayment = useCallback"), source.indexOf("const assertPayableKujiOrder"));
  assert.match(abandon, /outcome\.kind === "PAYMENT_EVIDENCE"[\s\S]*?confirmInstead = true/);
  assert.match(abandon, /router\.replace\(abandonedPaymentDestination\(paymentOrder, routeProductId\) as Href\)/);
  assert.match(abandon, /if \(confirmInstead\) await confirmPayment\(paymentOrder\)/);
  assert.match(source, /label="결제창을 닫았다면 다시 시도"[\s\S]*?abandonPayment\(order\)/);
  const api = read("apps/mobile/src/features/checkout/checkout-api.ts");
  assert.match(api, /\/v1\/payments\/\$\{encodeURIComponent\(paymentId\)\}\/abandon/);
  assert.match(api, /"idempotency-key": paymentAbandonIdempotencyKey\(paymentId\)/);
});

test("the payment load effect does not re-run confirm on every order change", () => {
  const source = read("apps/mobile/src/features/checkout/PortOnePaymentScreen.tsx");
  const loadDeps = source.match(/const load = useCallback\([\s\S]*?\}, \[([^\]]*)\]\);/)?.[1] ?? "";
  assert.ok(loadDeps.length > 0);
  assert.doesNotMatch(loadDeps, /\border\b/);
  assert.match(source, /useEffect\(\(\) => \{\s*void load\(\);\s*\}, \[load\]\);/);
});

test("checkout hands off to payment by replace and kuji draw back returns to the product", () => {
  const checkout = read("apps/mobile/src/features/checkout/CheckoutScreen.tsx");
  const open = checkout.slice(checkout.indexOf("const openLivePayment"), checkout.indexOf("const releaseKujiEntryBestEffort"));
  assert.match(open, /checkoutCompletedRef\.current = true;[\s\S]*?router\.replace\(\{/);
  assert.doesNotMatch(open, /router\.push/);
  assert.match(checkout, /if \(entitlementIds\) checkoutCompletedRef\.current = true;/);
  const kuji = read("apps/mobile/src/features/kuji/KujiDrawScreen.tsx");
  const back = kuji.slice(kuji.indexOf("const goBack = () => {"), kuji.indexOf("const openSelectedTickets"));
  assert.match(back, /router\.replace\(`\/product\/\$\{encodeURIComponent\(productId\)\}` as Href\)/);
  assert.doesNotMatch(back, /router\.back\(\)/);
});
