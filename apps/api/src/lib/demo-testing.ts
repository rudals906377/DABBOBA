import type { ApiConfig } from "@dabboba/config";
import { isLoopbackHostname } from "@dabboba/config";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { forbidden, notFound } from "./errors.js";

export const DEMO_PROFILE = "supabase-demo";
export const DEMO_FIXTURE_TAG = "supabase-demo-v1";
export const DEMO_IP_ID = "demo-test-ip";
export const CUSTOMER_CATALOG_GENERATION = "product-photos-2026-09-10";
export const DEMO_CATALOG_GACHA_PRODUCT_IDS = Object.freeze([
  "gacha-demon-slayer-onemutan-13",
  "gacha-demon-slayer-mejirushi-2",
  "gacha-demon-slayer-mejirushi-3",
  "gacha-my-hero-academia-villains",
  "gacha-chainsaw-man-reze-2",
  "gacha-powerpuff-together",
  "gacha-haikyu-mascot-keyholder",
  "gacha-haikyu-middle-school-2",
  "gacha-demon-slayer-petatto-2",
  "gacha-demon-slayer-petatto-3",
  "gacha-death-note-collection-rich",
  "gacha-apothecary-mugyutto",
  "gacha-sylvanian-adventure",
  "gacha-hatsune-miku-petadoll",
]);
export const DEMO_CATALOG_KUJI_PRODUCT_IDS = Object.freeze([
  "kuji-sylvanian-adventure",
]);
export const DEMO_GACHA_PRODUCT_ID = DEMO_CATALOG_GACHA_PRODUCT_IDS[0]!;
export const DEMO_KUJI_PRODUCT_ID = "demo-test-kuji";
export const DEMO_GACHA_PRIZE_PRODUCT_IDS = Object.freeze([
  "demo-test-gacha-prize-a",
  "demo-test-gacha-prize-b",
  "demo-test-gacha-prize-c",
  "demo-test-gacha-prize-d",
  "demo-test-gacha-prize-e",
]);
export const DEMO_KUJI_PRIZE_PRODUCT_IDS = Object.freeze([
  "demo-test-kuji-prize-a",
  "demo-test-kuji-prize-b",
  "demo-test-kuji-prize-c",
  "demo-test-kuji-prize-d",
  "demo-test-kuji-prize-e",
]);
export const DEMO_PRIZE_PRODUCT_IDS = Object.freeze([
  ...DEMO_GACHA_PRIZE_PRODUCT_IDS,
  ...DEMO_KUJI_PRIZE_PRODUCT_IDS,
]);
export const DEMO_SELLER_PRODUCT_IDS = Object.freeze([
  ...DEMO_CATALOG_GACHA_PRODUCT_IDS,
  ...DEMO_CATALOG_KUJI_PRODUCT_IDS,
]);
export const DEMO_PRODUCT_IDS = Object.freeze([
  ...DEMO_SELLER_PRODUCT_IDS,
  ...DEMO_GACHA_PRIZE_PRODUCT_IDS,
  ...DEMO_KUJI_PRIZE_PRODUCT_IDS,
]);
export const INTERNAL_CUSTOMER_ACCOUNT = Object.freeze({
  id: "da000000-0000-4000-8000-00000000000a",
  email: "member01@dabboba.local",
});
export const DEMO_PAYMENT_ACTIONS = Object.freeze(["approve", "fail", "cancel", "refund"] as const);

export type DemoPaymentAction = (typeof DEMO_PAYMENT_ACTIONS)[number];
export type DemoRuntime = { enabled: boolean };

const FORWARDED_HEADERS = [
  "forwarded",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
] as const;

export function demoProfileRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DABBOBA_BACKEND_PROFILE === DEMO_PROFILE
    && env.DABBOBA_ENABLE_DEMO_TESTING === "true"
    && env.DABBOBA_DEMO_FIXTURE_TAG === DEMO_FIXTURE_TAG;
}

export function demoRuntimeFromEnvironment(
  env: NodeJS.ProcessEnv,
  config: ApiConfig,
): DemoRuntime {
  const requested = env.DABBOBA_BACKEND_PROFILE === DEMO_PROFILE
    || env.DABBOBA_ENABLE_DEMO_TESTING === "true";
  if (!requested) return { enabled: false };
  let database: URL;
  try { database = new URL(config.databaseUrl); }
  catch { throw new Error("Demo testing database configuration is invalid."); }
  const safeDatabaseUrl = ["postgres:", "postgresql:"].includes(database.protocol)
    && Boolean(database.password)
    && !database.search
    && !database.hash;
  const remoteApproved = config.environment === "production"
    && config.environmentTier === "STAGING"
    && database.port === "5432"
    && database.hostname.endsWith(".pooler.supabase.com")
    && decodeURIComponent(database.username) === "dabboba_runtime.yxkmvgfruphgghowzvmo"
    && database.pathname === "/postgres";
  const loopbackTest = config.environment === "test"
    && config.environmentTier === "TEST"
    && isLoopbackHostname(database.hostname);
  if (
    env.DABBOBA_BACKEND_PROFILE !== DEMO_PROFILE
    || env.DABBOBA_ENABLE_DEMO_TESTING !== "true"
    || env.DABBOBA_DEMO_FIXTURE_TAG !== DEMO_FIXTURE_TAG
    || config.paymentProvider !== "TEST_PG"
    || !config.paymentWebhookSecret
    || config.host !== "127.0.0.1"
    || !safeDatabaseUrl
    || (!remoteApproved && !loopbackTest)
  ) throw new Error("Demo testing configuration is incomplete or unsafe.");
  return { enabled: true };
}

export function assertDemoLoopbackRequest(request: FastifyRequest, runtime: DemoRuntime): void {
  if (!runtime.enabled) throw notFound();
  if (!isLoopbackHostname(request.ip)) throw notFound();
  for (const header of FORWARDED_HEADERS) {
    if (request.headers[header] !== undefined) throw notFound();
  }
}

export function isDemoAccount(input: { userId: string; email: string | null }): boolean {
  return INTERNAL_CUSTOMER_ACCOUNT.id === input.userId
    && INTERNAL_CUSTOMER_ACCOUNT.email === input.email;
}

export function assertDemoActor(input: { userId: string; email: string | null }): void {
  if (!isDemoAccount(input)) throw forbidden("허용된 내부 고객 계정만 이 동작을 사용할 수 있습니다.");
}

export function assertDemoOrderProducts(productIds: readonly string[]): void {
  if (!productIds.length || productIds.some((id) => !DEMO_SELLER_PRODUCT_IDS.includes(id as typeof DEMO_SELLER_PRODUCT_IDS[number]))) {
    throw forbidden("이 내부 환경에서 허용된 상품만 주문에 사용할 수 있습니다.");
  }
}

export function demoPaymentEventId(actorId: string, idempotencyKey: string): string {
  return `demo-${createHash("sha256").update(`${actorId}:${idempotencyKey}`).digest("hex")}`;
}
