import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("raw PortOne payment fetches carry an explicit request deadline", () => {
  const api = read("apps/mobile/src/features/checkout/checkout-api.ts");
  assert.match(api, /import \{ errorMessage, requestTimeoutSignal \} from "@dabboba\/api-client";/);
  for (const action of ["confirm", "abandon", "attempt"]) {
    const start = api.indexOf(`/v1/payments/\${encodeURIComponent(paymentId)}/${action}\``);
    assert.ok(start > 0, `missing ${action} fetch`);
    const init = api.slice(start, api.indexOf("body:", start));
    assert.match(init, /signal: requestTimeoutSignal\(\)/, `${action} fetch must time out`);
  }
});

test("kuji room requests time out and joins reuse one deterministic idempotency key", () => {
  const api = read("apps/mobile/src/features/kuji/kuji-room-api.ts");
  assert.match(api, /signal: requestTimeoutSignal\(\)/);
  assert.match(api, /idempotencyKey: kujiRoomJoinIdempotencyKey\(productId, options\.userId\)/);
  assert.match(api, /idempotencyKeyFrom\("kuji-join", userId, productId\)/);
  assert.match(api, /idempotencyKeyFrom\("kuji-join", productId\)/);
  assert.doesNotMatch(
    api.slice(api.indexOf("export async function joinKujiRoom"), api.indexOf("export async function fetchKujiRoom")),
    /randomUUID/,
    "a lost join response must retry with the same key",
  );
});
