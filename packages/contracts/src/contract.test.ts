import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { components, paths } from "./generated.js";

test("generated contract includes public and privileged seams", () => {
  const requiredPaths: Array<keyof paths> = [
    "/readyz",
    "/v1/auth/me",
    "/v1/notices",
    "/v1/inquiries",
    "/v1/media/uploads",
    "/v1/media/{mediaId}",
    "/v1/account/profile",
    "/v1/account/deletion-request",
    "/v1/account/draw-entitlements",
    "/v1/account/notification-preferences",
    "/v1/account/point-returns",
    "/v1/account/shipping-requests",
    "/v1/account/shipping-requests/{shippingRequestId}",
    "/v1/catalog/characters",
    "/v1/catalog/products/{productId}/draw-odds",
    "/v1/community/blocks",
    "/v1/community/posts/{postId}/like",
    "/v1/wanted-requests",
    "/v1/wanted-requests/{requestId}/like",
    "/v1/exchange/listings",
    "/v1/orders",
    "/v1/admin/dashboard",
    "/v1/admin/account-deletions",
    "/v1/admin/commerce/orders",
    "/v1/admin/commerce/refund-reviews/{paymentId}",
    "/v1/admin/commerce/inventory/{productId}/adjustments",
    "/v1/admin/commerce/shipping/{shippingRequestId}/status",
    "/v1/admin/exchange/listings",
    "/v1/admin/products/{productId}/draw-versions",
    "/v1/admin/reports/{reportId}/resolution",
    "/v1/admin/audit-logs",
  ];
  assert.equal(requiredPaths.length, 31);
});

test("generic admin user status contract excludes account deletion", () => {
  type ChangeUserStatus = components["schemas"]["ChangeUserStatusInput"]["status"];
  type DeletedIsExcluded = "DELETED" extends ChangeUserStatus ? false : true;
  const manageableStatuses = ["ACTIVE", "SUSPENDED", "BANNED"] as const satisfies readonly ChangeUserStatus[];
  const deletedIsExcluded: DeletedIsExcluded = true;
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const contractDocument = readFileSync(
    `${repositoryRoot}packages/contracts/openapi/dabboba.openapi.yaml`,
    "utf8",
  );
  const schemaStart = contractDocument.indexOf("    ChangeUserStatusInput:\n");
  const schemaEnd = contractDocument.indexOf("    CreateAdministratorInput:\n", schemaStart);
  const schema = contractDocument.slice(schemaStart, schemaEnd);

  assert.deepEqual(manageableStatuses, ["ACTIVE", "SUSPENDED", "BANNED"]);
  assert.equal(deletedIsExcluded, true);
  assert.match(schema, /status: \{ type: string, enum: \[ACTIVE, SUSPENDED, BANNED\] \}/);
  assert.doesNotMatch(schema, /DELETED/);
});

