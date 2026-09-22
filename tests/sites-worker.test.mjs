import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import worker, { handleAccountDeletionService } from "../worker/index.js";

const accountDeletionRuntime = {
  DABBOBA_PUBLIC_API_ORIGIN: "https://api.dabboba.net",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public_web_account_deletion_fixture",
};

const policyVersions = { terms: "2026-09-22", privacy: "2026-09-22" };
const emptyBlockers = {
  pointBalance: 0,
  activeOrderCount: 0,
  activePaymentCount: 0,
  availableDrawEntitlementCount: 0,
  activeInventoryCount: 0,
  activeShippingRequestCount: 0,
  activeExchangeListingCount: 0,
  activeExchangeOfferCount: 0,
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("redirects the www host to the canonical apex host", async () => {
  let assetFetches = 0;
  const response = await worker.fetch(
    new Request("http://www.dabboba.net/privacy?source=store"),
    {
      ASSETS: {
        fetch: async () => {
          assetFetches += 1;
          return new Response("unexpected", { status: 500 });
        },
      },
    },
  );

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://dabboba.net/privacy?source=store");
  assert.equal(assetFetches, 0);
});

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("serves the public storefront root and every policy URL with security headers", async () => {
  const routes = new Map([
    ["/", "/"],
    ["/index.html", "/index.html"],
    ["/privacy", "/legal/privacy/"],
    ["/privacy/", "/legal/privacy/"],
    ["/terms", "/legal/terms/"],
    ["/support", "/legal/support/"],
    ["/account-deletion", "/legal/account-deletion/"],
    ["/account-deletion/auth/social/callback", "/legal/account-deletion/social-callback?source=store"],
    ["/community-operations", "/legal/community-operations/"],
  ]);

  for (const [publicPath, assetPath] of routes) {
    const calls = [];
    const response = await worker.fetch(
      new Request(`https://dabboba.net${publicPath}?source=store`, {
        headers: { accept: "text/html" },
      }),
      {
        ASSETS: {
          fetch: async (request) => {
            const url = new URL(request.url);
            calls.push(url.pathname + url.search);
            return new Response("policy", {
              status: 200,
              headers: { "content-type": "text/html; charset=UTF-8" },
            });
          },
        },
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [assetPath]);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(response.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
  }
});

test("public hosts serve storefront assets but do not fall back for unknown or prototype routes", async () => {
  for (const publicHost of [
    "dabboba.net",
    "dabboba.pages.dev",
    "release-id.dabboba.pages.dev",
    "dabboba-random.pages.dev",
  ]) {
    const storefrontAssetCalls = [];
    const storefrontAsset = await worker.fetch(new Request(`https://${publicHost}/assets/storefront-main.js`), {
      ASSETS: {
        fetch: async (request) => {
          storefrontAssetCalls.push(new URL(request.url).pathname);
          return new Response("storefront", {
            status: 200,
            headers: { "content-type": "text/javascript" },
          });
        },
      },
    });

    assert.equal(storefrontAsset.status, 200);
    assert.deepEqual(storefrontAssetCalls, ["/assets/storefront-main.js"]);
    assert.equal(storefrontAsset.headers.get("content-type"), "text/javascript");
    assert.equal(storefrontAsset.headers.get("x-content-type-options"), "nosniff");

    for (const pathname of ["/flow/step-two", "/unexpected-route", "/assets/dabboba/draw/gacha/arcade-cabinet.png"]) {
      let assetFetches = 0;
      const response = await worker.fetch(new Request(`https://${publicHost}${pathname}`, {
        headers: { accept: "text/html" },
      }), {
        ASSETS: {
          fetch: async () => {
            assetFetches += 1;
            return new Response("missing", { status: 404 });
          },
        },
      });

      assert.equal(response.status, 404);
      assert.equal(assetFetches, 1);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
  }
});

test("public legal assets retain hardening headers", async () => {
  const response = await worker.fetch(new Request("https://dabboba.pages.dev/legal/styles.css"), {
    ASSETS: { fetch: async () => new Response("body{}", { headers: { "content-type": "text/css" } }) },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/css");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
});

test("web account deletion stays fail-closed until all public bindings are safe", async () => {
  let upstreamCalls = 0;
  const fetcher = async () => {
    upstreamCalls += 1;
    return json({ unexpected: true });
  };
  for (const env of [
    {},
    { ...accountDeletionRuntime, DABBOBA_PUBLIC_API_ORIGIN: "http://api.dabboba.net" },
    { ...accountDeletionRuntime, SUPABASE_URL: "https://project.supabase.co/auth/v1" },
    { ...accountDeletionRuntime, SUPABASE_PUBLISHABLE_KEY: "sb_secret_never_public" },
  ]) {
    const response = await handleAccountDeletionService(
      new Request("https://dabboba.net/account-deletion/runtime-config.json"),
      env,
      fetcher,
    );
    assert.equal(response?.status, 503);
    assert.equal(response?.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response?.json(), {
      ready: false,
      error: {
        code: "ACCOUNT_DELETION_UNAVAILABLE",
        message: "현재 웹 탈퇴 요청을 사용할 수 없습니다.",
      },
    });
  }
  assert.equal(upstreamCalls, 0);

  const previewHost = await handleAccountDeletionService(
    new Request("https://dabboba-preview.pages.dev/account-deletion/runtime-config.json"),
    accountDeletionRuntime,
    fetcher,
  );
  assert.equal(previewHost?.status, 503);
  assert.equal(upstreamCalls, 0);
});

test("web account deletion runtime requires EMAIL and matching live policy versions", async () => {
  const calls = [];
  const response = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/runtime-config.json"),
    accountDeletionRuntime,
    async (url) => {
      calls.push(url);
      if (url.endsWith("/v1/auth/providers")) {
        return json({ methods: ["EMAIL"], brokerExchangeConfigured: true, requiredPolicyVersions: policyVersions });
      }
      if (url.endsWith("/v1/public/config")) {
        return json({ commerceMode: "PRELAUNCH", requiredPolicyVersions: policyVersions });
      }
      return json({}, 404);
    },
  );

  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), {
    ready: true,
    authMethod: "EMAIL_OTP",
    socialMethods: [],
    requiredPolicyVersions: policyVersions,
    resendAfterSeconds: 60,
    expiresAfterSeconds: 600,
  });
  assert.deepEqual(calls.sort(), [
    "https://api.dabboba.net/v1/auth/providers",
    "https://api.dabboba.net/v1/public/config",
  ]);

  const mismatched = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/runtime-config.json"),
    accountDeletionRuntime,
    async (url) => url.endsWith("/v1/auth/providers")
      ? json({ methods: ["KAKAO"], brokerExchangeConfigured: true, requiredPolicyVersions: policyVersions })
      : json({ commerceMode: "PRELAUNCH", requiredPolicyVersions: { ...policyVersions, privacy: "2026-09-21" } }),
  );
  assert.equal(mismatched?.status, 503);
});

test("social account deletion uses bounded PKCE and exchanges only an existing provider session", async () => {
  const verifier = "v".repeat(43);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString("base64url");
  const startCalls = [];
  const start = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/auth/social/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "KAKAO", codeChallenge: challenge, acceptedPolicies: policyVersions }),
    }),
    accountDeletionRuntime,
    async (url, init) => {
      startCalls.push({ url, init });
      return json({
        methods: ["KAKAO", "EMAIL"],
        brokerExchangeConfigured: true,
        requiredPolicyVersions: policyVersions,
      });
    },
  );
  assert.equal(start?.status, 201);
  const startBody = await start?.json();
  assert.match(startBody.state, /^[A-Za-z0-9_-]{43}$/);
  const authorizationUrl = new URL(startBody.authorizationUrl);
  assert.equal(authorizationUrl.origin, "https://project.supabase.co");
  assert.equal(authorizationUrl.pathname, "/auth/v1/authorize");
  assert.equal(authorizationUrl.searchParams.get("provider"), "kakao");
  assert.equal(authorizationUrl.searchParams.get("code_challenge"), challenge);
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "s256");
  assert.match(authorizationUrl.searchParams.get("redirect_to") ?? "", /https:\/\/dabboba\.net\/account-deletion\/auth\/social\/callback/);
  assert.deepEqual(startCalls.map(({ url }) => url), ["https://api.dabboba.net/v1/auth/providers"]);
  const setCookie = start?.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^__Host-dabboba_deletion_oauth=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);

  const supabaseToken = `supabase.${"b".repeat(80)}.token`;
  const customerSession = "z".repeat(43);
  const verifyCalls = [];
  const verified = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/auth/social/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: setCookie.split(";")[0],
      },
      body: JSON.stringify({ state: startBody.state, code: "oauth-code-" + "c".repeat(32), codeVerifier: verifier }),
    }),
    accountDeletionRuntime,
    async (url, init) => {
      verifyCalls.push({ url, init });
      if (url.includes("/auth/v1/token?grant_type=pkce")) {
        assert.deepEqual(JSON.parse(init.body), { auth_code: "oauth-code-" + "c".repeat(32), code_verifier: verifier });
        return json({ access_token: supabaseToken });
      }
      if (url.endsWith("/v1/auth/account-deletion-exchange")) {
        assert.deepEqual(JSON.parse(init.body), {
          accessToken: supabaseToken,
          loginProvider: "KAKAO",
          acceptedPolicies: policyVersions,
        });
        return json({ token: customerSession, expiresAt: "2026-10-20T00:00:00.000Z", actor: {} }, 201);
      }
      if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
      return json({}, 404);
    },
  );
  assert.equal(verified?.status, 201);
  assert.deepEqual(await verified?.json(), {
    verified: true,
    sessionToken: customerSession,
    expiresAt: "2026-10-20T00:00:00.000Z",
  });
  assert.match(verified?.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal(verifyCalls.length, 3);

  const replay = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/auth/social/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: startBody.state, code: "oauth-code-" + "c".repeat(32), codeVerifier: verifier }),
    }),
    accountDeletionRuntime,
    async () => { throw new Error("replay must fail before upstream"); },
  );
  assert.equal(replay?.status, 401);
});

