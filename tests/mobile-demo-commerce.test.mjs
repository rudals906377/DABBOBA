import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const requireFromMobile = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const ts = requireFromMobile("typescript");

test("a stalled internal login request releases the app instead of loading forever", async () => {
  const source = await read("apps/mobile/src/features/demo/demo-api.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "demo-api.ts",
  }).outputText;
  const capability = {
    enabled: true,
    profile: "supabase-demo",
    paymentProvider: "TEST_PG",
    actions: ["approve", "fail", "cancel", "refund"],
  };

  for (const blockedPath of ["/v1/demo/capabilities", "/v1/auth/me", "/v1/demo/session"]) {
    const module = { exports: {} };
    const timers = [];
    const requests = [];
    vm.runInNewContext(output, {
      module,
      exports: module.exports,
      __DEV__: true,
      AbortController,
      Date,
      setTimeout(callback, duration) {
        assert.equal(duration, 8_000);
        const timer = { callback, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) { timer.cleared = true; },
      async fetch(url, options) {
        const path = new URL(url).pathname;
        requests.push({ path, signal: options?.signal });
        if (path === blockedPath) {
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          });
        }
        if (path === "/v1/demo/capabilities") return { status: 200, ok: true, json: async () => capability };
        throw new Error(`Unexpected request: ${path}`);
      },
      require(specifier) {
        if (specifier === "@/lib/session-store") return {
          readAuthTokens: async () => blockedPath === "/v1/auth/me" ? { accessToken: "stored-token" } : null,
          clearAuthTokens: async () => undefined,
          writeAuthTokens: async () => undefined,
        };
        throw new Error(`Unexpected dependency: ${specifier}`);
      },
    });

    const pending = module.exports.ensureInternalCustomerSession("https://api.dabboba.net", async () => undefined);
    for (let step = 0; step < 20 && !requests.some((request) => request.path === blockedPath); step += 1) {
      await Promise.resolve();
    }
    const request = requests.find((item) => item.path === blockedPath);
    assert.ok(request, `${blockedPath} was not requested`);
    assert.ok(request.signal instanceof AbortSignal, `${blockedPath} had no abort signal`);
    const activeTimer = timers.findLast((timer) => !timer.cleared);
    assert.ok(activeTimer, `${blockedPath} had no deadline`);
    activeTimer.callback();
    await assert.rejects(pending, /테스트 기능 연결 상태를 확인하지 못했습니다/);
    assert.equal(request.signal.aborted, true);
    assert.equal(activeTimer.cleared, true);
  }
});

