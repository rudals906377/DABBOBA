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
    "/v1/account/basic-info",
    "/v1/account/inventory",
    "/v1/account/profile",
    "/v1/account/deletion-request",
    "/v1/account/draw-entitlements",
    "/v1/account/notification-preferences",
    "/v1/account/point-returns",
    "/v1/account/shipping-requests",
    "/v1/account/shipping-requests/{shippingRequestId}",
    "/v1/catalog/characters",
    "/v1/catalog/home-sections",
    "/v1/catalog/products/{productId}/draw-odds",
    "/v1/catalog/products/{productId}/kuji-slots",
    "/v1/community/blocks",
    "/v1/community/posts/{postId}/like",
    "/v1/wanted-requests",
    "/v1/wanted-requests/{requestId}/like",
    "/v1/exchange/listings",
    "/v1/kuji/rooms/{productId}/entries",
    "/v1/kuji/rooms/{productId}/entries/{entryId}",
    "/v1/kuji/rooms/{productId}/entries/{entryId}/slots",
    "/v1/orders",
    "/v1/orders/{orderId}/draw-recovery",
    "/v1/orders/{orderId}/kuji-selection",
    "/v1/orders/{orderId}/draw-completion",
    "/v1/admin/dashboard",
    "/v1/admin/account-deletions",
    "/v1/admin/commerce/orders",
    "/v1/admin/commerce/refund-reviews/{paymentId}",
    "/v1/admin/commerce/inventory/{productId}/adjustments",
    "/v1/admin/commerce/shipping/{shippingRequestId}/status",
    "/v1/admin/exchange/listings",
    "/v1/admin/home-sections",
    "/v1/admin/home-sections/{sectionId}",
    "/v1/admin/products/{productId}/draw-versions",
    "/v1/admin/reports/{reportId}/resolution",
    "/v1/admin/audit-logs",
  ];
  assert.equal(requiredPaths.length, 43);
});

test("generated gacha completion proof exposes immutable identities without prize or mutation data", () => {
  const proof: components["schemas"]["PaidGachaDrawCompletion"] = {
    orderId: "10000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000001",
    productId: "original-gacha", probabilityVersion: 3, serverNow: "2026-09-06T00:00:02.000Z",
    results: [{
      entitlementId: "30000000-0000-4000-8000-000000000001",
      resultId: "40000000-0000-4000-8000-000000000001", committedAt: "2026-09-06T00:00:01.000Z",
    }],
  };
  assert.deepEqual(Object.keys(proof.results[0]!).sort(), ["committedAt", "entitlementId", "resultId"]);
  assert.doesNotMatch(JSON.stringify(proof), /prize|pool|inventory|rarity/i);
});

