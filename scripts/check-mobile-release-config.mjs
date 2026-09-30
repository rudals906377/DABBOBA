import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPABASE_INTEGRATION_PROJECT_REF } from "./supabase-integration-profile.mjs";

export const REQUIRED_PUBLIC_BUILD_VARIABLES = Object.freeze([
  "EXPO_PUBLIC_DABBOBA_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL",
  "EXPO_PUBLIC_DABBOBA_TERMS_URL",
  "EXPO_PUBLIC_DABBOBA_SUPPORT_URL",
  "EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL",
  "EXPO_PUBLIC_COMMERCE_CAPABILITY",
]);

const LIVE_PUBLIC_BUILD_VARIABLES = Object.freeze([
  "EXPO_PUBLIC_PORTONE_STORE_ID",
  "EXPO_PUBLIC_PORTONE_CHANNEL_KEY",
]);

export const PG_REVIEW_PUBLIC_BUILD_VARIABLES = Object.freeze([
  "EXPO_PUBLIC_DABBOBA_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_COMMERCE_CAPABILITY",
  ...LIVE_PUBLIC_BUILD_VARIABLES,
]);

const REQUIRED_HTTPS_VARIABLES = Object.freeze([
  "EXPO_PUBLIC_DABBOBA_API_URL",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL",
  "EXPO_PUBLIC_DABBOBA_TERMS_URL",
  "EXPO_PUBLIC_DABBOBA_SUPPORT_URL",
  "EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL",
]);

const SOURCE_GATES = Object.freeze([
  {
    relativePath: "apps/mobile/src/features/demo/demo-api.ts",
    required: [
      /if\s*\(\s*!__DEV__\s*\)\s*return\s+null/,
      /if\s*\(\s*!__DEV__\s*\)\s*throw\s+new\s+Error/,
    ],
    description: "demo payment API must fail closed outside development",
  },
  {
    relativePath: "apps/mobile/src/features/demo/DemoPaymentControls.tsx",
    required: [/!__DEV__\s*\|\|\s*!enabled/],
    description: "TEST_PG controls must be hidden outside development",
  },
  {
    relativePath: "apps/mobile/app/_layout.tsx",
    required: [/InternalCustomerSessionBootstrap\s+enabled=\{__DEV__\}/],
    description: "internal customer bootstrap must be development-only",
  },
  {
    relativePath: "apps/mobile/src/features/auth/LoginScreen.tsx",
    required: [
      /onOpen=\{\(\) => openCurrentPolicy\("terms"\)\}/,
      /onOpen=\{\(\) => openCurrentPolicy\("privacy"\)\}/,
      /resolvePublicAppLink\(kind\)/,
      /Linking\.openURL\(url\)/,
    ],
    description: "login must open the published terms and privacy before authentication",
  },
  {
    relativePath: "apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx",
    required: [/resolvePublicAppLink\("accountDeletion"\)/, /회원탈퇴 요청/],
    description: "account settings must expose in-app deletion and the public deletion page",
  },
]);

const PLACEHOLDER_HOST = /(^|\.)(?:localhost|example(?:\.com)?|invalid|test|local)$|127\.0\.0\.1|0\.0\.0\.0|your-|placeholder/i;
const FORBIDDEN_PRODUCTION_MARKERS = /TEST_PG|INTERNAL_ZERO|ENABLE_DEMO|ENABLE_DEV_SESSION|MOBILE_TEST_FIXTURE/i;
const PRELAUNCH_LEGAL_MARKERS = /사전오픈판|결제(?:와|·주문·뽑기·배송 신청은).*제공하지 않습니다/;
const PORTONE_CONFIG_PLUGIN = "@portone/react-native-sdk/plugin";
const EXPECTED_IOS_RELEASE_TEAM_ID = "MCZ4884P7F";
const require = createRequire(import.meta.url);

// Production (PRELAUNCH and LIVE store builds) may only call the approved
// DABBOBA backend: the pinned Supabase project's Edge host or an explicitly
// approved custom domain that fronts it. Extend this list deliberately.
export const APPROVED_PRODUCTION_API_HOSTS = Object.freeze([
  `${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co`,
  "api.dabboba.net",
]);

