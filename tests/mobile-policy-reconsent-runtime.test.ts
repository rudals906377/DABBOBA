import assert from "node:assert/strict";
import test from "node:test";
import {
  createPolicyAwareFetch,
  registerPolicyReconsentHandler,
  requestPolicyReconsent,
  type PolicyReconsentChallenge,
} from "../apps/mobile/src/features/auth/policy-reconsent.js";

const challenge: PolicyReconsentChallenge = {
  accessToken: "a".repeat(43),
  requiredPolicyVersions: { terms: "2026-10-01", privacy: "2026-10-01" },
};

test("concurrent matching 428 challenges share one consent request", async () => {
  let calls = 0;
  let resolveConsent: ((accepted: boolean) => void) | null = null;
  const unregister = registerPolicyReconsentHandler(() => {
    calls += 1;
    return new Promise<boolean>((resolve) => { resolveConsent = resolve; });
  });
  const first = requestPolicyReconsent(challenge);
  const second = requestPolicyReconsent(challenge);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveConsent!(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  unregister();
});

test("a policy-aware request is retried at most once after explicit acceptance", async () => {
  let fetchCalls = 0;
  let recoveryCalls = 0;
  const networkFetch: typeof fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      error: {
        code: "LEGAL_ACCEPTANCE_REQUIRED",
        details: { requiredPolicyVersions: challenge.requiredPolicyVersions },
      },
    }), { status: 428, headers: { "content-type": "application/json" } });
  };
  const policyFetch = createPolicyAwareFetch(networkFetch, async (received) => {
    recoveryCalls += 1;
    assert.deepEqual(received, challenge);
    return true;
  });
  const response = await policyFetch(new Request("https://api.dabboba.test/v1/account/profile", {
    headers: { authorization: `Bearer ${challenge.accessToken}` },
  }));
  assert.equal(response.status, 428);
  assert.equal(fetchCalls, 2);
  assert.equal(recoveryCalls, 1);
});

test("logout and account-deletion recovery routes never open the consent flow", async () => {
  for (const path of [
    "/v1/auth/logout",
    "/v1/auth/logout-others",
    "/v1/account/policy-acceptances",
    "/v1/account/deletion-preview",
    "/v1/account/deletion-request",
    "/v1/account/deletion-requests/123/status",
  ]) {
    let recoveryCalls = 0;
    const policyFetch = createPolicyAwareFetch(
      async () => new Response(JSON.stringify({
        error: {
          code: "LEGAL_ACCEPTANCE_REQUIRED",
          details: { requiredPolicyVersions: challenge.requiredPolicyVersions },
        },
      }), { status: 428, headers: { "content-type": "application/json" } }),
      async () => { recoveryCalls += 1; return true; },
    );
    await policyFetch(new Request(`https://api.dabboba.test${path}`, {
      headers: { authorization: `Bearer ${challenge.accessToken}` },
    }));
    assert.equal(recoveryCalls, 0, path);
  }
});