test("a stalled TEST_PG approval stops waiting without implying the payment failed", async () => {
  const source = await read("apps/mobile/src/features/demo/demo-api.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "demo-api.ts",
  }).outputText;
  const module = { exports: {} };
  const timers = [];
  const requests = [];
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    __DEV__: true,
    AbortController,
    setTimeout(callback, duration) {
      assert.equal(duration, 8_000);
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { timer.cleared = true; },
    async fetch(url, options) {
      const path = new URL(url).pathname;
      requests.push({ path, options });
      if (path === "/v1/demo/capabilities") return {
        status: 200,
        ok: true,
        json: async () => ({
          enabled: true,
          profile: "supabase-demo",
          paymentProvider: "TEST_PG",
          actions: ["approve", "fail", "cancel", "refund"],
        }),
      };
      if (path === "/v1/demo/payments/order-1/transition") {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
    require(specifier) {
      if (specifier === "@/lib/session-store") return {};
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
  });

  const pending = module.exports.transitionDemoPayment(
    "http://127.0.0.1:8788", "customer-token", "order-1", "approve",
  );
  for (let step = 0; step < 20 && requests.length < 2; step += 1) await Promise.resolve();
  assert.equal(requests.length, 2);
  const payment = requests[1];
  assert.equal(payment.options.headers["Idempotency-Key"], "demo-payment-approve-order-1");
  assert.equal(payment.options.signal instanceof AbortSignal, true);
  const paymentTimer = timers.findLast((timer) => !timer.cleared);
  assert.ok(paymentTimer);
  paymentTimer.callback();
  await assert.rejects(pending, /결제 결과.*주문 내역.*확인/);
  assert.equal(payment.options.signal.aborted, true);
  assert.equal(paymentTimer.cleared, true);
  assert.equal(requests.length, 2);
});

test("development commerce restores one canonical customer without exposing account controls", async () => {
  const [api, login, layout, profile] = await Promise.all([
    read("apps/mobile/src/features/demo/demo-api.ts"),
    read("apps/mobile/src/features/auth/LoginScreen.tsx"),
    read("apps/mobile/app/_layout.tsx"),
    read("apps/mobile/src/features/profile/ProfileHomeScreen.tsx"),
  ]);

  assert.match(api, /fetch\(apiUrl\(apiBaseUrl, "\/v1\/demo\/capabilities"\)/);
  assert.match(api, /response\.status === 404\) return null/);
  assert.match(api, /response\.status === 429 \|\| response\.status >= 500/);
  assert.match(api, /throw new TemporaryDemoCapabilityError\(\)/);
  assert.match(api, /if \(!__DEV__\) return null/);
  assert.match(api, /await requireDemoCapabilities\(apiBaseUrl\)/);
  assert.match(api, /da000000-0000-4000-8000-00000000000a/);
  assert.doesNotMatch(api, /00000000000b|demo-[ab]@dabboba\.test|DemoAccount/);
  assert.match(api, /"accounts" in value/);
  assert.match(api, /fetch\(apiUrl\(apiBaseUrl, "\/v1\/demo\/session"\), \{[\s\S]*?method: "POST"[\s\S]*?headers: \{ Accept: "application\/json" \},[\s\S]*?\}\)/);
  assert.doesNotMatch(api, /body: JSON\.stringify\(\{ account \}\)/);
  assert.match(api, /actor\.userId !== INTERNAL_CUSTOMER_ID/);
  assert.match(api, /actor\.role !== "USER"/);
  assert.match(api, /actor\.status !== "ACTIVE"/);
  assert.match(api, /isNonBlankString\(actor\.email\)/);
  assert.match(api, /isNonBlankString\(actor\.nickname\)/);
  assert.ok(api.indexOf("parseInternalCustomerSession(await response.json())") < api.indexOf("await writeAuthTokens"));
  assert.match(api, /readAuthTokens\(\)[\s\S]*?\/v1\/auth\/me/);
  assert.match(api, /storedSessionState === "current"\) return stored/);

  await assert.rejects(access(new URL("../apps/mobile/src/features/demo/DemoAccountSwitcher.tsx", import.meta.url)));
  assert.match(login, /ensureInternalCustomerSession\(runtime\.apiBaseUrl, \(\) => clearUserScopedLocalData\(db\), \(\) => active\)/);
  assert.match(login, /internalSessionState === "failed"/);
  assert.match(login, /label="로그인 다시 시도"/);
  assert.doesNotMatch(login, /DemoAccountSwitcher|테스트 계정|데모 계정|계정 A|계정 B/);
  assert.doesNotMatch(profile, /DemoAccountSwitcher|테스트 계정|데모 계정|계정 A|계정 B/);
  assert.match(layout, /InternalCustomerSessionBootstrap enabled=\{__DEV__\}/);
  assert.match(layout, /ensureInternalCustomerSession\(runtime\.apiBaseUrl, \(\) => clearUserScopedLocalData\(db\), \(\) => active\)/);
  assert.doesNotMatch(layout, /ensureDevelopmentAuthSession|customerAuthSetupAttempted/);
});

