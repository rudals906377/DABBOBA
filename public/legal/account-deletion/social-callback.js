(function () {
  "use strict";

  const PKCE_STORAGE_KEY = "dabboba.account-deletion.social-pkce.v1";
  const RESULT_STORAGE_KEY = "dabboba.account-deletion.social-result.v1";
  const STATE = /^[A-Za-z0-9_-]{43}$/;
  const PKCE_VALUE = /^[A-Za-z0-9_-]{43,128}$/;
  const statusElement = document.getElementById("social-callback-status");
  const errorElement = document.getElementById("social-callback-error");

  void complete();

  async function complete() {
    const query = new URLSearchParams(window.location.search);
    const state = query.get("state");
    const code = query.get("code");
    let pending = null;
    try {
      const raw = sessionStorage.getItem(PKCE_STORAGE_KEY);
      sessionStorage.removeItem(PKCE_STORAGE_KEY);
      pending = raw ? JSON.parse(raw) : null;
    } catch {
      pending = null;
    }
    if (
      query.has("error")
      || !STATE.test(state || "")
      || typeof code !== "string"
      || code.length < 16
      || code.length > 8_192
      || !pending
      || pending.state !== state
      || !PKCE_VALUE.test(pending.codeVerifier || "")
      || !Number.isFinite(pending.createdAt)
      || Date.now() - pending.createdAt > 10 * 60_000
    ) return fail();

    try {
      const response = await fetch("/account-deletion/auth/social/verify", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: state, code: code, codeVerifier: pending.codeVerifier }),
      });
      const result = await response.json().catch(function () { return null; });
      if (
        !response.ok
        || !result
        || result.verified !== true
        || typeof result.sessionToken !== "string"
        || !STATE.test(result.sessionToken)
        || typeof result.expiresAt !== "string"
        || !Number.isFinite(Date.parse(result.expiresAt))
      ) return fail();
      sessionStorage.setItem(RESULT_STORAGE_KEY, JSON.stringify(result));
      window.location.replace("/account-deletion?social=complete");
    } catch {
      fail();
    }
  }

  function fail() {
    statusElement.hidden = true;
    errorElement.hidden = false;
  }
})();
