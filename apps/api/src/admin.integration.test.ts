import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "./app.js";
import {
  acceptRequiredPoliciesForIntegrationTest,
  acceptUgcOperationsPolicyForIntegrationTest,
} from "./integration-test-fixtures.js";
import { hashPassword } from "./lib/password.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

type Session = {
  token: string;
  actor: { userId: string; role: string; sessionId: string };
};

test(
  "admin operations enforce server RBAC and preserve moderation and audit history",
  { skip: !databaseUrl },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-admin-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "admin-integration-session-pepper-value",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool, redis: null });
    t.after(async () => {
      await app.close();
      await pool.end();
    });

    const suffix = randomUUID();
    const createUserSession = async (label: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/dev-session",
        payload: { email: `${label}-${suffix}@example.test` },
      });
      assert.equal(response.statusCode, 201, response.body);
      const session = response.json() as Session;
      await acceptRequiredPoliciesForIntegrationTest(pool, session.actor.userId);
      await acceptUgcOperationsPolicyForIntegrationTest(pool, session.actor.userId);
      return session;
    };
    const author = await createUserSession("admin-flow-author");
    const reporter = await createUserSession("admin-flow-reporter");

    const userDenied = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard",
      headers: { authorization: `Bearer ${author.token}` },
    });
    assert.equal(userDenied.statusCode, 403, userDenied.body);

    const adminEmail = `operator-${suffix}@example.test`;
    const adminPassword = `Admin-Integration-${suffix}`;
    const credential = await hashPassword(adminPassword);
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO users(email,nickname,role,status)
       VALUES($1,'통합 테스트 운영자','ADMIN','ACTIVE') RETURNING id`,
      [adminEmail],
    );
    const adminId = admin.rows[0]!.id;
    await pool.query(
      `INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at)
       VALUES($1,'LOCAL_ADMIN',$2,now())`,
      [adminId, adminEmail],
    );
    await pool.query(
      `INSERT INTO admin_credentials
        (user_id,password_hash,password_salt,scrypt_cost,scrypt_block_size,scrypt_parallelization)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [
        adminId,
        credential.hash,
        credential.salt,
        credential.cost,
        credential.blockSize,
        credential.parallelization,
      ],
    );

    const badLogin = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      payload: { email: adminEmail, password: `${adminPassword}-wrong` },
    });
    assert.equal(badLogin.statusCode, 401, badLogin.body);
    const login = await app.inject({
      method: "POST",
      url: "/v1/admin/auth/login",
      headers: { "user-agent": "DabbobaIntegrationBrowser/1.0" },
      payload: { email: adminEmail, password: adminPassword },
    });
    assert.equal(login.statusCode, 201, login.body);
    const adminSession = login.json() as Session;
    assert.equal(adminSession.actor.role, "ADMIN");
    await pool.query(
      "UPDATE sessions SET ip_address='203.0.113.42',user_agent='Dabboba Real Admin Browser/1.0' WHERE id=$1",
      [adminSession.actor.sessionId],
    );

    const adminHeaders = (reason: string) => ({
      authorization: `Bearer ${adminSession.token}`,
      "idempotency-key": `admin-integration-${randomUUID()}`,
      "x-admin-reason": reason,
      "user-agent": "undici admin-bff-proxy",
    });

    const dashboard = await app.inject({
      method: "GET",
      url: "/v1/admin/dashboard",
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(dashboard.statusCode, 200, dashboard.body);
    const superAdminOnly = await app.inject({
      method: "GET",
      url: "/v1/admin/administrators",
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(superAdminOnly.statusCode, 403, superAdminOnly.body);
    const adminDeniedFromUserAccount = await app.inject({
      method: "GET",
      url: "/v1/account/profile",
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(adminDeniedFromUserAccount.statusCode, 403, adminDeniedFromUserAccount.body);

    const catalogIpId = `admin-flow-${suffix}`;
    const createdIp = await app.inject({
      method: "POST",
      url: "/v1/admin/ips",
      headers: adminHeaders("카탈로그 신청 승인 대상 IP 등록"),
      payload: {
        id: catalogIpId,
        slug: catalogIpId,
        nameKo: `관리자 통합 IP ${suffix}`,
        nameEn: `Admin integration IP ${suffix}`,
        nameJa: null,
        aliases: [],
        description: "카탈로그 신청의 공식 등록 연결을 검증합니다.",
        imageUrl: null,
        isActive: true,
      },
    });
    assert.equal(createdIp.statusCode, 201, createdIp.body);
    const createdIpBody = createdIp.json() as { version: number };
    const catalogRequestKey = `catalog-request-${randomUUID()}`;
    const catalogRequestPayload = {
      kind: "PRODUCT",
      name: `사용자 요청 상품 ${suffix}`,
      referenceUrl: "https://example.test/product-reference",
      description: "공식 상품 등록 후 승인되어야 합니다.",
      mediaId: null,
    };
    const catalogRequest = await app.inject({
      method: "POST",
      url: "/v1/catalog/requests",
      headers: { authorization: `Bearer ${author.token}`, "idempotency-key": catalogRequestKey },
      payload: catalogRequestPayload,
    });
    assert.equal(catalogRequest.statusCode, 201, catalogRequest.body);
    const catalogRequestId = (catalogRequest.json() as { id: string }).id;
    const catalogRequestReplay = await app.inject({
      method: "POST",
      url: "/v1/catalog/requests",
      headers: { authorization: `Bearer ${author.token}`, "idempotency-key": catalogRequestKey },
      payload: catalogRequestPayload,
    });
    assert.equal(catalogRequestReplay.statusCode, 201, catalogRequestReplay.body);
    assert.equal(catalogRequestReplay.headers["x-idempotent-replay"], "true");
    assert.equal((catalogRequestReplay.json() as { id: string }).id, catalogRequestId);
    const canonicalProductId = `approved-product-${suffix}`;
    const canonicalProductImageUrl = `https://cdn.example.test/products/${canonicalProductId}.png`;
    const createdProduct = await app.inject({
      method: "POST",
      url: "/v1/admin/products",
      headers: adminHeaders("사용자 신청 상품 공식 등록"),
      payload: {
        id: canonicalProductId,
        sku: `APPROVED-${suffix}`.toUpperCase(),
        ipId: catalogIpId,
        characterIds: [],
        category: "figure",
        name: `공식 등록 상품 ${suffix}`,
        manufacturer: "DABBOBA TEST",
        releaseDate: null,
        price: 12_000,
        availableQuantity: 3,
        metadata: { source: "catalog-request-integration" },
        imageUrl: canonicalProductImageUrl,
        isActive: false,
        isPrizeOnly: false,
      },
    });
    assert.equal(createdProduct.statusCode, 201, createdProduct.body);
    const createdProductBody = createdProduct.json() as { version: number };
    const categoryMutation = await app.inject({
      method: "PATCH",
      url: `/v1/admin/products/${canonicalProductId}`,
      headers: adminHeaders("기존 상품 카테고리 변경 방지 검증"),
      payload: {
        sku: `APPROVED-${suffix}`.toUpperCase(),
        ipId: catalogIpId,
        characterIds: [],
        category: "gacha",
        name: `공식 등록 상품 ${suffix}`,
        manufacturer: "DABBOBA TEST",
        releaseDate: null,
        price: 12_000,
        availableQuantity: 3,
        metadata: { source: "catalog-request-integration" },
        imageUrl: canonicalProductImageUrl,
        isActive: true,
        isPrizeOnly: false,
        expectedVersion: createdProductBody.version,
      },
    });
    assert.equal(categoryMutation.statusCode, 409, categoryMutation.body);
    const inactiveApproval = await app.inject({
      method: "POST",
      url: `/v1/admin/catalog-requests/${catalogRequestId}/decision`,
      headers: adminHeaders("비활성 정규 상품 승인 방지 검증"),
      payload: {
        decision: "APPROVED",
        canonicalTargetId: canonicalProductId,
        reason: "비활성 정규 상품 승인 방지 검증",
      },
    });
    assert.equal(inactiveApproval.statusCode, 409, inactiveApproval.body);
    const activatedProduct = await app.inject({
      method: "PATCH",
      url: `/v1/admin/products/${canonicalProductId}`,
      headers: adminHeaders("공개 검색 전 정규 상품 활성화"),
      payload: {
        sku: `APPROVED-${suffix}`.toUpperCase(),
        ipId: catalogIpId,
        characterIds: [],
        category: "figure",
        name: `공식 등록 상품 ${suffix}`,
        manufacturer: "DABBOBA TEST",
        releaseDate: null,
        price: 12_000,
        availableQuantity: 3,
        metadata: { source: "catalog-request-integration" },
        imageUrl: canonicalProductImageUrl,
        isActive: true,
        isPrizeOnly: false,
        saleStatus: "ON_SALE",
        expectedVersion: createdProductBody.version,
      },
    });
    assert.equal(activatedProduct.statusCode, 200, activatedProduct.body);
    const deactivatedIp = await app.inject({
      method: "PATCH",
      url: `/v1/admin/ips/${catalogIpId}`,
      headers: adminHeaders("비활성 상위 IP 승인 방지 검증"),
      payload: {
        slug: catalogIpId,
        nameKo: `관리자 통합 IP ${suffix}`,
        nameEn: `Admin integration IP ${suffix}`,
        nameJa: null,
        aliases: [],
        description: "카탈로그 신청의 공식 등록 연결을 검증합니다.",
        imageUrl: null,
        isActive: false,
        expectedVersion: createdIpBody.version,
      },
    });
    assert.equal(deactivatedIp.statusCode, 200, deactivatedIp.body);
    const inactiveParentApproval = await app.inject({
      method: "POST",
      url: `/v1/admin/catalog-requests/${catalogRequestId}/decision`,
      headers: adminHeaders("비활성 상위 IP 상품 승인 방지 검증"),
      payload: {
        decision: "APPROVED",
        canonicalTargetId: canonicalProductId,
        reason: "비활성 상위 IP 상품 승인 방지 검증",
      },
    });
    assert.equal(inactiveParentApproval.statusCode, 409, inactiveParentApproval.body);
    const deactivatedIpBody = deactivatedIp.json() as { version: number };
    const reactivatedIp = await app.inject({
      method: "PATCH",
      url: `/v1/admin/ips/${catalogIpId}`,
      headers: adminHeaders("공개 검색 전 상위 IP 활성화"),
      payload: {
        slug: catalogIpId,
        nameKo: `관리자 통합 IP ${suffix}`,
        nameEn: `Admin integration IP ${suffix}`,
        nameJa: null,
        aliases: [],
        description: "카탈로그 신청의 공식 등록 연결을 검증합니다.",
        imageUrl: null,
        isActive: true,
        expectedVersion: deactivatedIpBody.version,
      },
    });
    assert.equal(reactivatedIp.statusCode, 200, reactivatedIp.body);
    const approvedRequest = await app.inject({
      method: "POST",
      url: `/v1/admin/catalog-requests/${catalogRequestId}/decision`,
      headers: adminHeaders("공식 상품 등록 확인 후 신청 승인"),
      payload: {
        decision: "APPROVED",
        canonicalTargetId: canonicalProductId,
        reason: "공식 상품 등록 확인 후 신청 승인",
      },
    });
    assert.equal(approvedRequest.statusCode, 200, approvedRequest.body);
    assert.deepEqual(
      {
        status: (approvedRequest.json() as { status: string }).status,
        canonicalTargetId: (approvedRequest.json() as { canonicalTargetId: string }).canonicalTargetId,
      },
      { status: "APPROVED", canonicalTargetId: canonicalProductId },
    );
    const publicApprovedProduct = await app.inject({
      method: "GET",
      url: `/v1/catalog/products?q=${encodeURIComponent(suffix)}&limit=100`,
    });
    assert.equal(publicApprovedProduct.statusCode, 200, publicApprovedProduct.body);
    assert.ok((publicApprovedProduct.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === canonicalProductId));

    const noticePrefix = `통합 공지 ${suffix}`;
    const createNotice = async (sequence: number) => {
      const reason = `통합 공지 ${sequence} 생성`;
      const response = await app.inject({
        method: "POST",
        url: "/v1/admin/notices",
        headers: adminHeaders(reason),
        payload: {
          title: `${noticePrefix} ${sequence}`,
          content: "관리자 공지의 게시 및 복구 흐름을 검증합니다.",
          isPinned: sequence === 1,
          isPublished: true,
        },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json() as { id: string; version: number };
    };
    const firstNotice = await createNotice(1);
    const secondNotice = await createNotice(2);

    const firstPage = await app.inject({
      method: "GET",
      url: `/v1/admin/notices?q=${encodeURIComponent(noticePrefix)}&limit=1`,
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    const firstPageBody = firstPage.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    assert.equal(firstPageBody.items.length, 1);
    assert.ok(firstPageBody.nextCursor);
    const secondPage = await app.inject({
      method: "GET",
      url: `/v1/admin/notices?q=${encodeURIComponent(noticePrefix)}&limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor!)}`,
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(secondPage.statusCode, 200, secondPage.body);
    const secondPageBody = secondPage.json() as { items: Array<{ id: string }> };
    assert.equal(secondPageBody.items.length, 1);
    assert.notEqual(secondPageBody.items[0]!.id, firstPageBody.items[0]!.id);

    const hideReason = "노출 상태 및 이력 검증을 위한 숨김";
    const hidden = await app.inject({
      method: "POST",
      url: `/v1/admin/notices/${firstNotice.id}/visibility`,
      headers: adminHeaders(hideReason),
      payload: { status: "HIDDEN", expectedVersion: firstNotice.version },
    });
    assert.equal(hidden.statusCode, 200, hidden.body);
    const hiddenNotice = hidden.json() as { version: number; status: string };
    assert.equal(hiddenNotice.status, "HIDDEN");

    const publicNotices = await app.inject({ method: "GET", url: "/v1/notices?limit=100" });
    assert.equal(publicNotices.statusCode, 200, publicNotices.body);
    const publicNoticeIds = (publicNotices.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
    assert.ok(!publicNoticeIds.includes(firstNotice.id));
    assert.ok(publicNoticeIds.includes(secondNotice.id));

    const deleteReason = "소프트 삭제 및 복구 검증";
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/admin/notices/${firstNotice.id}`,
      headers: adminHeaders(deleteReason),
      payload: { expectedVersion: hiddenNotice.version },
    });
    assert.equal(deleted.statusCode, 204, deleted.body);
    const restored = await app.inject({
      method: "POST",
      url: `/v1/admin/notices/${firstNotice.id}/restore`,
      headers: adminHeaders("삭제 공지 복구 검증"),
      payload: { expectedVersion: hiddenNotice.version + 1 },
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.deepEqual(
      {
        status: (restored.json() as { status: string }).status,
        isPublished: (restored.json() as { isPublished: boolean }).isPublished,
      },
      { status: "ACTIVE", isPublished: false },
    );

    const inquiry = await app.inject({
      method: "POST",
      url: "/v1/inquiries",
      headers: { authorization: `Bearer ${author.token}`, "idempotency-key": `inquiry-${randomUUID()}` },
      payload: {
        category: "PRODUCT",
        title: `통합 문의 ${suffix}`,
        content: "상품 상태를 확인해 주세요.",
      },
    });
    assert.equal(inquiry.statusCode, 201, inquiry.body);
    const inquiryId = (inquiry.json() as { id: string }).id;
    const answer = await app.inject({
      method: "POST",
      url: `/v1/admin/inquiries/${inquiryId}/messages`,
      headers: adminHeaders("사용자 문의 답변 검증"),
      payload: { content: "확인 후 정상 상태로 안내했습니다.", status: "ANSWERED", isInternal: false },
    });
    assert.equal(answer.statusCode, 201, answer.body);
    const internalNote = await app.inject({
      method: "POST",
      url: `/v1/admin/inquiries/${inquiryId}/messages`,
      headers: adminHeaders("문의 내부 메모 비노출 검증"),
      payload: { content: "운영자에게만 보여야 하는 메모입니다.", isInternal: true },
    });
    assert.equal(internalNote.statusCode, 201, internalNote.body);
    const userInquiry = await app.inject({
      method: "GET",
      url: `/v1/inquiries/${inquiryId}`,
      headers: { authorization: `Bearer ${author.token}` },
    });
    assert.equal(userInquiry.statusCode, 200, userInquiry.body);
    const userMessages = (userInquiry.json() as { messages: Array<{ content: string }> }).messages;
    assert.equal(userMessages.length, 2);
    assert.ok(!userMessages.some((message) => message.content.includes("운영자에게만")));

    const postKey = `community-post-${randomUUID()}`;
    const postPayload = {
      kind: "GENERAL",
      title: `신고 대상 게시물 ${suffix}`,
      content: "신고 처리 후 공개 조회에서 사라져야 합니다.",
    };
    const post = await app.inject({
      method: "POST",
      url: "/v1/community/posts",
      headers: { authorization: `Bearer ${author.token}`, "idempotency-key": postKey },
      payload: postPayload,
    });
    assert.equal(post.statusCode, 201, post.body);
    const postId = (post.json() as { id: string }).id;
    const postReplay = await app.inject({
      method: "POST",
      url: "/v1/community/posts",
      headers: { authorization: `Bearer ${author.token}`, "idempotency-key": postKey },
      payload: postPayload,
    });
    assert.equal(postReplay.statusCode, 201, postReplay.body);
    assert.equal(postReplay.headers["x-idempotent-replay"], "true");
    assert.equal((postReplay.json() as { id: string }).id, postId);
    const selfReport = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { authorization: `Bearer ${author.token}`, "idempotency-key": `self-report-${randomUUID()}` },
      payload: { targetType: "POST", targetId: postId, reason: "SPAM", details: "자기 작성물 신고 방지 검증" },
    });
    assert.equal(selfReport.statusCode, 404, selfReport.body);
    const report = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { authorization: `Bearer ${reporter.token}`, "idempotency-key": `report-${randomUUID()}` },
      payload: { targetType: "POST", targetId: postId, reason: "SPAM", details: "통합 신고 검증" },
    });
    assert.equal(report.statusCode, 201, report.body);
    const reportId = (report.json() as { id: string }).id;
    const reportList = await app.inject({
      method: "GET",
      url: "/v1/admin/reports?status=PENDING&limit=100",
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(reportList.statusCode, 200, reportList.body);
    const reportItem = (reportList.json() as {
      items: Array<{ id: string; targetPreview: string | null; targetStatus: string | null }>;
    }).items.find((item) => item.id === reportId);
    assert.ok(reportItem?.targetPreview?.includes("신고 대상 게시물"));
    assert.equal(reportItem?.targetStatus, "ACTIVE");

    const authoredReports = await app.inject({
      method: "GET",
      url: `/v1/admin/reports?subjectUserId=${author.actor.userId}&limit=100`,
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(authoredReports.statusCode, 200, authoredReports.body);
    assert.ok((authoredReports.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === reportId));
    const authorDetail = await app.inject({
      method: "GET",
      url: `/v1/admin/users/${author.actor.userId}`,
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(authorDetail.statusCode, 200, authorDetail.body);
    assert.ok((authorDetail.json() as { reportCount: number }).reportCount >= 1);

    const reviewReason = "담당 운영자 검토 시작 상태 검증";
    const reviewing = await app.inject({
      method: "POST",
      url: `/v1/admin/reports/${reportId}/review`,
      headers: adminHeaders(reviewReason),
      payload: { reason: reviewReason },
    });
    assert.equal(reviewing.statusCode, 200, reviewing.body);
    assert.equal((reviewing.json() as { status: string }).status, "REVIEWING");
    const duplicateReview = await app.inject({
      method: "POST",
      url: `/v1/admin/reports/${reportId}/review`,
      headers: adminHeaders("중복 검토 선점 방지"),
      payload: { reason: "중복 검토 선점 방지" },
    });
    assert.equal(duplicateReview.statusCode, 409, duplicateReview.body);

    const resolutionReason = "신고 검토 결과 공개 숨김 처리";
    const resolved = await app.inject({
      method: "POST",
      url: `/v1/admin/reports/${reportId}/resolution`,
      headers: adminHeaders(resolutionReason),
      payload: { status: "RESOLVED", action: "HIDE_POST", reason: resolutionReason },
    });
    assert.equal(resolved.statusCode, 200, resolved.body);
    const hiddenPost = await app.inject({ method: "GET", url: `/v1/community/posts/${postId}` });
    assert.equal(hiddenPost.statusCode, 404, hiddenPost.body);

    const warningTargetPost = await app.inject({
      method: "POST",
      url: "/v1/community/posts",
      headers: { authorization: `Bearer ${author.token}`, "idempotency-key": `warning-post-${randomUUID()}` },
      payload: {
        kind: "SNAP",
        title: `경고 대상 Snap ${suffix}`,
        content: "콘텐츠 신고에서 작성자 경고로 연결되어야 합니다.",
      },
    });
    assert.equal(warningTargetPost.statusCode, 201, warningTargetPost.body);
    const warningTargetPostId = (warningTargetPost.json() as { id: string }).id;
    const misclassifiedSnapReport = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { authorization: `Bearer ${reporter.token}`, "idempotency-key": `misclassified-snap-report-${randomUUID()}` },
      payload: { targetType: "POST", targetId: warningTargetPostId, reason: "INAPPROPRIATE", details: "Snap 이중 분류 신고 방지" },
    });
    assert.equal(misclassifiedSnapReport.statusCode, 404, misclassifiedSnapReport.body);
    const warningReport = await app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: { authorization: `Bearer ${reporter.token}`, "idempotency-key": `warning-report-${randomUUID()}` },
      payload: { targetType: "SNAP", targetId: warningTargetPostId, reason: "INAPPROPRIATE", details: "작성자 경고 연결 검증" },
    });
    assert.equal(warningReport.statusCode, 201, warningReport.body);
    const warningReportId = (warningReport.json() as { id: string }).id;
    const warningResolution = await app.inject({
      method: "POST",
      url: `/v1/admin/reports/${warningReportId}/resolution`,
      headers: adminHeaders("신고된 Snap 작성자 경고 검증"),
      payload: { status: "RESOLVED", action: "WARN_USER", reason: "신고된 Snap 작성자 경고 검증" },
    });
    assert.equal(warningResolution.statusCode, 200, warningResolution.body);
    const warningEvent = await pool.query<{ payload: { userId: string; reportId: string } }>(
      "SELECT payload FROM outbox_events WHERE event_type='user.warning_requested' AND aggregate_id=$1 ORDER BY created_at DESC LIMIT 1",
      [author.actor.userId],
    );
    assert.deepEqual(warningEvent.rows[0]?.payload, {
      userId: author.actor.userId,
      reportId: warningReportId,
      reason: "신고된 Snap 작성자 경고 검증",
    });

    const users = await app.inject({
      method: "GET",
      url: `/v1/admin/users?q=${encodeURIComponent(suffix)}&limit=100`,
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(users.statusCode, 200, users.body);
    for (const item of (users.json() as { items: Array<Record<string, unknown>> }).items) {
      assert.ok("emailMasked" in item);
      assert.ok(!("email" in item));
    }

    const suspendReason = "운영 이용정지 이력 검증";
    const suspended = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${author.actor.userId}/status`,
      headers: adminHeaders(suspendReason),
      payload: {
        status: "SUSPENDED",
        reason: suspendReason,
        suspendedUntil: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    assert.equal(suspended.statusCode, 200, suspended.body);
    const revokedUserSession = await app.inject({
      method: "GET",
      url: "/v1/account/profile",
      headers: { authorization: `Bearer ${author.token}` },
    });
    assert.equal(revokedUserSession.statusCode, 401, revokedUserSession.body);
    const reactivated = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${author.actor.userId}/status`,
      headers: adminHeaders("운영 이용정지 해제 이력 검증"),
      payload: { status: "ACTIVE", reason: "운영 이용정지 해제 이력 검증", suspendedUntil: null },
    });
    assert.equal(reactivated.statusCode, 200, reactivated.body);
    const activeSuspensions = await pool.query<{ count: string }>(
      "SELECT count(*) FROM user_suspensions WHERE user_id=$1 AND revoked_at IS NULL",
      [author.actor.userId],
    );
    assert.equal(Number(activeSuspensions.rows[0]!.count), 0);

    await pool.query("UPDATE users SET status='BANNED' WHERE id=$1", [reporter.actor.userId]);
    const forbiddenResurrection = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${reporter.actor.userId}/status`,
      headers: adminHeaders("일반 관리자의 차단 계정 복구 차단 검증"),
      payload: { status: "ACTIVE", reason: "일반 관리자의 차단 계정 복구 차단 검증", suspendedUntil: null },
    });
    assert.equal(forbiddenResurrection.statusCode, 403, forbiddenResurrection.body);
    const stillBanned = await pool.query<{ status: string }>("SELECT status FROM users WHERE id=$1", [reporter.actor.userId]);
    assert.equal(stillBanned.rows[0]!.status, "BANNED");

    const rejectedReport = await pool.query<{ id: string }>(
      `INSERT INTO content_reports(reporter_id,target_type,target_id,reason,details)
       VALUES($1,'USER',$2,'SPAM','신고 반려 조치 매트릭스 검증') RETURNING id`,
      [author.actor.userId, reporter.actor.userId],
    );
    const rejectedWithDiscipline = await app.inject({
      method: "POST",
      url: `/v1/admin/reports/${rejectedReport.rows[0]!.id}/resolution`,
      headers: adminHeaders("반려 신고 징계 차단 검증"),
      payload: { status: "REJECTED", action: "SUSPEND_USER", reason: "반려 신고 징계 차단 검증" },
    });
    assert.equal(rejectedWithDiscipline.statusCode, 400, rejectedWithDiscipline.body);
    const rejectedWithoutDiscipline = await app.inject({
      method: "POST",
      url: `/v1/admin/reports/${rejectedReport.rows[0]!.id}/resolution`,
      headers: adminHeaders("신고 반려 무조치 처리 검증"),
      payload: { status: "REJECTED", action: "NO_ACTION", reason: "신고 반려 무조치 처리 검증" },
    });
    assert.equal(rejectedWithoutDiscipline.statusCode, 200, rejectedWithoutDiscipline.body);

    const bannedTargetReport = await pool.query<{ id: string }>(
      `INSERT INTO content_reports(reporter_id,target_type,target_id,reason,details)
       VALUES($1,'USER',$2,'SPAM','차단 계정 이용정지 강등 방지 검증') RETURNING id`,
      [author.actor.userId, reporter.actor.userId],
    );
    const bannedDowngrade = await app.inject({
      method: "POST",
      url: `/v1/admin/reports/${bannedTargetReport.rows[0]!.id}/resolution`,
      headers: adminHeaders("차단 계정 이용정지 강등 방지 검증"),
      payload: { status: "RESOLVED", action: "SUSPEND_USER", reason: "차단 계정 이용정지 강등 방지 검증" },
    });
    assert.equal(bannedDowngrade.statusCode, 409, bannedDowngrade.body);
    const stillBannedAfterReport = await pool.query<{ status: string }>("SELECT status FROM users WHERE id=$1", [reporter.actor.userId]);
    assert.equal(stillBannedAfterReport.rows[0]!.status, "BANNED");

    const audit = await app.inject({
      method: "GET",
      url: `/v1/admin/audit-logs?q=${firstNotice.id}&limit=100`,
      headers: { authorization: `Bearer ${adminSession.token}` },
    });
    assert.equal(audit.statusCode, 200, audit.body);
    const auditItems = (audit.json() as { items: Array<{ id: string; action: string }> }).items;
    const createdAudit = auditItems.find((item) => item.action === "NOTICE_CREATED");
    assert.ok(createdAudit);
    const auditIdentity = await pool.query<{ ip_address: string | null; user_agent: string | null }>(
      "SELECT host(ip_address) AS ip_address,user_agent FROM admin_audit_logs WHERE id=$1",
      [createdAudit!.id],
    );
    assert.deepEqual(auditIdentity.rows[0], {
      ip_address: "203.0.113.42",
      user_agent: "Dabboba Real Admin Browser/1.0",
    });
    await assert.rejects(
      pool.query("UPDATE admin_audit_logs SET reason='tampered' WHERE id=$1", [createdAudit!.id]),
      (error: unknown) =>
        typeof error === "object" && error !== null && "code" in error && error.code === "55000",
    );

    const preExistingSuperAdmins = await pool.query<{ count: string }>(
      "SELECT count(*) FROM users WHERE role='SUPER_ADMIN' AND status='ACTIVE'",
    );
    const hadExistingActiveSuperAdmin = Number(preExistingSuperAdmins.rows[0]!.count) > 0;
    const superAdmins: Array<{ id: string; password: string; token?: string }> = [];
    for (const index of [1, 2]) {
      const email = `super-${index}-${suffix}@example.test`;
      const password = `SuperAdmin-${index}-${suffix}`;
      const superCredential = await hashPassword(password);
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO users(email,nickname,role,status)
         VALUES($1,$2,'SUPER_ADMIN','ACTIVE') RETURNING id`,
        [email, `동시성 최고관리자 ${index}`],
      );
      await pool.query(
        `INSERT INTO auth_identities(user_id,provider,provider_subject,verified_at)
         VALUES($1,'LOCAL_ADMIN',$2,now())`,
        [inserted.rows[0]!.id, email],
      );
      await pool.query(
        `INSERT INTO admin_credentials
          (user_id,password_hash,password_salt,scrypt_cost,scrypt_block_size,scrypt_parallelization)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [
          inserted.rows[0]!.id,
          superCredential.hash,
          superCredential.salt,
          superCredential.cost,
          superCredential.blockSize,
          superCredential.parallelization,
        ],
      );
      const superLogin = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        payload: { email, password },
      });
      assert.equal(superLogin.statusCode, 201, superLogin.body);
      superAdmins.push({ id: inserted.rows[0]!.id, password, token: (superLogin.json() as Session).token });
    }
    const concurrentDemotions = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/v1/admin/administrators/${superAdmins[1]!.id}`,
        headers: {
          authorization: `Bearer ${superAdmins[0]!.token}`,
          "idempotency-key": `super-admin-race-${randomUUID()}`,
          "x-admin-reason": "최고 관리자 동시 강등 직렬화 검증",
        },
        payload: { role: "ADMIN", status: "ACTIVE", reason: "최고 관리자 동시 강등 직렬화 검증" },
      }),
      app.inject({
        method: "PATCH",
        url: `/v1/admin/administrators/${superAdmins[0]!.id}`,
        headers: {
          authorization: `Bearer ${superAdmins[1]!.token}`,
          "idempotency-key": `super-admin-race-${randomUUID()}`,
          "x-admin-reason": "최고 관리자 동시 강등 직렬화 검증",
        },
        payload: { role: "ADMIN", status: "ACTIVE", reason: "최고 관리자 동시 강등 직렬화 검증" },
      }),
    ]);
    const successfulDemotions = concurrentDemotions.filter((response) => response.statusCode === 200).length;
    assert.equal(successfulDemotions, hadExistingActiveSuperAdmin ? 2 : 1);
    assert.equal(concurrentDemotions.filter((response) => [403, 409].includes(response.statusCode)).length, hadExistingActiveSuperAdmin ? 0 : 1);
    const activeSuperAdmins = await pool.query<{ count: string }>(
      "SELECT count(*) FROM users WHERE id=ANY($1::uuid[]) AND role='SUPER_ADMIN' AND status='ACTIVE'",
      [superAdmins.map((item) => item.id)],
    );
    assert.equal(Number(activeSuperAdmins.rows[0]!.count), hadExistingActiveSuperAdmin ? 0 : 1);
    const globallyActiveSuperAdmins = await pool.query<{ count: string }>(
      "SELECT count(*) FROM users WHERE role='SUPER_ADMIN' AND status='ACTIVE'",
    );
    assert.ok(Number(globallyActiveSuperAdmins.rows[0]!.count) >= 1);
  },
);