test("demo payment uses authenticated real orders and the server-refreshed transition result", async () => {
  const [api, controls, availability] = await Promise.all([
    read("apps/mobile/src/features/demo/demo-api.ts"),
    read("apps/mobile/src/features/demo/DemoPaymentControls.tsx"),
    read("apps/mobile/src/features/demo/useDemoPaymentAvailability.ts"),
  ]);

  assert.match(api, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(api, /"Idempotency-Key": demoPaymentTransitionIdempotencyKey\(orderId, action\)/);
  assert.match(api, /body: JSON\.stringify\(\{ action \}\)/);
  assert.match(api, /return `demo-payment-\$\{action\}-\$\{orderId\}`/);
  assert.match(api, /status === "PENDING_PAYMENT"\) return \["approve", "fail", "cancel"\]/);
  assert.match(api, /status === "PAID"\) return \["refund"\]/);
  assert.match(controls, /surface:\s*"internal-commerce"/);
  assert.match(controls, /surface !== "internal-commerce" \|\| !__DEV__ \|\| !enabled/);
  assert.match(controls, /TEST_PG · 실제 과금 없음/);
  assert.match(controls, /useFocusEffect/);
  assert.match(controls, /useDemoPaymentAvailability\(apiBaseUrl\)/);
  assert.match(controls, /requestGenerationRef/);
  const focusEntry = controls.slice(
    controls.indexOf("useFocusEffect(useCallback"),
    controls.indexOf("return () =>", controls.indexOf("useFocusEffect(useCallback")),
  );
  assert.match(focusEntry, /focusedRef\.current = true/);
  assert.match(focusEntry, /actionLockRef\.current = false/);
  assert.match(focusEntry, /setBusy\(null\)/);
  assert.match(focusEntry, /setMessage\(""\)/);
  const transition = controls.indexOf("const currentOrder = await transitionDemoPayment");
  const sessionCheck = controls.indexOf("await sessionStillCurrent", transition);
  const commit = controls.indexOf("await onOrderChanged", sessionCheck);
  assert.ok(transition >= 0 && sessionCheck > transition && commit > sessionCheck);
  assert.doesNotMatch(controls, /fetchCheckoutOrder/);

  assert.match(availability, /useFocusEffect/);
  assert.match(availability, /fetchDemoCapabilities\(apiBaseUrl\)/);
  assert.match(availability, /setTimeout\(\(\) => void refresh\(\), DEMO_CAPABILITY_REFRESH_INTERVAL_MS\)/);
  assert.match(availability, /DEMO_CAPABILITY_RESTART_GRACE_MS = 15_000/);
  assert.match(availability, /error instanceof TemporaryDemoCapabilityError/);
  assert.match(availability, /verifiedBaseUrlRef\.current !== apiBaseUrl/);
  assert.match(availability, /if \(!insideRestartGrace\)[\s\S]{0,180}?setEnabled\(false\)/);
});