test("generated media contract requires idempotency and exposes delete and expired-intent semantics", () => {
  const expired = {
    error: {
      code: "MEDIA_UPLOAD_INTENT_EXPIRED",
      message: "업로드 요청이 만료되었습니다. 새로 업로드해 주세요.",
      requestId: "request-1",
    },
  } satisfies components["schemas"]["MediaUploadIntentExpiredErrorEnvelope"];
  const deleteMethod: keyof paths["/v1/media/{mediaId}"] = "delete";
  const intentHeaders = {
    "Idempotency-Key": "media-intent-key-0001",
  } satisfies paths["/v1/media/uploads"]["post"]["parameters"]["header"];
  const completeHeaders = {
    "Idempotency-Key": "media-complete-key-0001",
  } satisfies paths["/v1/media/{mediaId}/complete"]["post"]["parameters"]["header"];
  const deleteHeaders = {
    "Idempotency-Key": "media-delete-key-0001",
  } satisfies paths["/v1/media/{mediaId}"]["delete"]["parameters"]["header"];
  const expiredResponse: keyof paths["/v1/media/{mediaId}/complete"]["post"]["responses"] = 410;
  const deletedResponse: keyof paths["/v1/media/{mediaId}"]["delete"]["responses"] = 204;
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const contractDocument = readFileSync(
    `${repositoryRoot}packages/contracts/openapi/dabboba.openapi.yaml`,
    "utf8",
  );
  const mediaStart = contractDocument.indexOf("  /v1/media/uploads:\n");
  const mediaEnd = contractDocument.indexOf("  /v1/inquiries:\n", mediaStart);
  const mediaContract = contractDocument.slice(mediaStart, mediaEnd);

  assert.equal(expired.error.code, "MEDIA_UPLOAD_INTENT_EXPIRED");
  assert.equal(deleteMethod, "delete");
  assert.equal(intentHeaders["Idempotency-Key"], "media-intent-key-0001");
  assert.equal(completeHeaders["Idempotency-Key"], "media-complete-key-0001");
  assert.equal(deleteHeaders["Idempotency-Key"], "media-delete-key-0001");
  assert.equal(expiredResponse, 410);
  assert.equal(deletedResponse, 204);
  assert.match(mediaContract, /operationId: createMediaUploadIntent[\s\S]*?#\/components\/parameters\/IdempotencyKey/);
  assert.match(mediaContract, /operationId: completeMediaUpload[\s\S]*?#\/components\/parameters\/IdempotencyKey[\s\S]*?"410"/);
  assert.match(mediaContract, /operationId: deleteOwnUnattachedMedia[\s\S]*?#\/components\/parameters\/IdempotencyKey[\s\S]*?"204"/);
});

test("generated notification preference contract keeps required alerts immutable and optional consent exact", () => {
  const preferences = {
    orderUpdates: true,
    exchangeUpdates: true,
    requestUpdates: true,
    restockUpdates: false,
    marketingSms: false,
    marketingEmail: false,
    marketingPush: false,
    personalizedRecommendations: false,
    version: 1,
    updatedAt: "2026-08-25T03:00:00.000Z",
  } satisfies components["schemas"]["NotificationPreferences"];
  const update = {
    exchangeUpdates: false,
    requestUpdates: false,
    restockUpdates: true,
    marketingSms: false,
    marketingEmail: false,
    marketingPush: true,
    personalizedRecommendations: true,
    expectedVersion: 1,
  } satisfies components["schemas"]["UpdateNotificationPreferencesInput"];

  assert.equal(preferences.orderUpdates, true);
  assert.equal(Object.hasOwn(update, "orderUpdates"), false);
  assert.equal(Object.keys(update).length, 8);
});

test("generated account draw entitlement contract preserves resumable paid-ticket fields", () => {
  const entitlement = {
    id: "11111111-1111-4111-8111-111111111111",
    orderId: "22222222-2222-4222-8222-222222222222",
    orderLineId: "33333333-3333-4333-8333-333333333333",
    product: {
      id: "draw-product",
      name: "복원 추첨 상품",
      category: "gacha",
      imageUrl: null,
    },
    probabilityVersion: 7,
    status: "AVAILABLE",
    createdAt: "2026-08-25T03:00:00.000Z",
    consumedAt: null,
  } satisfies components["schemas"]["AccountDrawEntitlement"];

  assert.equal(entitlement.status, "AVAILABLE");
  assert.deepEqual(Object.keys(entitlement).sort(), [
    "consumedAt",
    "createdAt",
    "id",
    "orderId",
    "orderLineId",
    "probabilityVersion",
    "product",
    "status",
  ]);
});

test("generated account shipping contract includes terminal delivery state and exact detail fields", () => {
  const shippingRequest = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "DELIVERED",
    version: 4,
    inventoryUnitIds: ["22222222-2222-4222-8222-222222222222"],
    destination: {
      recipientMasked: "홍*동",
      phoneMasked: "010-****-5678",
      postalCode: "01234",
      addressLine1: "서울특별시 테스트로 1",
      addressLine2: null,
    },
    requestedAt: "2026-08-25T01:00:00.000Z",
    updatedAt: "2026-08-25T02:00:00.000Z",
    shippedAt: "2026-08-25T01:30:00.000Z",
    trackingCarrier: "TEST",
    trackingNumber: "1234567890",
  } satisfies components["schemas"]["AccountShippingRequest"];
  const deliveredInventoryStatus: components["schemas"]["InventoryUnit"]["status"] = "DELIVERED";

  assert.equal(shippingRequest.status, "DELIVERED");
  assert.equal(deliveredInventoryStatus, "DELIVERED");
  assert.deepEqual(Object.keys(shippingRequest).sort(), [
    "destination",
    "id",
    "inventoryUnitIds",
    "requestedAt",
    "shippedAt",
    "status",
    "trackingCarrier",
    "trackingNumber",
    "updatedAt",
    "version",
  ]);
});

test("generated point return contract is batch-idempotent and exposes the committed balance", () => {
  const inventoryUnitIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const input = { inventoryUnitIds } satisfies components["schemas"]["CreatePointReturnInput"];
  const result = {
    id: "33333333-3333-4333-8333-333333333333",
    inventoryUnitIds,
    totalPointAmount: 5_999,
    balance: 7_599,
    returnedAt: "2026-08-30T01:00:00.000Z",
  } satisfies components["schemas"]["PointReturnResult"];
  const headers = {
    "Idempotency-Key": "point-return-request-0001",
  } satisfies paths["/v1/account/point-returns"]["post"]["parameters"]["header"];
  const returnedInventoryStatus: components["schemas"]["InventoryUnit"]["status"] = "POINT_RETURNED";
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const contractDocument = readFileSync(
    `${repositoryRoot}packages/contracts/openapi/dabboba.openapi.yaml`,
    "utf8",
  );
  const schemaStart = contractDocument.indexOf("    CreatePointReturnInput:\n");
  const schemaEnd = contractDocument.indexOf("    NotificationPreferences:\n", schemaStart);
  const pointReturnSchemas = contractDocument.slice(schemaStart, schemaEnd);

  assert.deepEqual(input.inventoryUnitIds, inventoryUnitIds);
  assert.equal(result.totalPointAmount, 5_999);
  assert.equal(headers["Idempotency-Key"], "point-return-request-0001");
  assert.equal(returnedInventoryStatus, "POINT_RETURNED");
  assert.match(pointReturnSchemas, /totalPointAmount: \{ type: integer, minimum: 1, maximum: 2147483647 \}/);
  assert.match(pointReturnSchemas, /balance: \{ type: integer, minimum: 0, maximum: 2147483647 \}/);
});

test("exchange proposal contract accepts only one owned inventory selection and no free text", () => {
  type OfferInput = components["schemas"]["CreateExchangeOfferInput"];
  type HasNoMessage = "message" extends keyof OfferInput ? false : true;
  const input = {
    offeredInventoryUnitId: "11111111-1111-4111-8111-111111111111",
  } satisfies OfferInput;
  const hasNoMessage: HasNoMessage = true;

  assert.equal(input.offeredInventoryUnitId, "11111111-1111-4111-8111-111111111111");
  assert.equal(hasNoMessage, true);
});

const routeMethods = ["get", "post", "put", "patch", "delete"] as const;
const routeMethodPattern = routeMethods.join("|");
const routeLiteralPattern = new RegExp(
  `\\bapp\\.(${routeMethodPattern})\\s*\\(\\s*["'\`]([^"'\`]+)["'\`]`,
  "gs",
);
const routeCallPattern = new RegExp(`\\bapp\\.(${routeMethodPattern})\\s*\\(`, "g");

function normalizedRoute(method: string, path: string) {
  return `${method.toUpperCase()} ${path.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`;
}

function fastifyRoutes(modulesDirectory: string) {
  const routes: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.includes(".test.")) continue;
      const source = readFileSync(path, "utf8");
      assert.equal(
        (source.match(/\bapp\.route\s*\(/g) || []).length,
        0,
        `${entry.name} uses app.route(), which the contract parity extractor does not support`,
      );
      const literalRoutes = [...source.matchAll(routeLiteralPattern)];
      const routeCalls = [...source.matchAll(routeCallPattern)];
      assert.equal(
        literalRoutes.length,
        routeCalls.length,
        `${entry.name} contains a non-literal Fastify route path`,
      );
      routes.push(...literalRoutes.map((match) => normalizedRoute(match[1]!, match[2]!)));
    }
  };
  visit(modulesDirectory);
  return routes;
}

