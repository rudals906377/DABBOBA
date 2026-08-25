import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "admin account deletion review recomputes blockers and records a non-destructive immutable decision",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-admin-account-deletion-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "admin-account-deletion-integration-pepper",
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

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const createActor = async (role: "USER" | "ADMIN" | "SUPER_ADMIN", label: string) => {
      const email = `${label}-${suffix}@example.test`;
      const created = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
        [email, `${label} ${suffix}`, role],
      );
      const session = await issueSession(pool, config, {
        userId: created.rows[0]!.id,
        kind: role === "USER" ? "USER" : "ADMIN",
        ip: "203.0.113.77",
        userAgent: "Dabboba Account Deletion Review Integration/1.0",
      });
      return { id: created.rows[0]!.id, token: session.token, email };
    };
    const user = await createActor("USER", "deletion-owner");
    const spectator = await createActor("USER", "deletion-spectator");
    const admin = await createActor("ADMIN", "deletion-operator");
    const superAdmin = await createActor("SUPER_ADMIN", "deletion-supervisor");
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    const mutation = (token: string, reason: string, key = `account-deletion-${randomUUID()}`) => ({
      authorization: `Bearer ${token}`,
      "x-admin-reason": reason,
      "idempotency-key": key,
    });

    const permissions = await pool.query<{ role: string; permission_code: string }>(`
      SELECT role,permission_code FROM admin_role_permissions
      WHERE permission_code IN ('account_deletions.read','account_deletions.review')
      ORDER BY role,permission_code`);
    for (const role of ["ADMIN", "SUPER_ADMIN"]) {
      assert.ok(permissions.rows.some((item) => item.role === role && item.permission_code === "account_deletions.read"));
      assert.ok(permissions.rows.some((item) => item.role === role && item.permission_code === "account_deletions.review"));
    }

    const userDenied = await app.inject({
      method: "GET",
      url: "/v1/admin/account-deletions",
      headers: auth(spectator.token),
    });
    assert.equal(userDenied.statusCode, 403, userDenied.body);

    await pool.query("UPDATE users SET status='DELETED',deleted_at=now() WHERE id=$1", [spectator.id]);
    const genericReactivationReason = "탈퇴 상태 계정의 일반 복구 우회 차단 검증";
    const genericReactivation = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${spectator.id}/status`,
      headers: mutation(superAdmin.token, genericReactivationReason),
      payload: { status: "ACTIVE", reason: genericReactivationReason, suspendedUntil: null },
    });
    assert.equal(genericReactivation.statusCode, 409, genericReactivation.body);
    const afterGenericReactivation = await pool.query<{
      status: string;
      deleted_at: Date | null;
      audit_count: string;
    }>(`
      SELECT u.status,u.deleted_at,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.target_type='USER' AND a.target_id=u.id::text) AS audit_count
      FROM users u WHERE u.id=$1`, [spectator.id]);
    assert.equal(afterGenericReactivation.rows[0]!.status, "DELETED");
    assert.ok(afterGenericReactivation.rows[0]!.deleted_at);
    assert.equal(afterGenericReactivation.rows[0]!.audit_count, "0");

    const directDeletionReason = "일반 상태 변경 경로의 탈퇴 우회 차단 검증";
    const directDeletion = await app.inject({
      method: "POST",
      url: `/v1/admin/users/${user.id}/status`,
      headers: mutation(superAdmin.token, directDeletionReason),
      payload: { status: "DELETED", reason: directDeletionReason, suspendedUntil: null },
    });
    assert.equal(directDeletion.statusCode, 400, directDeletion.body);
    const afterDirectDeletion = await pool.query<{
      status: string;
      deleted_at: Date | null;
      request_count: string;
      audit_count: string;
      outbox_count: string;
    }>(`
      SELECT u.status,u.deleted_at,
        (SELECT count(*) FROM account_deletion_requests d WHERE d.user_id=u.id) AS request_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.target_type='USER' AND a.target_id=u.id::text) AS audit_count,
        (SELECT count(*) FROM outbox_events o WHERE o.aggregate_type='ACCOUNT_DELETION_REQUEST' AND o.payload->>'userId'=u.id::text) AS outbox_count
      FROM users u WHERE u.id=$1`, [user.id]);
    assert.deepEqual(afterDirectDeletion.rows[0], {
      status: "ACTIVE",
      deleted_at: null,
      request_count: "0",
      audit_count: "0",
      outbox_count: "0",
    });

    await pool.query("INSERT INTO point_accounts(user_id,balance) VALUES($1,100)", [user.id]);
    const requested = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: { ...auth(user.token), "idempotency-key": `customer-deletion-${randomUUID()}` },
      payload: {},
    });
    assert.equal(requested.statusCode, 202, requested.body);
    const requestId = (requested.json() as { id: string; status: string }).id;
    assert.equal((requested.json() as { status: string }).status, "BLOCKED");

    const queue = await app.inject({
      method: "GET",
      url: `/v1/admin/account-deletions?q=${encodeURIComponent(suffix)}`,
      headers: auth(admin.token),
    });
    assert.equal(queue.statusCode, 200, queue.body);
    assert.ok((queue.json() as { items: Array<{ id: string }> }).items.some((item) => item.id === requestId));

    const detail = await app.inject({
      method: "GET",
      url: `/v1/admin/account-deletions/${requestId}`,
      headers: auth(superAdmin.token),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    assert.deepEqual(
      {
        pointBalance: (detail.json() as { currentBlockers: { pointBalance: number } }).currentBlockers.pointBalance,
        approvalEligible: (detail.json() as { approvalEligible: boolean }).approvalEligible,
        completionAvailable: (detail.json() as { completionAvailable: boolean }).completionAvailable,
        hardDeletePerformed: (detail.json() as { hardDeletePerformed: boolean }).hardDeletePerformed,
      },
      { pointBalance: 100, approvalEligible: false, completionAvailable: false, hardDeletePerformed: false },
    );

    const blockedApproval = await app.inject({
      method: "POST",
      url: `/v1/admin/account-deletions/${requestId}/decision`,
      headers: mutation(admin.token, "미해결 포인트가 남은 승인 시도"),
      payload: { decision: "APPROVED", reason: "미해결 포인트가 남은 승인 시도" },
    });
    assert.equal(blockedApproval.statusCode, 409, blockedApproval.body);
    const afterBlockedAttempt = await pool.query<{ status: string; event_count: string; audit_count: string }>(`
      SELECT d.status,
        (SELECT count(*) FROM account_deletion_request_events e WHERE e.deletion_request_id=d.id AND e.event_type='STATUS_CHANGED') AS event_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.target_type='ACCOUNT_DELETION_REQUEST' AND a.target_id=d.id::text) AS audit_count
      FROM account_deletion_requests d WHERE d.id=$1`, [requestId]);
    assert.deepEqual(afterBlockedAttempt.rows[0], { status: "BLOCKED", event_count: "0", audit_count: "0" });

    const missingReason = await app.inject({
      method: "POST",
      url: `/v1/admin/account-deletions/${requestId}/decision`,
      headers: mutation(admin.token, "헤더 사유만 존재하는 요청"),
      payload: { decision: "APPROVED" },
    });
    assert.equal(missingReason.statusCode, 400, missingReason.body);

    await pool.query("UPDATE point_accounts SET balance=0 WHERE user_id=$1", [user.id]);
    const pendingApprovalSession = await issueSession(pool, config, {
      userId: user.id,
      kind: "USER",
      ip: "203.0.113.79",
      userAgent: "Dabboba Account Deletion Pending Approval Integration/1.0",
    });
    const approvalReason = "포인트와 진행 거래가 모두 해소되어 탈퇴 승인 기록";
    const approvalKey = `account-deletion-approve-${randomUUID()}`;
    const approved = await app.inject({
      method: "POST",
      url: `/v1/admin/account-deletions/${requestId}/decision`,
      headers: mutation(admin.token, approvalReason, approvalKey),
      payload: { decision: "APPROVED", reason: approvalReason },
    });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.deepEqual(
      {
        status: (approved.json() as { status: string }).status,
        hardDeletePerformed: (approved.json() as { hardDeletePerformed: boolean }).hardDeletePerformed,
        completionAvailable: (approved.json() as { completionAvailable: boolean }).completionAvailable,
      },
      { status: "APPROVED", hardDeletePerformed: false, completionAvailable: false },
    );

    const replayed = await app.inject({
      method: "POST",
      url: `/v1/admin/account-deletions/${requestId}/decision`,
      headers: mutation(admin.token, approvalReason, approvalKey),
      payload: { decision: "APPROVED", reason: approvalReason },
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.headers["x-idempotent-replay"], "true");

    const revokedPendingSession = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: auth(pendingApprovalSession.token),
    });
    assert.equal(revokedPendingSession.statusCode, 401, revokedPendingSession.body);

    const devRelogin = await app.inject({
      method: "POST",
      url: "/v1/auth/dev-session",
      payload: { email: user.email },
    });
    assert.equal(devRelogin.statusCode, 403, devRelogin.body);

    const relogin = await issueSession(pool, config, {
      userId: user.id,
      kind: "USER",
      ip: "203.0.113.78",
      userAgent: "Dabboba Account Deletion Re-request Integration/1.0",
    });
    const approvedMe = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: auth(relogin.token),
    });
    assert.equal(approvedMe.statusCode, 403, approvedMe.body);
    const approvedRerequest = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: {
        authorization: `Bearer ${relogin.token}`,
        "idempotency-key": `customer-deletion-rerequest-${randomUUID()}`,
      },
      payload: {},
    });
    assert.equal(approvedRerequest.statusCode, 403, approvedRerequest.body);

    await assert.rejects(
      pool.query(
        `INSERT INTO idempotency_keys(actor_id,scope,idempotency_key,request_hash,expires_at)
         VALUES($1,'APPROVED_ACCOUNT_MUTATION_TEST',$2,$3,now()+interval '1 hour')`,
        [user.id, `approved-mutation-${randomUUID()}`, "a".repeat(64)],
      ),
      (error: unknown) => typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "23514"
        && "constraint" in error
        && error.constraint === "account_deletion_approved_mutation_guard",
    );

    const durableState = await pool.query<{
      deletion_status: string;
      user_status: string;
      deleted_at: Date | null;
      decision_reason: string;
      event_count: string;
      audit_count: string;
      outbox_count: string;
    }>(`
      SELECT d.status AS deletion_status,u.status AS user_status,u.deleted_at,d.decision_reason,
        (SELECT count(*) FROM account_deletion_request_events e WHERE e.deletion_request_id=d.id AND e.event_type='STATUS_CHANGED') AS event_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.target_type='ACCOUNT_DELETION_REQUEST' AND a.target_id=d.id::text) AS audit_count,
        (SELECT count(*) FROM outbox_events o WHERE o.aggregate_type='ACCOUNT_DELETION_REQUEST' AND o.aggregate_id=d.id::text) AS outbox_count
      FROM account_deletion_requests d JOIN users u ON u.id=d.user_id WHERE d.id=$1`, [requestId]);
    assert.deepEqual(durableState.rows[0], {
      deletion_status: "APPROVED",
      user_status: "ACTIVE",
      deleted_at: null,
      decision_reason: approvalReason,
      event_count: "1",
      audit_count: "1",
      outbox_count: "1",
    });

    const decisionEvent = await pool.query<{ id: string; admin_actor_id: string; reason: string }>(`
      SELECT id,admin_actor_id,reason FROM account_deletion_request_events
      WHERE deletion_request_id=$1 AND event_type='STATUS_CHANGED'`, [requestId]);
    assert.deepEqual(
      { adminActorId: decisionEvent.rows[0]!.admin_actor_id, reason: decisionEvent.rows[0]!.reason },
      { adminActorId: admin.id, reason: approvalReason },
    );
    await assert.rejects(
      pool.query("UPDATE account_deletion_request_events SET reason='rewritten' WHERE id=$1", [decisionEvent.rows[0]!.id]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "55000",
    );
    await assert.rejects(
      pool.query("UPDATE account_deletion_requests SET status='REJECTED' WHERE id=$1", [requestId]),
      (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23514",
    );

    const secondUser = await createActor("USER", "deletion-rejected-owner");
    const secondRequested = await app.inject({
      method: "POST",
      url: "/v1/account/deletion-request",
      headers: { ...auth(secondUser.token), "idempotency-key": `customer-deletion-${randomUUID()}` },
      payload: {},
    });
    assert.equal(secondRequested.statusCode, 202, secondRequested.body);
    const secondRequestId = (secondRequested.json() as { id: string }).id;
    const rejectionReason = "본인 확인 보강 요청으로 현재 요청 반려";
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/admin/account-deletions/${secondRequestId}/decision`,
      headers: mutation(superAdmin.token, rejectionReason),
      payload: { decision: "REJECTED", reason: rejectionReason },
    });
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal((rejected.json() as { status: string }).status, "REJECTED");
  },
);