test("email OTP request never creates a user and does not reveal account existence", async () => {
  const responses = [];
  for (const upstreamStatus of [200, 400]) {
    const calls = [];
    const response = await handleAccountDeletionService(
      new Request("https://dabboba.net/account-deletion/auth/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "Member@Example.com" }),
      }),
      accountDeletionRuntime,
      async (url, init) => {
        calls.push({ url, init });
        return json(upstreamStatus === 200 ? {} : { error: "user_not_found" }, upstreamStatus);
      },
    );
    assert.equal(response?.status, 202);
    responses.push(await response?.text());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://project.supabase.co/auth/v1/otp");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      email: "member@example.com",
      create_user: false,
    });
    assert.equal(calls[0].init.headers.apikey, accountDeletionRuntime.SUPABASE_PUBLISHABLE_KEY);
  }
  assert.equal(responses[0], responses[1]);
  assert.doesNotMatch(responses[0], /member@example\.com|user_not_found/i);

  let invalidEmailUpstreamCalls = 0;
  const invalidEmail = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/auth/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
    accountDeletionRuntime,
    async () => {
      invalidEmailUpstreamCalls += 1;
      return json({ unexpected: true });
    },
  );
  assert.equal(invalidEmail?.status, 202);
  assert.equal(await invalidEmail?.text(), responses[0]);
  assert.equal(invalidEmailUpstreamCalls, 0);
});

