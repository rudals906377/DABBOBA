import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ApiConfig } from "@dabboba/config";
import { createDatabasePool } from "@dabboba/db";
import { buildApp } from "../app.js";
import { acceptRequiredPoliciesForIntegrationTest } from "../integration-test-fixtures.js";
import { issueSession } from "../plugins/auth.js";

const databaseUrl = process.env.DABBOBA_TEST_DATABASE_URL;

test(
  "account notifications are owner-scoped, cursor-paged, detail-addressable, and counted after read",
  { skip: !databaseUrl, timeout: 60_000 },
  async (t) => {
    const pool = createDatabasePool(databaseUrl!, "dabboba-account-notifications-integration");
    const config: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 8788,
      databaseUrl: databaseUrl!,
      redisUrl: "redis://127.0.0.1:6379",
      webOrigins: ["http://127.0.0.1:4174"],
      adminOrigins: ["http://127.0.0.1:4180"],
      sessionTokenPepper: "account-notifications-integration-session-pepper",
      adminProxyIdentitySecret: null,
      sessionTtlDays: 1,
      paymentProvider: "UNCONFIGURED",
      paymentWebhookSecret: null,
      gcsBucket: null,
      gcsProjectId: null,
      logLevel: "silent",
    };
    const { app } = await buildApp({ config, pool, redis: null });
    const userIds: string[] = [];
    t.after(async () => {
      await pool.query("DELETE FROM notifications WHERE user_id=ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM idempotency_keys WHERE actor_id=ANY($1::uuid[])", [userIds]);
      await pool.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [userIds]);
      await app.close();
      await pool.end();
    });

    const createUser = async (label: string) => {
      const suffix = randomUUID().replaceAll("-", "");
      const created = await pool.query<{ id: string }>(
        "INSERT INTO users(email,nickname,role,status) VALUES($1,$2,'USER','ACTIVE') RETURNING id",
        [`notifications-${label}-${suffix}@example.test`, `알림 ${label}`],
      );
      const id = created.rows[0]!.id;
      userIds.push(id);
      await acceptRequiredPoliciesForIntegrationTest(pool, id);
      const session = await issueSession(pool, config, {
        userId: id,
        kind: "USER",
        ip: "203.0.113.91",
        userAgent: "Dabboba Notifications Integration/1.0",
      });
      return { id, token: session.token };
    };

    const owner = await createUser("owner");
    const stranger = await createUser("stranger");
    const inserted = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO notifications(user_id,kind,title,body,data,read_at,created_at) VALUES
        ($1,'ORDER_PAID','주문 완료','첫 알림',$2,NULL,'2026-09-20T10:00:00.000Z'),
        ($1,'DRAW_RESULT','보관 완료','두 번째 알림','{}'::jsonb,NULL,'2026-09-20T09:00:00.000Z'),
        ($1,'USER_WARNING','안내','읽은 알림','{}'::jsonb,now(),'2026-09-20T08:00:00.000Z')
       RETURNING id,created_at`,
      [owner.id, JSON.stringify({
        orderId: "../../admin",
        href: "https://attacker.example/steal",
      })],
    );
    await pool.query(
      `INSERT INTO notifications(user_id,kind,title,body,data)
       VALUES($1,'USER_WARNING','다른 사용자','보이면 안 됨','{}'::jsonb)`,
      [stranger.id],
    );
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });

    const firstPage = await app.inject({
      method: "GET",
      url: "/v1/account/notifications?limit=1",
      headers: auth(owner.token),
    });
    assert.equal(firstPage.statusCode, 200, firstPage.body);
    const first = firstPage.json() as {
      items: Array<{ id: string; destination: { route: string; detail: unknown } }>;
      nextCursor: string | null;
    };
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0]!.destination.route, "profile");
    assert.equal(first.items[0]!.destination.detail, null);
    assert.ok(first.nextCursor);
    assert.doesNotMatch(JSON.stringify(first.items[0]!.destination), /attacker\.example|href/);

    const nextPage = await app.inject({
      method: "GET",
      url: `/v1/account/notifications?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      headers: auth(owner.token),
    });
    assert.equal(nextPage.statusCode, 200, nextPage.body);
    const next = nextPage.json() as { items: Array<{ id: string }> };
    assert.equal(next.items.some((item) => item.id === first.items[0]!.id), false);
    assert.equal(next.items.length, 2);

    const notificationId = inserted.rows[0]!.id;
    const detail = await app.inject({
      method: "GET",
      url: `/v1/account/notifications/${notificationId}`,
      headers: auth(owner.token),
    });
    assert.equal(detail.statusCode, 200, detail.body);
    const hiddenFromStranger = await app.inject({
      method: "GET",
      url: `/v1/account/notifications/${notificationId}`,
      headers: auth(stranger.token),
    });
    assert.equal(hiddenFromStranger.statusCode, 404, hiddenFromStranger.body);

    const summaryBefore = await app.inject({
      method: "GET",
      url: "/v1/account/notifications/unread-summary",
      headers: auth(owner.token),
    });
    assert.deepEqual(summaryBefore.json(), {
      unreadCount: 2,
      newestUnreadCreatedAt: "2026-09-20T10:00:00.000Z",
    });

    const read = await app.inject({
      method: "POST",
      url: `/v1/account/notifications/${notificationId}/read`,
      headers: {
        ...auth(owner.token),
        "idempotency-key": `notification-read-${randomUUID()}`,
      },
    });
    assert.equal(read.statusCode, 200, read.body);
    assert.ok((read.json() as { readAt: string | null }).readAt);
    const summaryAfter = await app.inject({
      method: "GET",
      url: "/v1/account/notifications/unread-summary",
      headers: auth(owner.token),
    });
    assert.equal((summaryAfter.json() as { unreadCount: number }).unreadCount, 1);
  },
);
