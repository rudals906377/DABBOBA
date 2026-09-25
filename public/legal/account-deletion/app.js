(function () {
  "use strict";

  const RECEIPT_STORAGE_KEY = "dabboba.account-deletion.web-receipt.v1";
  const SOCIAL_PKCE_STORAGE_KEY = "dabboba.account-deletion.social-pkce.v1";
  const SOCIAL_RESULT_STORAGE_KEY = "dabboba.account-deletion.social-result.v1";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STATUS_TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const VERSION = /^\d{4}-\d{2}-\d{2}$/;
  const BLOCKERS = [
    ["activeOrderCount", "진행 중인 주문"],
    ["activePaymentCount", "처리 중인 결제"],
    ["availableDrawEntitlementCount", "사용하지 않은 뽑기 권한"],
    ["activeInventoryCount", "보관 중인 상품"],
    ["activeShippingRequestCount", "진행 중인 배송"],
    ["activeExchangeListingCount", "진행 중인 교환 등록"],
    ["activeExchangeOfferCount", "진행 중인 교환 제안"],
    ["pointBalance", "남아 있는 포인트"],
  ];
  const STATUS_LABELS = {
    PENDING_REVIEW: "접수됨",
    BLOCKED: "정리 필요",
    PROCESSING: "삭제 처리 중",
    APPROVED: "삭제 처리 중",
    COMPLETED: "삭제 완료",
    REJECTED: "처리 불가",
    CANCELLED: "취소됨",
  };

  const elements = Object.fromEntries([
    "service-loading", "service-unavailable", "receipt-step", "receipt-id",
    "receipt-status", "receipt-updated", "receipt-guidance", "refresh-status-button",
    "clear-receipt-button", "authentication-flow", "email-form", "account-email", "phone-form", "account-phone", "send-phone-otp-button", "otp-field-label",
    "consent-step", "social-auth-step", "social-auth-buttons",
    "send-otp-button", "otp-form", "account-otp", "otp-help", "otp-sent-message",
    "accept-terms", "accept-privacy", "verify-otp-button", "resend-otp-button", "change-email-button",
    "preview-step", "deletion-ready", "deletion-blocked", "blocker-list",
    "confirm-deletion", "request-deletion-button", "refresh-preview-button",
    "flow-message", "flow-error",
  ].map(function (id) { return [id, document.getElementById(id)]; }));

  let runtimeConfig = null;
  let verifiedSessionToken = null;
  let verifiedSessionExpiresAt = 0;
  let requestedEmail = "";
  let requestedPhone = "";
  let activeOtpMethod = null;
  let otpExpiresAt = 0;
  let resendAvailableAt = 0;
  let countdownTimer = null;
  let deletionRequestKey = null;

  void initialize();

  elements["email-form"].addEventListener("submit", function (event) {
    event.preventDefault();
    void requestOtp();
  });
  elements["phone-form"].addEventListener("submit", function (event) {
    event.preventDefault();
    void requestPhoneOtp();
  });
  elements["otp-form"].addEventListener("submit", function (event) {
    event.preventDefault();
    void verifyOtp();
  });
  elements["resend-otp-button"].addEventListener("click", function () {
    if (activeOtpMethod === "PHONE") void requestPhoneOtp(true);
    else void requestOtp(true);
  });
  elements["change-email-button"].addEventListener("click", function () {
    const previousMethod = activeOtpMethod;
    prepareFreshAuthentication();
    elements[previousMethod === "PHONE" ? "account-phone" : "account-email"].focus();
  });
  elements["refresh-preview-button"].addEventListener("click", function () {
    if (!activeVerifiedSession()) {
      resetAuthentication("다시 확인하려면 가입에 사용한 방법으로 본인 확인을 진행해 주세요.");
      return;
    }
    void loadDeletionPreview();
  });
  elements["confirm-deletion"].addEventListener("change", function () {
    elements["request-deletion-button"].disabled = !elements["confirm-deletion"].checked;
  });
  elements["request-deletion-button"].addEventListener("click", function () { void submitDeletionRequest(); });
  elements["refresh-status-button"].addEventListener("click", function () { void refreshReceiptStatus(); });
  elements["clear-receipt-button"].addEventListener("click", clearReceiptAndRestart);
  document.querySelectorAll(".social-auth-button").forEach(function (button) {
    button.addEventListener("click", function () { void beginSocialLogin(button.dataset.provider, button); });
  });
  window.addEventListener("pagehide", function () { void releaseVerifiedSession(true); });

  async function initialize() {
    const receipt = readReceipt();
    if (receipt) {
      showReceipt(receipt, null);
      await refreshReceiptStatus(receipt);
    }

    try {
      const config = await requestJson("/account-deletion/runtime-config.json", { method: "GET" });
      if (!isRuntimeConfig(config)) throw new Error("service unavailable");
      runtimeConfig = config;
      elements["service-loading"].hidden = true;
      configureAuthenticationMethods(config);
      if (!receipt) {
        elements["authentication-flow"].hidden = false;
        await consumeSocialLoginResult();
      }
    } catch {
      elements["service-loading"].hidden = true;
      elements["service-unavailable"].hidden = false;
      elements["authentication-flow"].hidden = true;
    }
  }

  function configureAuthenticationMethods(config) {
    elements["email-form"].hidden = !config?.emailOtpEnabled;
    elements["phone-form"].hidden = !config?.phoneOtpEnabled;
    configureSocialMethods(config?.socialMethods);
  }

  function configureSocialMethods(methods) {
    const enabled = new Set(Array.isArray(methods) ? methods : []);
    let visibleCount = 0;
    document.querySelectorAll(".social-auth-button").forEach(function (button) {
      const visible = enabled.has(button.dataset.provider);
      button.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    elements["social-auth-step"].hidden = visibleCount === 0;
  }

  async function beginSocialLogin(provider, button) {
    clearError();
    if (!runtimeConfig || !runtimeConfig.socialMethods.includes(provider)) {
      return showError("현재 선택한 로그인 방식을 사용할 수 없습니다.");
    }
    if (!elements["accept-terms"].checked || !elements["accept-privacy"].checked) {
      return showError("이용약관과 개인정보처리방침을 각각 확인하고 동의해 주세요.", elements["accept-terms"]);
    }
    setBusy(button, true, "연결 중");
    try {
      const codeVerifier = randomBase64Url(32);
      const codeChallenge = await createPkceChallenge(codeVerifier);
      const response = await requestJson("/account-deletion/auth/social/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: provider,
          codeChallenge: codeChallenge,
          acceptedPolicies: runtimeConfig.requiredPolicyVersions,
        }),
      });
      if (
        !response
        || typeof response.authorizationUrl !== "string"
        || typeof response.state !== "string"
        || !STATUS_TOKEN.test(response.state)
      ) throw new Error("invalid social authorization");
      const authorizationUrl = new URL(response.authorizationUrl);
      if (authorizationUrl.protocol !== "https:") throw new Error("insecure social authorization");
      sessionStorage.setItem(SOCIAL_PKCE_STORAGE_KEY, JSON.stringify({
        state: response.state,
        codeVerifier: codeVerifier,
        createdAt: Date.now(),
      }));
      window.location.assign(authorizationUrl.toString());
    } catch {
      setBusy(button, false, socialButtonLabel(provider));
      showError("소셜 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  async function consumeSocialLoginResult() {
    let result = null;
    try {
      const raw = sessionStorage.getItem(SOCIAL_RESULT_STORAGE_KEY);
      sessionStorage.removeItem(SOCIAL_RESULT_STORAGE_KEY);
      if (raw) result = JSON.parse(raw);
    } catch {
      result = null;
    }
    const query = new URLSearchParams(window.location.search);
    const socialStatus = query.get("social");
    if (socialStatus) history.replaceState(null, "", "/account-deletion");
    if (!result) {
      if (socialStatus === "error") showError("소셜 본인 확인을 완료하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    if (
      result.verified !== true
      || typeof result.sessionToken !== "string"
      || !STATUS_TOKEN.test(result.sessionToken)
      || typeof result.expiresAt !== "string"
      || !Number.isFinite(Date.parse(result.expiresAt))
    ) {
      return showError("소셜 본인 확인을 완료하지 못했습니다. 다시 시도해 주세요.");
    }
    verifiedSessionToken = result.sessionToken;
    verifiedSessionExpiresAt = Date.parse(result.expiresAt);
    elements["consent-step"].hidden = true;
    elements["social-auth-step"].hidden = true;
    elements["email-form"].hidden = true;
    elements["phone-form"].hidden = true;
    elements["otp-form"].hidden = true;
    await loadDeletionPreview();
  }

  function socialButtonLabel(provider) {
    return ({ KAKAO: "카카오로 확인", NAVER: "네이버로 확인", GOOGLE: "Google로 확인", APPLE: "Apple로 확인" })[provider]
      || "소셜 계정으로 확인";
  }

  function randomBase64Url(byteLength) {
    const bytes = new Uint8Array(byteLength);
    globalThis.crypto.getRandomValues(bytes);
    let binary = "";
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function createPkceChallenge(codeVerifier) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
    let binary = "";
    new Uint8Array(digest).forEach(function (byte) { binary += String.fromCharCode(byte); });
    return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function requestOtp(isResend) {
    clearError();
    if (!runtimeConfig?.emailOtpEnabled) return showError("현재 이메일 인증을 사용할 수 없습니다.");
    const email = normalizeEmail(elements["account-email"].value);
    if (!email) return showError("이메일 주소 형식을 확인해 주세요.", elements["account-email"]);
    if (Date.now() < resendAvailableAt) return;

    setBusy(elements["send-otp-button"], true, isResend ? "다시 보내는 중" : "보내는 중");
    setBusy(elements["resend-otp-button"], true, "보내는 중");
    try {
      const response = await requestJson("/account-deletion/auth/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email }),
      });
      if (
        response.accepted !== true
        || typeof response.message !== "string"
        || !Number.isSafeInteger(response.expiresAfterSeconds)
        || !Number.isSafeInteger(response.resendAfterSeconds)
      ) throw new Error("invalid otp response");
      requestedEmail = email;
      activeOtpMethod = "EMAIL";
      otpExpiresAt = Date.now() + response.expiresAfterSeconds * 1000;
      resendAvailableAt = Date.now() + response.resendAfterSeconds * 1000;
      elements["account-email"].value = email;
      elements["account-email"].readOnly = true;
      elements["email-form"].hidden = true;
      elements["phone-form"].hidden = true;
      elements["otp-field-label"].textContent = "이메일 인증번호 6자리";
      elements["otp-sent-message"].textContent = response.message;
      elements["otp-form"].hidden = false;
      elements["account-otp"].value = "";
      elements["account-otp"].focus();
      showMessage(response.message);
      startCountdown();
    } catch {
      showError("인증번호를 요청하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(elements["send-otp-button"], false, requestedEmail ? "인증번호 다시 받기" : "인증번호 받기");
      updateCountdown();
    }
  }

  function normalizePhone(value) {
    const compact = String(value || "").replace(/[\s-]/g, "");
    if (/^010\d{8}$/.test(compact)) return "+82" + compact.slice(1);
    return /^\+8210\d{8}$/.test(compact) ? compact : null;
  }

  async function requestPhoneOtp(isResend) {
    clearError();
    if (!runtimeConfig?.phoneOtpEnabled) return showError("현재 휴대폰 인증을 사용할 수 없습니다.");
    const phone = normalizePhone(elements["account-phone"].value);
    if (!phone) return showError("010으로 시작하는 휴대폰 번호를 확인해 주세요.", elements["account-phone"]);
    if (!elements["accept-terms"].checked || !elements["accept-privacy"].checked) {
      return showError("이용약관과 개인정보처리방침을 각각 확인하고 동의해 주세요.");
    }
    if (Date.now() < resendAvailableAt) return;

    setBusy(elements["send-phone-otp-button"], true, isResend ? "다시 보내는 중" : "보내는 중");
    setBusy(elements["resend-otp-button"], true, "보내는 중");
    try {
      const response = await requestJson("/account-deletion/auth/phone-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (response.accepted !== true || !Number.isSafeInteger(response.expiresAfterSeconds)
        || !Number.isSafeInteger(response.resendAfterSeconds)) throw new Error("invalid otp response");
      requestedPhone = phone;
      activeOtpMethod = "PHONE";
      otpExpiresAt = Date.now() + response.expiresAfterSeconds * 1000;
      resendAvailableAt = Date.now() + response.resendAfterSeconds * 1000;
      elements["account-phone"].value = phone;
      elements["account-phone"].readOnly = true;
      elements["phone-form"].hidden = true;
      elements["email-form"].hidden = true;
      elements["otp-field-label"].textContent = "문자 인증번호 6자리";
      elements["otp-sent-message"].textContent = response.message;
      elements["otp-form"].hidden = false;
      elements["account-otp"].value = "";
      elements["account-otp"].focus();
      showMessage(response.message);
      startCountdown();
    } catch {
      showError("인증번호를 요청하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(elements["send-phone-otp-button"], false, "문자 인증번호 받기");
      updateCountdown();
    }
  }

  async function verifyOtp() {
    clearError();
    if (!runtimeConfig || (activeOtpMethod === "PHONE" ? !requestedPhone : !requestedEmail)) return showError("인증번호를 다시 요청해 주세요.");
    const token = elements["account-otp"].value.trim();
    if (!/^\d{6}$/.test(token)) return showError("인증번호 6자리를 입력해 주세요.", elements["account-otp"]);
    if (Date.now() >= otpExpiresAt) return showError("인증번호 사용 시간이 지났습니다. 다시 받아 주세요.");
    if (!elements["accept-terms"].checked || !elements["accept-privacy"].checked) {
      return showError("이용약관과 개인정보처리방침을 각각 확인하고 동의해 주세요.");
    }

    setBusy(elements["verify-otp-button"], true, "확인 중");
    try {
      const result = await requestJson(activeOtpMethod === "PHONE" ? "/account-deletion/auth/phone-verify" : "/account-deletion/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(activeOtpMethod === "PHONE" ? { phone: requestedPhone } : { email: requestedEmail }),
          token: token,
          acceptedPolicies: runtimeConfig.requiredPolicyVersions,
        }),
      });
      if (!result.verified || !STATUS_TOKEN.test(result.sessionToken)) throw new Error("invalid session");
      verifiedSessionToken = result.sessionToken;
      verifiedSessionExpiresAt = Date.parse(result.expiresAt);
      elements["otp-form"].hidden = true;
      elements["email-form"].hidden = true;
      elements["phone-form"].hidden = true;
      stopCountdown();
      await loadDeletionPreview();
    } catch (error) {
      const status = error && typeof error === "object" ? error.status : 0;
      showError(status === 428
        ? "약관 버전이 변경되었습니다. 페이지를 새로고침한 뒤 다시 진행해 주세요."
        : status >= 500
          ? "본인 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
          : "인증번호를 확인할 수 없습니다. 번호 또는 유효시간을 확인해 주세요.");
      elements["account-otp"].select();
    } finally {
      setBusy(elements["verify-otp-button"], false, "본인 확인");
    }
  }

  async function loadDeletionPreview() {
    clearError();
    if (!activeVerifiedSession()) return resetAuthentication("본인 확인 시간이 지났습니다. 다시 인증해 주세요.");
    setBusy(elements["refresh-preview-button"], true, "확인 중");
    try {
      const preview = await requestJson("/account-deletion/service/preview", {
        method: "GET",
        headers: { authorization: "Bearer " + verifiedSessionToken },
      });
      elements["preview-step"].hidden = false;
      const canDeleteNow = renderDeletionPreview(preview);
      showMessage("삭제 가능 상태를 확인했습니다.");
      if (!canDeleteNow) {
        await releaseVerifiedSession();
        elements["refresh-preview-button"].textContent = "다시 본인 확인";
      }
    } catch (error) {
      const status = error && typeof error === "object" ? error.status : 0;
      if (status === 401 || status === 403) return resetAuthentication("본인 확인 시간이 지났습니다. 다시 인증해 주세요.");
      showError("삭제 가능 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(
        elements["refresh-preview-button"],
        false,
        activeVerifiedSession() ? "다시 확인" : "다시 본인 확인",
      );
    }
  }

  function renderDeletionPreview(preview) {
    const blockers = BLOCKERS.filter(function (entry) {
      return Number.isSafeInteger(preview.blockers && preview.blockers[entry[0]])
        && preview.blockers[entry[0]] > 0;
    });
    const canDeleteNow = preview.canDeleteNow === true && blockers.length === 0;
    elements["deletion-ready"].hidden = !canDeleteNow;
    elements["deletion-blocked"].hidden = canDeleteNow;
    elements["confirm-deletion"].checked = false;
    elements["request-deletion-button"].disabled = true;
    elements["blocker-list"].replaceChildren();
    blockers.forEach(function (entry) {
      const item = document.createElement("li");
      const amount = preview.blockers[entry[0]];
      item.textContent = entry[1] + " " + amount + (entry[0] === "pointBalance" ? "P" : "건");
      elements["blocker-list"].appendChild(item);
    });
    return canDeleteNow;
  }

  async function submitDeletionRequest() {
    clearError();
    if (!elements["confirm-deletion"].checked) return;
    if (!activeVerifiedSession()) return resetAuthentication("본인 확인 시간이 지났습니다. 다시 인증해 주세요.");
    if (!window.confirm("계정을 삭제하면 일반 회원정보와 로그인 연결을 복구할 수 없습니다. 탈퇴를 요청할까요?")) return;

    try {
      deletionRequestKey = deletionRequestKey || createIdempotencyKey();
      setBusy(elements["request-deletion-button"], true, "접수 중");
      const receipt = await requestJson("/account-deletion/service/request", {
        method: "POST",
        headers: {
          authorization: "Bearer " + verifiedSessionToken,
          "content-type": "application/json",
          "idempotency-key": deletionRequestKey,
        },
        body: "{}",
      });
      if (!isReceipt(receipt)) throw new Error("invalid receipt");
      storeReceipt({ requestId: receipt.id, statusToken: receipt.statusToken });
      clearSensitiveState();
      elements["authentication-flow"].hidden = true;
      showReceipt({ requestId: receipt.id, statusToken: receipt.statusToken }, receipt);
      showMessage("탈퇴 요청이 접수되었습니다. 접수번호를 보관해 주세요.");
    } catch (error) {
      const status = error && typeof error === "object" ? error.status : 0;
      if (status === 401 || status === 403) return resetAuthentication("본인 확인 시간이 지났습니다. 다시 인증해 주세요.");
      showError(status === 409
        ? "이미 탈퇴 처리가 진행 중입니다. 저장된 접수정보가 없다면 고객지원으로 문의해 주세요."
        : "탈퇴 요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(elements["request-deletion-button"], false, "계정 삭제 요청");
    }
  }

  async function refreshReceiptStatus(receiptOverride) {
    clearError();
    const receipt = receiptOverride || readReceipt();
    if (!receipt) return;
    setBusy(elements["refresh-status-button"], true, "확인 중");
    try {
      const status = await requestJson("/account-deletion/service/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(receipt),
      });
      showReceipt(receipt, status);
    } catch (error) {
      const code = error && typeof error === "object" ? error.status : 0;
      showError(code === 404
        ? "이 브라우저의 접수정보로 상태를 확인할 수 없습니다. 고객지원으로 문의해 주세요."
        : "처리 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(elements["refresh-status-button"], false, "처리 상태 새로고침");
    }
  }

  function showReceipt(receipt, status) {
    elements["receipt-step"].hidden = false;
    elements["authentication-flow"].hidden = true;
    elements["receipt-id"].textContent = receipt.requestId;
    elements["receipt-status"].textContent = status ? STATUS_LABELS[status.status] || "처리 중" : "확인 중";
    elements["receipt-updated"].textContent = status && status.lastRequestedAt
      ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(status.lastRequestedAt))
      : "상태를 불러오는 중";
    elements["receipt-guidance"].textContent = statusGuidance(status && status.status);
  }

  function statusGuidance(status) {
    if (status === "COMPLETED") return "계정과 일반 개인정보 삭제가 완료되었습니다. 법정 보관 기록은 분리 보관 후 기간이 지나면 파기됩니다.";
    if (status === "BLOCKED") return "정리할 항목이 남아 있습니다. 고객지원으로 문의해 주세요.";
    if (status === "REJECTED" || status === "CANCELLED") return "요청 상태를 고객지원에서 확인해 주세요.";
    return "외부 로그인 연결 삭제가 지연되면 로그인을 차단한 상태로 안전하게 재시도합니다.";
  }

  function clearReceiptAndRestart() {
    if (!window.confirm("이 브라우저에 저장된 접수정보만 지웁니다. 실제 탈퇴 요청은 취소되지 않습니다. 계속할까요?")) return;
    try { localStorage.removeItem(RECEIPT_STORAGE_KEY); } catch {}
    elements["receipt-step"].hidden = true;
    prepareFreshAuthentication();
    if (runtimeConfig) elements["authentication-flow"].hidden = false;
    showMessage("이 브라우저에서 접수정보를 지웠습니다. 실제 탈퇴 요청은 그대로 진행됩니다.");
  }

  function storeReceipt(receipt) {
    try { localStorage.setItem(RECEIPT_STORAGE_KEY, JSON.stringify(receipt)); } catch {}
  }

  function readReceipt() {
    try {
      const raw = localStorage.getItem(RECEIPT_STORAGE_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!isStoredReceipt(value)) {
        localStorage.removeItem(RECEIPT_STORAGE_KEY);
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  function isStoredReceipt(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === 2
      && typeof value.requestId === "string" && UUID.test(value.requestId)
      && typeof value.statusToken === "string" && STATUS_TOKEN.test(value.statusToken);
  }

  function isReceipt(value) {
    return value && typeof value.id === "string" && UUID.test(value.id)
      && typeof value.statusToken === "string" && STATUS_TOKEN.test(value.statusToken);
  }

  function isRuntimeConfig(value) {
    const versions = value && value.requiredPolicyVersions;
    return value && value.ready === true
      && typeof value.emailOtpEnabled === "boolean"
      && typeof value.phoneOtpEnabled === "boolean"
      && value.authMethod === (value.phoneOtpEnabled ? "PHONE_OTP" : value.emailOtpEnabled ? "EMAIL_OTP" : null)
      && Array.isArray(value.socialMethods)
      && value.socialMethods.every(function (method, index, methods) {
        return ["KAKAO", "NAVER", "GOOGLE", "APPLE"].includes(method)
          && methods.indexOf(method) === index;
      })
      && (value.emailOtpEnabled || value.phoneOtpEnabled || value.socialMethods.length > 0)
      && versions && VERSION.test(versions.terms) && VERSION.test(versions.privacy)
      && Number.isSafeInteger(value.resendAfterSeconds) && value.resendAfterSeconds >= 30
      && Number.isSafeInteger(value.expiresAfterSeconds) && value.expiresAfterSeconds >= 300;
  }

  function normalizeEmail(value) {
    const email = String(value || "").trim().toLocaleLowerCase("en-US");
    return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
  }

  function activeVerifiedSession() {
    return typeof verifiedSessionToken === "string"
      && STATUS_TOKEN.test(verifiedSessionToken)
      && Number.isFinite(verifiedSessionExpiresAt)
      && verifiedSessionExpiresAt > Date.now();
  }

  function resetAuthentication(message) {
    void releaseVerifiedSession();
    prepareFreshAuthentication();
    showError(message);
  }

  function prepareFreshAuthentication() {
    clearSensitiveState();
    configureAuthenticationMethods(runtimeConfig);
    elements["consent-step"].hidden = false;
    elements["account-email"].readOnly = false;
    elements["account-email"].value = "";
    elements["account-phone"].readOnly = false;
    elements["account-phone"].value = "";
    elements["otp-form"].hidden = true;
    elements["preview-step"].hidden = true;
    elements["accept-terms"].checked = false;
    elements["accept-privacy"].checked = false;
    elements["confirm-deletion"].checked = false;
    elements["request-deletion-button"].disabled = true;
  }

  function clearSensitiveState() {
    verifiedSessionToken = null;
    verifiedSessionExpiresAt = 0;
    requestedEmail = "";
    requestedPhone = "";
    activeOtpMethod = null;
    otpExpiresAt = 0;
    resendAvailableAt = 0;
    deletionRequestKey = null;
    elements["account-otp"].value = "";
    try {
      sessionStorage.removeItem(SOCIAL_PKCE_STORAGE_KEY);
      sessionStorage.removeItem(SOCIAL_RESULT_STORAGE_KEY);
    } catch {}
    stopCountdown();
  }

  async function releaseVerifiedSession(keepalive) {
    const sessionToken = verifiedSessionToken;
    verifiedSessionToken = null;
    verifiedSessionExpiresAt = 0;
    if (!sessionToken) return;
    try {
      await fetch("/account-deletion/auth/logout", {
        method: "POST",
        headers: { authorization: "Bearer " + sessionToken },
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        keepalive: keepalive === true,
      });
    } catch {
      // 이 짧은 세션은 브라우저에 저장하지 않으며 만료 시 자동 폐기됩니다.
    }
  }

  function startCountdown() {
    stopCountdown();
    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 1000);
  }

  function stopCountdown() {
    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function updateCountdown() {
    const remaining = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
    elements["resend-otp-button"].disabled = remaining > 0;
    elements["resend-otp-button"].textContent = remaining > 0 ? remaining + "초 후 다시 받기" : "인증번호 다시 받기";
    const otpRemaining = Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000));
    elements["otp-help"].textContent = otpRemaining > 0
      ? "인증번호 유효시간 " + Math.floor(otpRemaining / 60) + ":" + String(otpRemaining % 60).padStart(2, "0")
      : "인증번호 사용 시간이 지났습니다. 다시 받아 주세요.";
    if (remaining === 0 && otpRemaining === 0) stopCountdown();
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
    button.textContent = label;
  }

  function showMessage(message) {
    elements["flow-message"].textContent = message;
    clearError();
  }

  function showError(message, focusTarget) {
    elements["flow-error"].textContent = message;
    elements["flow-error"].hidden = false;
    elements["flow-message"].textContent = "";
    if (focusTarget) focusTarget.focus();
  }

  function clearError() {
    elements["flow-error"].textContent = "";
    elements["flow-error"].hidden = true;
  }

  function createIdempotencyKey() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    throw new Error("secure browser required");
  }

  async function requestJson(url, init) {
    const response = await fetch(url, Object.assign({
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    }, init));
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error("request failed");
      error.status = response.status;
      throw error;
    }
    return body;
  }
})();