test("email OTP verification exchanges a transient Supabase token for a DABBOBA session", async () => {
  const calls = [];
  const supabaseToken = `supabase.${"a".repeat(80)}.token`;
  const customerSession = "s".repeat(43);
  const response = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "member@example.com",
        token: "123456",
        acceptedPolicies: policyVersions,
      }),
    }),
    accountDeletionRuntime,
    async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/auth/v1/verify")) return json({ access_token: supabaseToken });
      if (url.endsWith("/v1/auth/exchange")) {
        const body = JSON.parse(init.body);
        assert.equal(body.accessToken, supabaseToken);
        assert.deepEqual(body.acceptedPolicies, policyVersions);
        assert.equal(body.loginProvider, "EMAIL");
        return json({ token: customerSession, expiresAt: "2026-10-20T00:00:00.000Z", actor: {} }, 201);
      }
      if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
      return json({}, 404);
    },
  );

  assert.equal(response?.status, 201);
  const body = await response?.json();
  assert.deepEqual(body, {
    verified: true,
    sessionToken: customerSession,
    expiresAt: "2026-10-20T00:00:00.000Z",
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.headers.authorization, `Bearer ${supabaseToken}`);
});

test("web deletion proxies only preview, request, session logout, and receipt-status contracts", async () => {
  const customerSession = "c".repeat(43);
  const requestId = "11111111-1111-4111-8111-111111111111";
  const statusToken = "r".repeat(43);
  const requestBody = {
    id: requestId,
    status: "PROCESSING",
    blockers: emptyBlockers,
    requestCount: 1,
    hardDeletePerformed: false,
    policy: "AUTOMATED_SERVER_DELETION",
    authDeletionStatus: "PENDING",
    requestedAt: "2026-09-20T00:00:00.000Z",
    lastRequestedAt: "2026-09-20T00:00:00.000Z",
    completedAt: null,
  };
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/deletion-preview")) return json({ canDeleteNow: true, blockers: emptyBlockers });
    if (url.endsWith("/deletion-request")) return json({ ...requestBody, statusToken }, 202);
    if (url.endsWith("/v1/auth/logout")) return new Response(null, { status: 204 });
    if (url.endsWith(`/deletion-requests/${requestId}/status`)) return json(requestBody);
    return json({}, 404);
  };

  const preview = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/service/preview", {
      headers: { authorization: `Bearer ${customerSession}` },
    }),
    accountDeletionRuntime,
    fetcher,
  );
  assert.equal(preview?.status, 200);
  assert.deepEqual(await preview?.json(), { canDeleteNow: true, blockers: emptyBlockers });

  const deletion = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/service/request", {
      method: "POST",
      headers: {
        authorization: `Bearer ${customerSession}`,
        "content-type": "application/json",
        "idempotency-key": "22222222-2222-4222-8222-222222222222",
      },
      body: "{}",
    }),
    accountDeletionRuntime,
    fetcher,
  );
  assert.equal(deletion?.status, 202);
  assert.equal((await deletion?.json()).statusToken, statusToken);

  const status = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/service/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, statusToken }),
    }),
    { DABBOBA_PUBLIC_API_ORIGIN: accountDeletionRuntime.DABBOBA_PUBLIC_API_ORIGIN },
    fetcher,
  );
  assert.equal(status?.status, 200);
  assert.deepEqual(await status?.json(), requestBody);

  const previewCall = calls.find(({ url }) => url.endsWith("/deletion-preview"));
  const requestCall = calls.find(({ url }) => url.endsWith("/deletion-request"));
  const logoutCall = calls.find(({ url }) => url.endsWith("/v1/auth/logout"));
  const statusCall = calls.find(({ url }) => url.endsWith(`/deletion-requests/${requestId}/status`));
  assert.equal(previewCall?.init.headers.authorization, `Bearer ${customerSession}`);
  assert.equal(requestCall?.init.headers["idempotency-key"], "22222222-2222-4222-8222-222222222222");
  assert.equal(logoutCall?.init.headers.authorization, `Bearer ${customerSession}`);
  assert.equal(statusCall?.init.headers["x-deletion-status-token"], statusToken);
});

