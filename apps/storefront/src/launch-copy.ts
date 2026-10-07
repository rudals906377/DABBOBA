// The public site is static and its worker CSP allows only same-origin
// requests, so the storefront cannot read the API's commerce mode at runtime.
// The copy is chosen at build time from the Cloudflare Pages variable
// VITE_DABBOBA_COMMERCE_MODE. Anything other than exactly "LIVE" keeps the
// prelaunch copy (fail-closed). Set the variable only after the LIVE cutover
// succeeds and remove it on rollback (docs/live-cutover-runbook.md).
export type StorefrontCommerceMode = "LIVE" | "PRELAUNCH";

export function storefrontCommerceMode(value: unknown): StorefrontCommerceMode {
  return value === "LIVE" ? "LIVE" : "PRELAUNCH";
}

export type LaunchCopy = {
  heroStatus: string;
  finalNavLabel: string;
  gachaPreviewStatus: string;
  kujiPreviewStatus: string;
  storageIntro: string;
  closingTitle: string;
  closingBody: string;
  closingStatus: string;
};

export const LAUNCH_COPY: Readonly<Record<StorefrontCommerceMode, LaunchCopy>> = Object.freeze({
  PRELAUNCH: {
    heroStatus: "사전 오픈 준비 중",
    finalNavLabel: "사전 오픈 안내",
    gachaPreviewStatus: "오픈 준비 중",
    kujiPreviewStatus: "오픈 준비 중",
    storageIntro: "정식 오픈 후 적용 예정",
    closingTitle: "곧, 앱에서 만나요",
    closingBody: "상품 탐색과 관심 상품 저장부터 차근차근 시작할게요.",
    closingStatus: "PRELAUNCH",
  },
  // First launch sells gacha only; kuji stays "opening soon" until its own decision.
  LIVE: {
    heroStatus: "가챠 정식 오픈",
    finalNavLabel: "이용 안내",
    gachaPreviewStatus: "앱에서 만나요",
    kujiPreviewStatus: "오픈 준비 중",
    storageIntro: "보관·배송 기준",
    closingTitle: "지금, 앱에서 만나요",
    closingBody: "가챠를 뽑고 보관함에 모아 한 번에 받아요.",
    closingStatus: "NOW OPEN",
  },
});

export const STOREFRONT_MODE = storefrontCommerceMode(import.meta.env.VITE_DABBOBA_COMMERCE_MODE);
export const launchCopy: LaunchCopy = LAUNCH_COPY[STOREFRONT_MODE];