export function isApprovedProductionApiUrl(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) return false;
  try {
    const url = new URL(rawValue.trim());
    return url.protocol === "https:"
      && !url.port
      && APPROVED_PRODUCTION_API_HOSTS.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function addIssue(collection, code, message) {
  collection.push({ code, message });
}

function readJson(filePath, errors, code) {
  if (!existsSync(filePath)) {
    addIssue(errors, `${code}_MISSING`, `${path.relative(process.cwd(), filePath)} 파일이 없습니다.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    addIssue(errors, `${code}_INVALID_JSON`, `${path.relative(process.cwd(), filePath)} JSON을 읽을 수 없습니다.`);
    return null;
  }
}

function resolveAppAsset(appDirectory, assetPath) {
  return typeof assetPath === "string" && assetPath.trim()
    ? path.resolve(appDirectory, assetPath)
    : null;
}

function readPngMetadata(filePath) {
  const bytes = readFileSync(filePath);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return null;

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  let hasTransparencyChunk = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    if (chunkType === "tRNS") hasTransparencyChunk = true;
    offset += 12 + chunkLength;
  }
  return {
    width,
    height,
    hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk,
  };
}

function validatePng({ filePath, name, requireOpaque, errors }) {
  if (!filePath || !existsSync(filePath)) {
    addIssue(errors, `${name}_MISSING`, `${name} PNG 자산을 찾을 수 없습니다.`);
    return;
  }
  const metadata = readPngMetadata(filePath);
  if (!metadata) {
    addIssue(errors, `${name}_INVALID_PNG`, `${name} 자산이 유효한 PNG가 아닙니다.`);
    return;
  }
  if (metadata.width !== 1024 || metadata.height !== 1024) {
    addIssue(
      errors,
      `${name}_DIMENSIONS`,
      `${name}은 1024×1024 PNG여야 합니다. 현재 ${metadata.width}×${metadata.height}입니다.`,
    );
  }
  if (requireOpaque && metadata.hasAlpha) {
    addIssue(errors, `${name}_ALPHA`, `${name}은 iOS 제출용으로 투명도를 포함하면 안 됩니다.`);
  }
}

function validReverseDns(value) {
  return typeof value === "string"
    && /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9-]*){2,}$/.test(value)
    && !/(?:example|placeholder|yourapp|your-app)/i.test(value);
}

function validateAppConfiguration(rootDir, environment, errors, warnings, structureOnly) {
  const appDirectory = path.join(rootDir, "apps/mobile");
  const appConfig = readJson(path.join(appDirectory, "app.json"), errors, "APP_CONFIG");
  if (!appConfig?.expo) return;
  const expo = appConfig.expo;

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(expo.version ?? "")) {
    addIssue(errors, "APP_VERSION_INVALID", "expo.version은 명시적인 semver여야 합니다.");
  }
  if (!validReverseDns(expo.ios?.bundleIdentifier)) {
    addIssue(errors, "IOS_BUNDLE_ID_INVALID", "iOS bundleIdentifier가 유효한 운영 식별자가 아닙니다.");
  }
  if (expo.ios?.appleTeamId !== EXPECTED_IOS_RELEASE_TEAM_ID) {
    addIssue(
      errors,
      "IOS_RELEASE_TEAM_MISMATCH",
      "iOS 공개 빌드는 확인된 친구 명의 Apple Developer 팀으로만 서명해야 합니다.",
    );
  }
  if (expo.ios?.usesAppleSignIn !== true) {
    addIssue(errors, "IOS_APPLE_SIGN_IN_CAPABILITY_MISSING", "Apple 로그인을 제공하는 iOS 빌드는 usesAppleSignIn capability를 선언해야 합니다.");
  }
  if (!/^\d+$/.test(expo.ios?.buildNumber ?? "") || Number(expo.ios?.buildNumber) < 1) {
    addIssue(errors, "IOS_BUILD_NUMBER_INVALID", "ios.buildNumber는 1 이상의 정수 문자열이어야 합니다.");
  }
  if (!validReverseDns(expo.android?.package)) {
    addIssue(errors, "ANDROID_PACKAGE_INVALID", "Android package가 유효한 운영 식별자가 아닙니다.");
  }
  if (!Number.isInteger(expo.android?.versionCode) || expo.android.versionCode < 1) {
    addIssue(errors, "ANDROID_VERSION_CODE_INVALID", "android.versionCode는 1 이상의 정수여야 합니다.");
  }

  validatePng({
    filePath: resolveAppAsset(appDirectory, expo.icon),
    name: "APP_ICON",
    requireOpaque: true,
    errors,
  });
  const adaptiveIcon = expo.android?.adaptiveIcon;
  if (!adaptiveIcon?.foregroundImage) {
    addIssue(
      structureOnly ? warnings : errors,
      "ANDROID_ADAPTIVE_ICON_REQUIRED",
      "현재 가로 워드마크 앱 아이콘은 Android adaptive safe zone 밖까지 차지하므로 그대로 foreground로 쓰지 않습니다. 전용 투명 foreground 승인 후 설정해야 합니다.",
    );
  } else {
    validatePng({
      filePath: resolveAppAsset(appDirectory, adaptiveIcon.foregroundImage),
      name: "ANDROID_ADAPTIVE_ICON",
      requireOpaque: false,
      errors,
    });
    if (!/^#[0-9A-F]{6}$/i.test(adaptiveIcon.backgroundColor ?? "")) {
      addIssue(
        errors,
        "ANDROID_ADAPTIVE_BACKGROUND_INVALID",
        "android.adaptiveIcon.backgroundColor는 #RRGGBB 형식이어야 합니다.",
      );
    }
  }

  if (expo.ios?.supportsTablet === true) {
    addIssue(
      warnings,
      "IPAD_QA_REQUIRED",
      "iPad 지원이 켜져 있습니다. 제출 전 iPad 레이아웃과 스크린샷을 실기기 또는 정확한 Simulator에서 별도 검증해야 합니다.",
    );
  }
  if (!expo.extra?.eas?.projectId) {
    addIssue(
      warnings,
      "EAS_PROJECT_NOT_LINKED",
      "외부 Expo 계정 작업인 eas init은 실행하지 않았습니다. 첫 서명 빌드 전에 정확한 EAS projectId를 연결해야 합니다.",
    );
  }

  const dynamicConfigPath = path.join(appDirectory, "app.config.js");
  if (!existsSync(dynamicConfigPath)) {
    addIssue(errors, "MOBILE_DYNAMIC_CONFIG_MISSING", "PRELAUNCH에서 결제용 native 설정을 제외할 app.config.js가 필요합니다.");
    return;
  }
  const dynamicConfig = require(dynamicConfigPath);
  if (typeof dynamicConfig.pluginsForCommerceCapability !== "function") {
    addIssue(errors, "MOBILE_COMMERCE_PLUGIN_GATE_MISSING", "app.config.js가 commerce capability별 native plugin 경계를 제공하지 않습니다.");
    return;
  }
  const capability = environment.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim();
  const effectivePlugins = dynamicConfig.pluginsForCommerceCapability(expo.plugins, capability);
  const hasPortOnePlugin = effectivePlugins.some((plugin) => (
    Array.isArray(plugin) ? plugin[0] : plugin
  ) === PORTONE_CONFIG_PLUGIN);
  if (capability === "LIVE" ? !hasPortOnePlugin : hasPortOnePlugin) {
    addIssue(
      errors,
      "MOBILE_COMMERCE_PLUGIN_BOUNDARY_INVALID",
      capability === "LIVE"
        ? "LIVE 빌드는 PortOne native config plugin을 포함해야 합니다."
        : "PRELAUNCH 또는 미설정 빌드는 PortOne native config plugin을 포함하면 안 됩니다.",
    );
  }
}

function validateEasConfiguration(rootDir, errors) {
  const eas = readJson(path.join(rootDir, "apps/mobile/eas.json"), errors, "EAS_CONFIG");
  if (!eas) return;
  if (eas.cli?.appVersionSource !== "local") {
    addIssue(errors, "EAS_VERSION_SOURCE_INVALID", "명시한 app.json 버전을 쓰도록 cli.appVersionSource는 local이어야 합니다.");
  }
  if (eas.cli?.requireCommit !== true) {
    addIssue(errors, "EAS_COMMIT_REQUIRED", "서명 빌드는 재현 가능한 Git 스냅샷만 사용하도록 cli.requireCommit을 켜야 합니다.");
  }

  const preview = eas.build?.preview;
  if (!preview || preview.distribution !== "internal") {
    addIssue(errors, "EAS_PREVIEW_INVALID", "preview 프로필은 internal distribution이어야 합니다.");
  }
  if (preview?.developmentClient === true) {
    addIssue(errors, "EAS_PREVIEW_DEV_CLIENT", "preview 빌드에는 개발 클라이언트를 포함하면 안 됩니다.");
  }

  const pgReview = eas.build?.["pg-review"];
  if (
    !pgReview
    || pgReview.distribution !== "internal"
    || pgReview.developmentClient === true
    || pgReview.env?.EXPO_PUBLIC_COMMERCE_CAPABILITY !== "LIVE"
  ) {
    addIssue(
      errors,
      "EAS_PG_REVIEW_PROFILE_INVALID",
      "pg-review는 테스트 PG 결제창 캡처 전용 internal 빌드이며 commerce capability는 LIVE여야 합니다.",
    );
  }

  for (const [profileName, capability] of [["production-prelaunch", "PRELAUNCH"], ["production-live", "LIVE"]]) {
    const production = eas.build?.[profileName];
    if (!production || typeof production !== "object" || Array.isArray(production)) {
      addIssue(errors, "EAS_PRODUCTION_PROFILE_MISSING", `${profileName} 빌드 프로필이 필요합니다.`);
      continue;
    }
    if (
      production.distribution === "internal"
      || production.developmentClient === true
      || production.ios?.simulator === true
      || production.android?.buildType === "apk"
    ) {
      addIssue(errors, "EAS_PRODUCTION_NOT_STORE_BUILD", `${profileName}은 스토어 제출용 iOS/AAB 빌드여야 합니다.`);
    }
    if (production.env?.EXPO_PUBLIC_COMMERCE_CAPABILITY !== capability) {
      addIssue(errors, "EAS_COMMERCE_CAPABILITY_INVALID", `${profileName}의 commerce capability는 ${capability}여야 합니다.`);
    }
    if (FORBIDDEN_PRODUCTION_MARKERS.test(JSON.stringify(production))) {
      addIssue(errors, "EAS_PRODUCTION_TEST_MARKER", `${profileName}에 개발·데모·가짜 결제 설정이 포함돼 있습니다.`);
    }
  }
}

function validateSourceGates(rootDir, errors) {
  for (const gate of SOURCE_GATES) {
    const filePath = path.join(rootDir, gate.relativePath);
    if (!existsSync(filePath)) {
      addIssue(errors, "PRODUCTION_GATE_SOURCE_MISSING", `${gate.relativePath}: ${gate.description}.`);
      continue;
    }
    const source = readFileSync(filePath, "utf8");
    if (gate.required.some((pattern) => !pattern.test(source))) {
      addIssue(errors, "PRODUCTION_GATE_REMOVED", `${gate.relativePath}: ${gate.description}.`);
    }
  }
  const previewRoute = path.join(rootDir, "apps/mobile/app/draw/preview/[productId].tsx");
  const checkoutSource = readFileSync(
    path.join(rootDir, "apps/mobile/src/features/checkout/CheckoutScreen.tsx"),
    "utf8",
  );
  if (existsSync(previewRoute) || /\/draw\/preview|openGachaPreview|buildGachaPreviewParams/.test(checkoutSource)) {
    addIssue(errors, "PRODUCTION_PREVIEW_ROUTE_PRESENT", "개발용 뽑기 preview 경로는 production 앱 라우터와 결제 화면에서 제거되어야 합니다.");
  }
}

function validateEnvironmentExample(rootDir, errors) {
  const examplePath = path.join(rootDir, "apps/mobile/.env.example");
  if (!existsSync(examplePath)) {
    addIssue(errors, "MOBILE_ENV_EXAMPLE_MISSING", "apps/mobile/.env.example 파일이 없습니다.");
    return;
  }
  const source = readFileSync(examplePath, "utf8");
  for (const variable of REQUIRED_PUBLIC_BUILD_VARIABLES) {
    if (!new RegExp(`^${variable}=`, "m").test(source)) {
      addIssue(errors, `ENV_EXAMPLE_${variable}_MISSING`, `${variable} 예시 키가 선언되지 않았습니다.`);
    }
  }
}

function validateLiveLegalDocuments(rootDir, environment, errors) {
  if (environment.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim() !== "LIVE") return;

  for (const relativePath of [
    "public/legal/terms/index.html",
    "public/legal/privacy/index.html",
  ]) {
    const filePath = path.join(rootDir, relativePath);
    if (!existsSync(filePath)) {
      addIssue(errors, "LIVE_LEGAL_DOCUMENT_MISSING", `${relativePath} 공개 문서가 없습니다.`);
      continue;
    }
    if (PRELAUNCH_LEGAL_MARKERS.test(readFileSync(filePath, "utf8"))) {
      addIssue(
        errors,
        "LIVE_LEGAL_DOCUMENTS_PRELAUNCH_COPY",
        "결제 포함 공개 빌드 전에 이용약관·개인정보처리방침의 사전오픈·결제 미제공 문구를 실제 PG·배송 계약 기준으로 갱신해야 합니다.",
      );
      break;
    }
  }
}

const LEGAL_BUSINESS_PHONE_DOCUMENTS = Object.freeze([
  "public/legal/terms/index.html",
  "public/legal/privacy/index.html",
]);

function validateLegalBusinessPhone(rootDir, phone, errors) {
  for (const relativePath of LEGAL_BUSINESS_PHONE_DOCUMENTS) {
    const filePath = path.join(rootDir, relativePath);
    if (!existsSync(filePath)) {
      addIssue(errors, "LEGAL_BUSINESS_PHONE_DOCUMENT_MISSING", `${relativePath} 공개 문서가 없습니다.`);
      continue;
    }
    const html = readFileSync(filePath, "utf8");
    const links = [...html.matchAll(/<a\s[^>]*href="tel:([^"]*)"[^>]*>([^<]*)<\/a>/gi)];
    const published = links.flatMap(([, href, label]) => [href, label].map((value) => value.replace(/\D/g, "")));
    if (published.length === 0 || published.some((value) => value !== phone)) {
      addIssue(
        errors,
        "LEGAL_BUSINESS_PHONE_MISMATCH",
        `${relativePath}의 사업자 대표전화가 앱 내 사업자 정보와 일치해야 합니다.`,
      );
    }
  }
}

/**
 * A mobile-number representative phone blocks every full release check,
 * including the PRELAUNCH store-build and submit profile. Only the
 * structure-only check (no environment, no artifact) may report it as a warning.
 */
export function representativePhoneMustBeLandline({ structureOnly = false, pgReview = false } = {}) {
  return pgReview || !structureOnly;
}

export function validateCardReviewBusinessPhone(rootDir, errors, warnings, strict) {
  const businessInfoPath = path.join(
    rootDir,
    "apps/mobile/src/features/profile/business-information.ts",
  );
  if (!existsSync(businessInfoPath)) {
    addIssue(
      errors,
      "PG_REVIEW_BUSINESS_INFO_MISSING",
      "카드사 심사에 필요한 앱 내 사업자 정보 원본이 없습니다.",
    );
    return;
  }
  const source = readFileSync(businessInfoPath, "utf8");
  const phone = source.match(/representativePhone:\s*"([^"]+)"/)?.[1]?.replace(/\D/g, "") ?? "";
  if (!phone) {
    addIssue(
      errors,
      "PG_REVIEW_BUSINESS_PHONE_MISSING",
      "카드사 심사용 사업자 대표전화가 앱에 표시되어야 합니다.",
    );
    return;
  }
  if (/^01(?:0|1|6|7|8|9)/.test(phone)) {
    addIssue(
      strict ? errors : warnings,
      "PG_REVIEW_BUSINESS_PHONE_MOBILE",
      "PG·카드사 심사용 대표전화는 휴대폰 번호가 아닌 사업자 유선 또는 대표번호로 교체해야 합니다.",
    );
  }
  validateLegalBusinessPhone(rootDir, phone, errors);
}

function validateHttpsEnvironment(environment, errors, options = {}) {
  const commerceCapability = environment.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim();
  const requiredVariables = options.requiredVariables ?? (commerceCapability === "LIVE"
    ? [...REQUIRED_PUBLIC_BUILD_VARIABLES, ...LIVE_PUBLIC_BUILD_VARIABLES]
    : REQUIRED_PUBLIC_BUILD_VARIABLES);
  const requiredHttpsVariables = options.requiredHttpsVariables ?? REQUIRED_HTTPS_VARIABLES;
  for (const variable of requiredVariables) {
    if (!environment[variable]?.trim()) {
      addIssue(errors, `ENV_${variable}_MISSING`, `${variable} 운영 값이 필요합니다.`);
    }
  }

  for (const variable of requiredHttpsVariables) {
    const rawValue = environment[variable]?.trim();
    if (!rawValue) continue;
    try {
      const value = new URL(rawValue);
      if (
        value.protocol !== "https:"
        || !value.hostname
        || value.username
        || value.password
        || value.search
        || value.hash
        || PLACEHOLDER_HOST.test(value.hostname)
      ) throw new Error("invalid public HTTPS URL");
    } catch {
      addIssue(errors, `ENV_${variable}_INVALID`, `${variable}은 자격증명·쿼리 없는 실제 HTTPS 공개 주소여야 합니다.`);
    }
  }

  const publishableKey = environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (publishableKey && (
    publishableKey.length < 20
    || /service[_-]?role|sb_secret_|supabase_service_role|placeholder|replace[_-]?me/i.test(publishableKey)
  )) {
    addIssue(
      errors,
      "ENV_EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY_PRIVILEGED",
      "모바일 빌드에는 Supabase publishable/legacy anon key만 허용되며 secret/service-role key는 금지됩니다.",
    );
  }
  for (const variable of ["EXPO_PUBLIC_PORTONE_STORE_ID", "EXPO_PUBLIC_PORTONE_CHANNEL_KEY"]) {
    const value = environment[variable]?.trim();
    if (value && (value.length < 6 || value.length > 200 || /placeholder|replace[_-]?me|your-/i.test(value))) {
      addIssue(errors, `ENV_${variable}_INVALID`, `${variable}에 실제 PortOne 운영 값을 설정해야 합니다.`);
    }
  }
}

function validateProductionApiHost(environment, errors) {
  const rawValue = environment.EXPO_PUBLIC_DABBOBA_API_URL?.trim();
  if (!rawValue) return;
  if (!isApprovedProductionApiUrl(rawValue)) {
    addIssue(
      errors,
      "ENV_EXPO_PUBLIC_DABBOBA_API_URL_HOST_NOT_APPROVED",
      `운영 빌드의 EXPO_PUBLIC_DABBOBA_API_URL 호스트는 ${APPROVED_PRODUCTION_API_HOSTS.join(", ")} 중 하나여야 합니다.`,
    );
  }
}

function validateCheckoutPaymentSource(rootDir, errors) {
  const connectionRoutePath = path.join(rootDir, "apps/mobile/app/checkout/connect/[productId].tsx");
  const checkoutScreenPath = path.join(
    rootDir,
    "apps/mobile/src/features/checkout/CheckoutScreen.tsx",
  );
  const paymentScreenPath = path.join(
    rootDir,
    "apps/mobile/src/features/checkout/PortOnePaymentScreen.tsx",
  );
  const connectionSource = existsSync(connectionRoutePath)
    ? readFileSync(connectionRoutePath, "utf8")
    : "";
  const checkoutSource = existsSync(checkoutScreenPath)
    ? readFileSync(checkoutScreenPath, "utf8")
    : "";
  const paymentSource = existsSync(paymentScreenPath)
    ? readFileSync(paymentScreenPath, "utf8")
    : "";

  if (!/Redirect href="\/"/.test(connectionSource) || /CheckoutConnectionScreen/.test(connectionSource)) {
    addIssue(
      errors,
      "PAYMENT_CONNECTION_PLACEHOLDER_PRESENT",
      "기존 결제 연결 안내 경로가 공개 production에서 비활성화되지 않았습니다.",
    );
  }
  if (
    !/EXPO_PUBLIC_PORTONE_STORE_ID/.test(checkoutSource)
    || !/EXPO_PUBLIC_PORTONE_CHANNEL_KEY/.test(checkoutSource)
    || !/openLivePayment/.test(checkoutSource)
    || !/@portone\/react-native-sdk/.test(paymentSource)
    || !/confirmPortOnePayment/.test(paymentSource)
    || !/await fetchCheckoutOrder/.test(paymentSource)
  ) {
    addIssue(
      errors,
      "CHECKOUT_PAYMENT_PLACEHOLDER_PRESENT",
      "구매 화면의 PortOne 결제 왕복 또는 서버 재검증 경로가 누락됐습니다.",
    );
  }
}

function validatePgReviewEnvironment(rootDir, environment, errors) {
  validateHttpsEnvironment(environment, errors, {
    requiredVariables: PG_REVIEW_PUBLIC_BUILD_VARIABLES,
    requiredHttpsVariables: [
      "EXPO_PUBLIC_DABBOBA_API_URL",
      "EXPO_PUBLIC_SUPABASE_URL",
    ],
  });
  if (environment.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim() !== "LIVE") {
    addIssue(
      errors,
      "PG_REVIEW_COMMERCE_LIVE_REQUIRED",
      "PG 심사용 내부 빌드는 결제창을 열 수 있도록 EXPO_PUBLIC_COMMERCE_CAPABILITY=LIVE여야 합니다.",
    );
  }
  validateCheckoutPaymentSource(rootDir, errors);
}

function validateProductionPaymentBoundary(rootDir, environment, errors) {
  const mobileMode = environment.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim();
  const serverMode = environment.DABBOBA_COMMERCE_MODE?.trim();
  const paymentProvider = environment.PAYMENT_PROVIDER?.trim();

  if (mobileMode === "PRELAUNCH") {
    if (serverMode !== "PRELAUNCH") {
      addIssue(errors, "SERVER_COMMERCE_PRELAUNCH_REQUIRED", "사전오픈 서버에는 DABBOBA_COMMERCE_MODE=PRELAUNCH가 필요합니다.");
    }
    if (paymentProvider !== "UNCONFIGURED") {
      addIssue(errors, "PRELAUNCH_PAYMENT_PROVIDER_MUST_BE_UNCONFIGURED", "사전오픈 서버는 PAYMENT_PROVIDER=UNCONFIGURED여야 합니다.");
    }
    for (const variable of LIVE_PUBLIC_BUILD_VARIABLES) {
      if (environment[variable]?.trim()) {
        addIssue(errors, `PRELAUNCH_${variable}_FORBIDDEN`, `사전오픈 빌드에는 ${variable} 값을 포함하지 않습니다.`);
      }
    }
    return;
  }

  if (mobileMode !== "LIVE") {
    addIssue(errors, "MOBILE_COMMERCE_MODE_INVALID", "EXPO_PUBLIC_COMMERCE_CAPABILITY는 PRELAUNCH 또는 LIVE여야 합니다.");
  }
  if (serverMode !== "LIVE") {
    addIssue(
      errors,
      "SERVER_COMMERCE_LIVE_REQUIRED",
      "공개 production 서버에는 DABBOBA_COMMERCE_MODE=LIVE가 필요합니다.",
    );
  }
  if (mobileMode !== "LIVE") {
    addIssue(
      errors,
      "MOBILE_COMMERCE_LIVE_REQUIRED",
      "결제 포함 공개 빌드에는 EXPO_PUBLIC_COMMERCE_CAPABILITY=LIVE가 필요합니다.",
    );
  }
  if (!paymentProvider) {
    addIssue(
      errors,
      "PAYMENT_PROVIDER_MISSING",
      "공개 production 후보에는 실제 서버의 PAYMENT_PROVIDER 상태가 필요합니다.",
    );
  } else if (paymentProvider !== "PORTONE_V2_INICIS") {
    addIssue(
      errors,
      "PAYMENT_PROVIDER_NOT_READY",
      "PortOne V2 → KG이니시스가 검증되기 전의 PAYMENT_PROVIDER는 공개 production 준비로 인정하지 않습니다.",
    );
  }

  validateCheckoutPaymentSource(rootDir, errors);
  if (environment.PORTONE_CHANNEL_ENVIRONMENT?.trim() !== "LIVE") {
    addIssue(
      errors,
      "PORTONE_LIVE_CHANNEL_REQUIRED",
      "공개 production에는 PORTONE_CHANNEL_ENVIRONMENT=LIVE가 필요합니다.",
    );
  }
}

export function inspectMobileReleaseConfig({
  rootDir,
  environment = process.env,
  structureOnly = false,
  pgReview = false,
} = {}) {
  const resolvedRoot = path.resolve(rootDir ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const errors = [];
  const warnings = [];
  validateAppConfiguration(resolvedRoot, environment, errors, warnings, structureOnly);
  validateEasConfiguration(resolvedRoot, errors);
  validateSourceGates(resolvedRoot, errors);
  validateEnvironmentExample(resolvedRoot, errors);
  validateCardReviewBusinessPhone(
    resolvedRoot,
    errors,
    warnings,
    representativePhoneMustBeLandline({ structureOnly, pgReview }),
  );
  if (pgReview) {
    validatePgReviewEnvironment(resolvedRoot, environment, errors);
  } else if (!structureOnly) {
    validateHttpsEnvironment(environment, errors);
    validateProductionApiHost(environment, errors);
    validateLiveLegalDocuments(resolvedRoot, environment, errors);
    validateProductionPaymentBoundary(resolvedRoot, environment, errors);
  }
  return { errors, warnings };
}

function printReport(report, { structureOnly, pgReview }) {
  for (const warning of report.warnings) console.warn(`WARN [${warning.code}] ${warning.message}`);
  for (const error of report.errors) console.error(`ERROR [${error.code}] ${error.message}`);
  if (report.errors.length === 0) {
    console.log(
      pgReview
        ? "Mobile PG-review configuration check passed. Test-channel server state and signed artifact still require external verification."
        : structureOnly
          ? "Mobile release structure check passed. External accounts and signed artifacts were not verified."
          : "Mobile production release configuration check passed. Signed artifacts and store submission still require external verification.",
    );
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const unknownArguments = process.argv
    .slice(2)
    .filter((argument) => argument !== "--" && argument !== "--structure-only" && argument !== "--pg-review");
  const structureOnly = process.argv.includes("--structure-only");
  const pgReview = process.argv.includes("--pg-review");
  if (unknownArguments.length > 0) {
    console.error(`Unknown arguments: ${unknownArguments.join(", ")}`);
    process.exitCode = 2;
  } else if (structureOnly && pgReview) {
    console.error("--structure-only and --pg-review cannot be used together.");
    process.exitCode = 2;
  } else {
    const report = inspectMobileReleaseConfig({ structureOnly, pgReview });
    printReport(report, { structureOnly, pgReview });
    if (report.errors.length > 0) process.exitCode = 1;
  }
}