test("generated home catalog section contract separates render-ready public data from admin mutations", () => {
  const publicSection = {
    id: "demon-slayer",
    title: "귀멸의 칼날 컬렉션",
    sortOrder: 10,
    isActive: true,
    version: 2,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T01:00:00.000Z",
    ip: {
      id: "demon-slayer",
      slug: "demon-slayer",
      nameKo: "귀멸의 칼날",
      nameEn: "Demon Slayer",
      nameJa: null,
      aliases: [],
      description: "",
      imageUrl: null,
      isActive: true,
      version: 1,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
    products: [{
      id: "demon-slayer-kuji",
      sku: "DS-KUJI-001",
      ipId: "demon-slayer",
      characterIds: [],
      category: "kuji",
      name: "귀멸의 칼날 쿠지",
      manufacturer: null,
      releaseDate: null,
      price: 9_900,
      availableQuantity: 36,
      metadata: {},
      imageUrl: null,
      isActive: true,
      isPrizeOnly: false,
      version: 1,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:00.000Z",
    }],
  } satisfies components["schemas"]["HomeCatalogSection"];
  const publicLayout = {
    configured: true,
    items: [publicSection],
  } satisfies components["schemas"]["HomeCatalogSectionList"];
  const adminSection = {
    id: publicSection.id,
    title: publicSection.title,
    ipId: publicSection.ip.id,
    sortOrder: publicSection.sortOrder,
    isActive: publicSection.isActive,
    version: publicSection.version,
    createdAt: publicSection.createdAt,
    updatedAt: publicSection.updatedAt,
  } satisfies components["schemas"]["AdminHomeCatalogSection"];
  const adminLayout = {
    configured: true,
    items: [adminSection],
  } satisfies components["schemas"]["AdminHomeCatalogSectionList"];
  const create = {
    id: "demon-slayer",
    title: "귀멸의 칼날 컬렉션",
    ipId: "demon-slayer",
    sortOrder: 10,
    isActive: true,
  } satisfies components["schemas"]["CreateHomeCatalogSectionInput"];
  const update = {
    title: "귀멸의 칼날 추천",
    ipId: "demon-slayer",
    sortOrder: 20,
    isActive: false,
    expectedVersion: 2,
  } satisfies components["schemas"]["UpdateHomeCatalogSectionInput"];
  const headers = {
    "Idempotency-Key": "home-section-update-0001",
    "X-Admin-Reason": "홈 노출 순서 변경",
  } satisfies paths["/v1/admin/home-sections/{sectionId}"]["patch"]["parameters"]["header"];
  const publicMethod: keyof paths["/v1/catalog/home-sections"] = "get";
  const adminCreateMethod: keyof paths["/v1/admin/home-sections"] = "post";
  const createdResponse: keyof paths["/v1/admin/home-sections"]["post"]["responses"] = 201;
  const conflictResponse: keyof paths["/v1/admin/home-sections/{sectionId}"]["patch"]["responses"] = 409;

  assert.equal(publicLayout.configured, true);
  assert.equal(adminLayout.items[0]?.ipId, publicSection.ip.id);
  assert.equal(publicSection.ip.id, create.ipId);
  assert.equal(publicSection.products[0]?.isPrizeOnly, false);
  assert.equal(update.expectedVersion, 2);
  assert.equal(headers["Idempotency-Key"], "home-section-update-0001");
  assert.equal(publicMethod, "get");
  assert.equal(adminCreateMethod, "post");
  assert.equal(createdResponse, 201);
  assert.equal(conflictResponse, 409);
});

test("health contracts separate process liveness from database readiness", () => {
  const liveness = {
    status: "ok",
    timestamp: "2026-09-04T00:00:00.000Z",
  } satisfies components["schemas"]["Liveness"];
  const readiness = {
    status: "unavailable",
    database: "unavailable",
    timestamp: "2026-09-04T00:00:00.000Z",
  } satisfies components["schemas"]["Readiness"];

  assert.equal("database" in liveness, false);
  assert.equal(readiness.database, "unavailable");
});

test("generated kuji room contract carries server time, one checkout lease, FIFO, and committed activity", () => {
  const snapshot = {
    serverNow: "2026-09-01T03:00:00.000Z",
    version: 3,
    productId: "evangelion-kuji",
    viewer: {
      entryId: "11111111-1111-4111-8111-111111111111",
      state: "WAITING",
      position: 2,
      peopleAhead: 1,
      checkoutExpiresAt: null,
      drawingExpiresAt: null,
    },
    active: {
      displayName: "럭**후",
      phase: "CHECKOUT_PENDING",
      checkoutExpiresAt: "2026-09-01T03:03:00.000Z",
    },
    waitingCount: 2,
    waitingPeople: [{
      entryId: "11111111-1111-4111-8111-111111111111",
      displayName: "나*",
      position: 2,
      isViewer: true,
    }],
    recentActivity: [{
      id: "22222222-2222-4222-8222-222222222222",
      displayName: "쿠**터",
      prizeName: "A상 피규어",
      prizeImageUrl: null,
      rarity: "A",
      committedAt: "2026-09-01T02:59:30.000Z",
    }],
  } satisfies components["schemas"]["KujiRoomSnapshot"];
  const joinPath: keyof paths["/v1/kuji/rooms/{productId}/entries"] = "post";
  const roomPath: keyof paths["/v1/kuji/rooms/{productId}/entries/{entryId}"] = "get";

  assert.equal(joinPath, "post");
  assert.equal(roomPath, "get");
  assert.equal(snapshot.viewer.peopleAhead, 1);
  assert.equal(snapshot.viewer.drawingExpiresAt, null);
  assert.equal(snapshot.active.checkoutExpiresAt, "2026-09-01T03:03:00.000Z");
});

test("generated order input links kuji checkout to one room entry", () => {
  const input = {
    items: [{ productId: "evangelion-kuji", quantity: 2, expectedDrawVersion: 1 }],
    pointAmount: 0,
    kujiRoomEntryId: "11111111-1111-4111-8111-111111111111",
  } satisfies components["schemas"]["CreateOrderInput"];
  assert.equal(input.kujiRoomEntryId, "11111111-1111-4111-8111-111111111111");
});

test("generated sealed kuji contract exposes availability without internal assignment ids or mappings", () => {
  const snapshot = {
    productId: "evangelion-kuji",
    probabilityVersion: 3,
    snapshotVersion: 8,
    totalSlots: 3,
    publishedAt: "2026-09-05T00:00:00.000Z",
    calculatedAt: "2026-09-05T00:01:00.000Z",
    slots: [
      { slotNumber: 1, available: true },
      { slotNumber: 2, available: false },
      { slotNumber: 3, available: true },
    ],
    tiers: [
      { tierCode: "A", tierRank: 0, label: "A상", initialQuantity: 1, remainingQuantity: 1 },
      { tierCode: "B", tierRank: 1, label: "B상", initialQuantity: 2, remainingQuantity: 2 },
    ],
  } satisfies components["schemas"]["PublicKujiDeckSnapshot"];
  const selection = {
    probabilityVersion: 3,
    slotNumbers: [1, 3],
  } satisfies components["schemas"]["BindKujiSlotsInput"];
  const result = {
    productId: snapshot.productId,
    roomEntryId: "11111111-1111-4111-8111-111111111111",
    probabilityVersion: snapshot.probabilityVersion,
    bindings: [
      {
        entitlementId: "22222222-2222-4222-8222-222222222222",
        slotNumber: 1,
        state: "RESERVED",
      },
      {
        entitlementId: "33333333-3333-4333-8333-333333333333",
        slotNumber: 3,
        state: "RESERVED",
      },
    ],
  } satisfies components["schemas"]["KujiSlotBindingResult"];
  const publicMethod: keyof paths["/v1/catalog/products/{productId}/kuji-slots"] = "get";
  const bindMethod: keyof paths["/v1/kuji/rooms/{productId}/entries/{entryId}/slots"] = "post";

  assert.equal(publicMethod, "get");
  assert.equal(bindMethod, "post");
  assert.deepEqual(Object.keys(snapshot.slots[0]!).sort(), ["available", "slotNumber"]);
  assert.deepEqual(Object.keys(result.bindings[0]!).sort(), ["entitlementId", "slotNumber", "state"]);
  assert.deepEqual(selection.slotNumbers, [1, 3]);
  assert.equal(snapshot.slots.filter(({ available }) => available).length, 2);
  assert.equal(snapshot.tiers.reduce((sum, tier) => sum + tier.remainingQuantity, 0), 3);
});

test("admin draw versions expose the stored sealed-kuji assignment algorithm", () => {
  const version = {
    id: "11111111-1111-4111-8111-111111111111",
    productId: "legacy-kuji",
    version: 1,
    status: "ACTIVE",
    publishedBy: null,
    publishedAt: "2026-09-05T00:00:00.000Z",
    createdAt: "2026-09-05T00:00:00.000Z",
    totalSlots: 20,
    assignmentAlgorithm: "LEGACY_SINGLE_TIER_V1",
    totalEffectiveWeight: 20,
    entries: [{
      id: "22222222-2222-4222-8222-222222222222",
      prizeProductId: "legacy-prize",
      prizeName: "기존 쿠지 경품",
      prizeImageUrl: null,
      prizeSku: "LEGACY-PRIZE",
      prizeIpId: "legacy-ip",
      prizeCategory: "figure",
      rarity: "일반",
      weight: 1,
      initialQuantity: 20,
      remainingQuantity: 20,
      tierCode: "LEGACY",
      tierRank: 0,
    }],
  } satisfies components["schemas"]["DrawProbabilityVersion"];

  assert.equal(version.assignmentAlgorithm, "LEGACY_SINGLE_TIER_V1");
});

test("generated account basic info contract keeps verified contacts read-only", () => {
  const basicInfo = {
    id: "11111111-1111-4111-8111-111111111111",
    nickname: "모찌수집가",
    email: "owner@example.test",
    phoneMasked: "010-****-5678",
    birthDate: "2000-02-29",
    version: 2,
    updatedAt: "2026-08-31T03:00:00.000Z",
  } satisfies components["schemas"]["AccountBasicInfo"];
  const update = {
    nickname: "새 닉네임",
    birthDate: null,
    expectedVersion: 2,
  } satisfies components["schemas"]["UpdateAccountBasicInfoInput"];
  const headers = {
    "Idempotency-Key": "account-basic-update-0001",
  } satisfies paths["/v1/account/basic-info"]["patch"]["parameters"]["header"];

  assert.equal(basicInfo.phoneMasked, "010-****-5678");
  assert.equal(Object.hasOwn(update, "email"), false);
  assert.equal(Object.hasOwn(update, "phone"), false);
  assert.equal(headers["Idempotency-Key"], "account-basic-update-0001");
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

test("media transport negotiation remains optional and PUT cannot be mistaken for a signed form", () => {
  // This must compile without acceptedUploadMethods for already released clients.
  const legacyInput = {
    purpose: "WANTED_REQUEST", filename: "reference.jpg", mimeType: "image/jpeg", byteSize: 5,
    checksumSha256: "a".repeat(64),
  } satisfies components["schemas"]["CreateMediaUploadInput"];
  const negotiated = { ...legacyInput, acceptedUploadMethods: ["POST", "PUT"] } satisfies components["schemas"]["CreateMediaUploadInput"];
  const common = {
    mediaId: "88888888-8888-4888-8888-888888888888", uploadUrl: "https://storage.example.test/staging",
    expiresAt: "2099-01-01T00:00:00.000Z", maxBytes: 5,
  };
  const post = { ...common, method: "POST", fields: { policy: "signed-policy" }, fileFieldName: "file" } satisfies components["schemas"]["MediaUploadIntent"];
  const put = { ...common, method: "PUT", bodyEncoding: "raw", headers: {
    "content-type": legacyInput.mimeType, "content-length": "5", "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-meta-sha256": legacyInput.checksumSha256, "x-amz-meta-media-id": common.mediaId,
  } } satisfies components["schemas"]["MediaUploadIntent"];
  const transport = (intent: components["schemas"]["MediaUploadIntent"]) => {
    if (intent.method === "POST") return intent.fileFieldName;
    // A discriminated PUT has only raw headers, not multipart field declarations.
    return intent.bodyEncoding;
  };
  assert.deepEqual(negotiated.acceptedUploadMethods, ["POST", "PUT"]);
  assert.equal(transport(post), "file");
  assert.equal(transport(put), "raw");
  assert.equal("fields" in put || "fileFieldName" in put, false);
  const document = readFileSync(fileURLToPath(new URL("../openapi/dabboba.openapi.yaml", import.meta.url)), "utf8");
  const input = document.slice(document.indexOf("    CreateMediaUploadInput:\n"), document.indexOf("    MediaUploadIntent:\n"));
  assert.match(input, /required: \[purpose, filename, mimeType, byteSize, checksumSha256\]/);
  assert.match(input, /acceptedUploadMethods:[\s\S]*?minItems: 1[\s\S]*?maxItems: 2[\s\S]*?uniqueItems: true/);
  assert.match(input, /enum: \[POST, PUT\]/);
  const raw = document.slice(document.indexOf("    MediaRawPutUploadIntent:\n"), document.indexOf("    MediaReady:\n"));
  assert.match(raw, /additionalProperties: false/);
  assert.match(raw, /required: \[mediaId, uploadUrl, method, bodyEncoding, headers, expiresAt, maxBytes\]/);
  assert.doesNotMatch(raw, /fileFieldName|\n        fields:/);
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
  assert.match(pointReturnSchemas, /verified acquisition source is GACHA/);
  assert.match(pointReturnSchemas, /KUJI, direct purchase, or an admin adjustment is not eligible/);
  assert.match(pointReturnSchemas, /totalPointAmount: \{ type: integer, minimum: 1, maximum: 2147483647 \}/);
  assert.match(pointReturnSchemas, /balance: \{ type: integer, minimum: 0, maximum: 2147483647 \}/);
});

test("exchange proposal contract accepts one or two owned inventory selections and no free text", () => {
  type OfferInput = components["schemas"]["CreateExchangeOfferInput"];
  type ListingInput = components["schemas"]["CreateExchangeListingInput"];
  type HasNoMessage = "message" extends keyof OfferInput ? false : true;
  type EmptyOfferAllowed = Record<string, never> extends OfferInput ? true : false;
  type ListingWithoutInventoryAllowed = {
    title: string;
    details: string;
  } extends ListingInput ? true : false;
  const offeredInventoryUnitIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const input = {
    offeredInventoryUnitIds,
  } satisfies OfferInput;
  const hasNoMessage: HasNoMessage = true;
  const emptyOfferAllowed: EmptyOfferAllowed = false;
  const listingWithoutInventoryAllowed: ListingWithoutInventoryAllowed = false;

  assert.deepEqual(input.offeredInventoryUnitIds, offeredInventoryUnitIds);
  assert.equal(hasNoMessage, true);
  assert.equal(emptyOfferAllowed, false);
  assert.equal(listingWithoutInventoryAllowed, false);
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