test("checkout keeps durable gacha intent and navigates only after refreshed paid entitlements", async () => {
  const checkout = await read("apps/mobile/src/features/checkout/CheckoutScreen.tsx");
  assert.match(checkout, /order\.status === "PENDING_PAYMENT"[\s\S]{0,100}?setDemoOrder\(order\)/);
  assert.match(checkout, /testPaymentsEnabled && demoOrder[\s\S]*?<DemoPaymentControls[\s\S]*?surface="internal-commerce"[\s\S]*?orderId=\{demoOrder\.id\}[\s\S]*?onOrderChanged=\{handleDemoOrderChanged\}/);
  assert.match(checkout, /recordPendingGachaCheckoutOrder\([\s\S]*?pendingGachaIntent,[\s\S]*?order/);
  const handler = checkout.slice(
    checkout.indexOf("const handleDemoOrderChanged"),
    checkout.indexOf("const finishPreparation"),
  );
  assert.match(handler, /paidGachaOrderEntitlementIds\(order, recordedIntent\)/);
  assert.match(handler, /openCommittedGachaReveal\(recordedIntent, order\.id, entitlementIds\)/);
  assert.match(handler, /paidKujiOrderEntitlementIds\(order, quantity\)/);
  assert.match(handler, /checkoutCompletedRef\.current = true/);
  assert.match(handler, /sessionStillCurrent\(accessToken\)/);
  assert.match(handler, /checkoutFocusedRef\.current/);
  assert.match(handler, /canRetireGachaCheckoutIntentForOrderStatus\(order\.status\)[\s\S]*?clearPendingGachaCheckoutOrderIntent/);
  assert.doesNotMatch(handler, /createGachaCheckoutOrder|createKujiCheckoutOrder/);
  assert.match(checkout, /const testPaymentsEnabled = __DEV__ && demoEnabled/);
  assert.match(checkout, /useDemoPaymentAvailability\(runtime\.apiBaseUrl\)/);
  assert.match(checkout, /continuePendingDemoCheckout\(\{/);
  assert.match(checkout, /approve: \(orderId\) => transitionDemoPayment\(/);
  assert.match(
    checkout,
    /const automaticallyApprovingTestOrder = order\.status === "PENDING_PAYMENT"[\s\S]{0,80}?&& testPaymentsEnabled/,
  );
  const automaticContinuation = checkout.slice(
    checkout.indexOf("const automaticallyApprovingTestOrder"),
    checkout.indexOf("const entitlementIds = paidGachaOrderEntitlementIds"),
  );
  assert.ok(automaticContinuation.indexOf("setDemoOrder(order)") >= 0);
  assert.ok(
    automaticContinuation.indexOf("setDemoOrder(order)")
      < automaticContinuation.indexOf("continueTestPayment("),
  );
  assert.match(
    automaticContinuation,
    /continueTestPayment\([\s\S]*?order,[\s\S]*?accessToken,[\s\S]*?expectedRouteIdentity,[\s\S]*?\)/,
  );
  assert.match(
    automaticContinuation,
    /recordPendingGachaCheckoutOrder\([\s\S]*?checkoutRequestStillCurrent\(accessToken, expectedRouteIdentity\)/,
  );
  assert.match(checkout, /options\.offerRecoveryChoice && !automaticallyApprovingTestOrder/);
  assert.match(
    checkout,
    /const continuedOrder = await continueTestPayment\([\s\S]*?order,[\s\S]*?tokens\.accessToken,[\s\S]*?expectedRouteIdentity,[\s\S]*?\)/,
  );
  assert.match(
    checkout,
    /paidKujiOrderEntitlementIds\(order, quantity\)[\s\S]*?checkoutRequestStillCurrent\(tokens\.accessToken, expectedRouteIdentity\)[\s\S]*?router\.replace/,
  );
  assert.match(checkout, /checkoutPaymentAvailability\([\s\S]*?paymentTotal,[\s\S]*?testPaymentsEnabled/);
  assert.doesNotMatch(checkout, /openGachaPreview|\/draw\/preview|text: "체험하기"/);
  assert.match(checkout, /paymentAvailability === "demo"[\s\S]{0,180}?TEST_PG 결제 후 뽑기로 이동/);
  assert.match(checkout, /useState<PaymentMethodId>\("card"\)/);
  assert.match(checkout, /accessibilityRole="radio"/);
  assert.match(checkout, /onPress=\{\(\) => setSelectedPaymentMethod\(method\.id\)\}/);
  for (const label of [
    "신용/체크카드",
    "KG이니시스 카드 결제",
  ]) {
    assert.match(checkout, new RegExp(label));
  }
  assert.match(checkout, /TEST_PG · 실제 과금 없음/);
  assert.match(checkout, /아래 수단은 모두 동일한 테스트 결제로 처리하며 카드나 간편결제 정보는 입력하지 않아요/);
  assert.doesNotMatch(checkout, /테스트 계정|데모 계정|계정 A|계정 B/);
});

test("order details expose server-permitted refund without changing production records locally", async () => {
  const detail = await read("apps/mobile/src/features/profile/ProfileRecordDetailScreen.tsx");
  assert.match(detail, /!snapshot\.isExample[\s\S]*?<DemoPaymentControls[\s\S]*?surface="internal-commerce"[\s\S]*?orderId=\{order\.id\}[\s\S]*?onOrderChanged=\{\(\) => profileState\.reload\(\)\}/);
  assert.doesNotMatch(detail, /internalCommerce/);
  assert.doesNotMatch(detail, /setOrder\(|status:\s*"REFUNDED"/);
});