test("web deletion can revoke an abandoned verified session without exposing API details", async () => {
  const customerSession = "d".repeat(43);
  const calls = [];
  const response = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${customerSession}` },
    }),
    { DABBOBA_PUBLIC_API_ORIGIN: accountDeletionRuntime.DABBOBA_PUBLIC_API_ORIGIN },
    async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    },
  );

  assert.equal(response?.status, 204);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.dabboba.net/v1/auth/logout");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${customerSession}`);
  assert.equal(calls[0].init.redirect, "error");

  const unavailable = await handleAccountDeletionService(
    new Request("https://dabboba.net/account-deletion/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${customerSession}` },
    }),
    { DABBOBA_PUBLIC_API_ORIGIN: accountDeletionRuntime.DABBOBA_PUBLIC_API_ORIGIN },
    async () => json({ error: "upstream unavailable" }, 503),
  );
  assert.equal(unavailable?.status, 503);
});

test("account deletion page stores only the receipt and presents an accessible real flow", async () => {
  const html = await readFile(new URL("../public/legal/account-deletion/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/legal/account-deletion/app.js", import.meta.url), "utf8");
  assert.match(html, /id="email-form"/);
  assert.match(html, /data-provider="KAKAO"/);
  assert.match(html, /data-provider="APPLE"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /id="change-email-button"/);
  assert.match(html, /id="confirm-deletion"/);
  assert.match(html, /role="alert"/);
  assert.match(script, /dabboba\.account-deletion\.web-receipt\.v1/);
  assert.match(script, /localStorage\.setItem\(RECEIPT_STORAGE_KEY, JSON\.stringify\(receipt\)\)/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^\n]*(?:sessionToken|verifiedSessionToken)/);
  assert.match(script, /credentials: "omit"/);
  assert.match(script, /window\.addEventListener\("pagehide"/);
  assert.match(script, /\/account-deletion\/auth\/logout/);
  assert.match(script, /\/account-deletion\/auth\/social\/start/);
  const callback = await readFile(new URL("../public/legal/account-deletion/social-callback.js", import.meta.url), "utf8");
  assert.match(callback, /\/account-deletion\/auth\/social\/verify/);
  assert.doesNotMatch(callback, /localStorage/);
});