function openApiRoutes(document: string) {
  const pathsStart = document.indexOf("\npaths:\n");
  const componentsStart = document.indexOf("\ncomponents:\n");
  assert.notEqual(pathsStart, -1, "OpenAPI document is missing paths");
  assert.ok(componentsStart > pathsStart, "OpenAPI components must follow paths");

  const routes: string[] = [];
  let currentPath: string | undefined;
  for (const line of document.slice(pathsStart + "\npaths:\n".length, componentsStart).split("\n")) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1]!;
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (currentPath && methodMatch) routes.push(normalizedRoute(methodMatch[1]!, currentPath));
  }
  return routes;
}

test("OpenAPI path and method set exactly matches registered Fastify routes", () => {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const serverRoutes = fastifyRoutes(`${repositoryRoot}apps/api/src/modules`);
  const contractDocument = readFileSync(
    `${repositoryRoot}packages/contracts/openapi/dabboba.openapi.yaml`,
    "utf8",
  );
  const contractRoutes = openApiRoutes(contractDocument);
  const operationIds = [...contractDocument.matchAll(/^      operationId: (\S+)$/gm)].map((match) => match[1]!);

  assert.equal(new Set(serverRoutes).size, serverRoutes.length, "Fastify route registrations must be unique");
  assert.equal(new Set(contractRoutes).size, contractRoutes.length, "OpenAPI operations must be unique");
  assert.equal(operationIds.length, contractRoutes.length, "Every OpenAPI operation must have an operationId");
  assert.equal(new Set(operationIds).size, operationIds.length, "OpenAPI operationIds must be unique");
  assert.deepEqual(contractRoutes.sort(), serverRoutes.sort());
});
