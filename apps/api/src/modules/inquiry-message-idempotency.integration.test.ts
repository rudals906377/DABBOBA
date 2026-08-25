import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "customer follow-ups and admin inquiry replies replay one durable message per idempotency key",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-inquiry-message-idempotency-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "inquiry-message-idempotency-integration-pepper",
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
    const createActor = async (role: "USER" | "ADMIN", label: string) => {
      const user = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id",
        [`${label}-${suffix}@example.test`, `${label} ${suffix}`, role],
      );
      const session = await issueSession(pool, config, {
        userId: user.rows[0]!.id,
        kind: role === "USER" ? "USER" : "ADMIN",
        ip: "203.0.113.91",
        userAgent: "Dabboba Inquiry Idempotency Integration/1.0",
      });
      return { id: user.rows[0]!.id, token: session.token };
    };

    const owner = await createActor("USER", "inquiry-owner");
    const otherUser = await createActor("USER", "inquiry-other");
    const admin = await createActor("ADMIN", "inquiry-admin");
    const inquiry = await pool.query<{ id: string }>(
      "INSERT INTO inquiries(user_id,category,title) VALUES($1,'PRODUCT',$2) RETURNING id",
      [owner.id, `멱등 문의 ${suffix}`],
    );
    const inquiryId = inquiry.rows[0]!.id;
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });

    const customerKey = `inquiry-followup-${randomUUID()}`;
    const customerPayload = { content: "상품 상태를 다시 확인해 주세요.", mediaIds: [] };
    const customerMessage = await app.inject({
      method: "POST",
      url: `/v1/inquiries/${inquiryId}/messages`,
      headers: { ...auth(owner.token), "idempotency-key": customerKey },
      payload: customerPayload,
    });
    assert.equal(customerMessage.statusCode, 201, customerMessage.body);
    const customerMessageId = (customerMessage.json() as { id: string }).id;

    const customerReplay = await app.inject({
      method: "POST",
      url: `/v1/inquiries/${inquiryId}/messages`,
      headers: { ...auth(owner.token), "idempotency-key": customerKey },
      payload: customerPayload,
    });
    assert.equal(customerReplay.statusCode, 201, customerReplay.body);
    assert.equal(customerReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(customerReplay.json(), customerMessage.json());

    const changedCustomerPayload = await app.inject({
      method: "POST",
      url: `/v1/inquiries/${inquiryId}/messages`,
      headers: { ...auth(owner.token), "idempotency-key": customerKey },
      payload: { ...customerPayload, content: "같은 키의 다른 본문입니다." },
    });
    assert.equal(changedCustomerPayload.statusCode, 409, changedCustomerPayload.body);

    const deniedOtherUser = await app.inject({
      method: "POST",
      url: `/v1/inquiries/${inquiryId}/messages`,
      headers: { ...auth(otherUser.token), "idempotency-key": `inquiry-followup-${randomUUID()}` },
      payload: { content: "다른 회원이 추가할 수 없어야 합니다.", mediaIds: [] },
    });
    assert.equal(deniedOtherUser.statusCode, 404, deniedOtherUser.body);

    const invalidMediaKey = `inquiry-followup-media-${randomUUID()}`;
    const invalidMedia = await app.inject({
      method: "POST",
      url: `/v1/inquiries/${inquiryId}/messages`,
      headers: { ...auth(owner.token), "idempotency-key": invalidMediaKey },
      payload: { content: "소유하지 않은 첨부는 거부되어야 합니다.", mediaIds: [randomUUID()] },
    });
    assert.equal(invalidMedia.statusCode, 400, invalidMedia.body);
    const failedReservation = await pool.query<{ count: string }>(
      "SELECT count(*) FROM idempotency_keys WHERE actor_id=$1 AND scope='CREATE_INQUIRY_USER_MESSAGE' AND idempotency_key=$2",
      [owner.id, invalidMediaKey],
    );
    assert.equal(failedReservation.rows[0]!.count, "0");

    const answerReason = "고객 문의 확인 후 운영 답변 등록";
    const adminKey = `admin-inquiry-reply-${randomUUID()}`;
    const adminHeaders = (reason = answerReason) => ({
      ...auth(admin.token),
      "idempotency-key": adminKey,
      "x-admin-reason": reason,
    });
    const adminPayload = {
      content: "확인 결과 정상 상태이며 이용 가능합니다.",
      status: "ANSWERED",
      isInternal: false,
      mediaIds: [],
    };
    const answer = await app.inject({
      method: "POST",
      url: `/v1/admin/inquiries/${inquiryId}/messages`,
      headers: adminHeaders(),
      payload: adminPayload,
    });
    assert.equal(answer.statusCode, 201, answer.body);
    const answerId = (answer.json() as { id: string }).id;

    const answerReplay = await app.inject({
      method: "POST",
      url: `/v1/admin/inquiries/${inquiryId}/messages`,
      headers: adminHeaders(),
      payload: adminPayload,
    });
    assert.equal(answerReplay.statusCode, 201, answerReplay.body);
    assert.equal(answerReplay.headers["x-idempotent-replay"], "true");
    assert.deepEqual(answerReplay.json(), answer.json());

    const changedAnswer = await app.inject({
      method: "POST",
      url: `/v1/admin/inquiries/${inquiryId}/messages`,
      headers: adminHeaders(),
      payload: { ...adminPayload, content: "같은 키의 다른 관리자 답변입니다." },
    });
    assert.equal(changedAnswer.statusCode, 409, changedAnswer.body);

    const changedReason = await app.inject({
      method: "POST",
      url: `/v1/admin/inquiries/${inquiryId}/messages`,
      headers: adminHeaders("같은 키에 다른 감사 사유를 사용할 수 없습니다."),
      payload: adminPayload,
    });
    assert.equal(changedReason.statusCode, 409, changedReason.body);

    const state = await pool.query<{
      status: string;
      customer_message_count: string;
      admin_message_count: string;
      user_outbox_count: string;
      answer_outbox_count: string;
      audit_count: string;
      completed_keys: string;
    }>(`
      SELECT i.status,
        (SELECT count(*) FROM inquiry_messages m WHERE m.inquiry_id=i.id AND m.author_role='USER') AS customer_message_count,
        (SELECT count(*) FROM inquiry_messages m WHERE m.inquiry_id=i.id AND m.author_role IN ('ADMIN','SUPER_ADMIN')) AS admin_message_count,
        (SELECT count(*) FROM outbox_events o WHERE o.aggregate_id=i.id::text AND o.event_type='inquiry.user_replied') AS user_outbox_count,
        (SELECT count(*) FROM outbox_events o WHERE o.aggregate_id=i.id::text AND o.event_type='inquiry.answered') AS answer_outbox_count,
        (SELECT count(*) FROM admin_audit_logs a WHERE a.target_type='INQUIRY' AND a.target_id=i.id::text AND a.action='INQUIRY_ANSWERED') AS audit_count,
        (SELECT count(*) FROM idempotency_keys k WHERE k.state='COMPLETED' AND k.resource_type='INQUIRY_MESSAGE' AND k.resource_id IN ($2,$3)) AS completed_keys
      FROM inquiries i WHERE i.id=$1`, [inquiryId, customerMessageId, answerId]);
    assert.deepEqual(state.rows[0], {
      status: "ANSWERED",
      customer_message_count: "1",
      admin_message_count: "1",
      user_outbox_count: "1",
      answer_outbox_count: "1",
      audit_count: "1",
      completed_keys: "2",
    });
  },
);