test("account deletion remains requestable when automated web verification is unavailable", async () => {
  const html = await readFile(new URL("../public/legal/account-deletion/index.html", import.meta.url), "utf8");
  assert.match(html, /계정 삭제 요청 이메일 보내기/);
  assert.match(html, /mailto:support@dabboba\.net\?subject=/);
  assert.match(html, /앱을 사용할 수 없는 경우에도/);
});

test("legacy legal landing retains the full prelaunch limitation notice", async () => {
  const html = await readFile(new URL("../public/legal/index.html", import.meta.url), "utf8");
  assert.match(html, /PRELAUNCH/);
  assert.match(html, /결제, 뽑기와 배송 신청은 정식 오픈 전까지 사용할 수 없습니다/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
  assert.match(html, /href="\/support"/);
  assert.match(html, /href="\/account-deletion"/);
  assert.match(html, /support@dabboba\.net/);
  assert.doesNotMatch(html, /결제하기|지금 뽑기|구매하기/);
});

test("public storefront stays prelaunch-only and links every required policy surface", async () => {
  const source = await readFile(new URL("../apps/storefront/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /PRELAUNCH/);
  assert.match(source, /OPENING SOON/);
  assert.match(source, /정식 오픈 후 적용 예정/);
  for (const href of ["/privacy", "/terms", "/support", "/account-deletion"]) {
    assert.match(source, new RegExp(`href=\"${href.replace("/", "\\/")}\"`));
  }
  assert.doesNotMatch(source, /결제하기|뽑기 시작|구매하기|>0원</);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const request of [
    new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }),
    new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }),
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, 404);
    assert.equal(calls, 1);
  }
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/client/_worker.js", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  await access(new URL("../dist/client/legal/index.html", import.meta.url));
  for (const policy of ["privacy", "terms", "support", "account-deletion", "community-operations"]) {
    await access(new URL(`../dist/client/legal/${policy}/index.html`, import.meta.url));
  }
  await access(new URL("../dist/client/legal/account-deletion/app.js", import.meta.url));
  await access(new URL("../dist/client/legal/account-deletion/social-callback.html", import.meta.url));
  await access(new URL("../dist/client/legal/account-deletion/social-callback.js", import.meta.url));
  await access(new URL("../dist/public-site/index.html", import.meta.url));
  await access(new URL("../dist/public-site/_worker.js", import.meta.url));
  await access(new URL("../dist/public-site/legal/index.html", import.meta.url));
  await access(new URL("../dist/public-site/legal/privacy/index.html", import.meta.url));
  const outputEntries = (await readdir(new URL("../dist/public-site/", import.meta.url))).sort();
  assert.ok(outputEntries.includes("assets"));
  assert.ok(outputEntries.includes("index.html"));
  assert.ok(outputEntries.includes("_worker.js"));
  assert.ok(outputEntries.includes("legal"));
  await assert.rejects(
    access(new URL("../dist/public-site/assets/dabboba/draw/gacha/arcade-cabinet.png", import.meta.url)),
  );
});
