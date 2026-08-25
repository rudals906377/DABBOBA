import assert from "node:assert/strict";
import test from "node:test";
import type { DatabasePool } from "@dabboba/db";
import { processWorkerJob, type JobDependencies } from "./jobs.js";
import type { OutboxEvent } from "./types.js";

function outboxEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  return {
    id: "61d9ade2-3e4d-433f-a8e4-46edaa54e337",
    aggregateType: "ORDER",
    aggregateId: "50c663bd-250f-45e7-a37a-2c3550afaf9c",
    eventType: "order.paid",
    payload: { userId: "a472f9d7-244f-47eb-9b99-51255bf8c325" },
    correlationId: "request-1",
    createdAt: "2026-08-25T03:00:00.000Z",
    ...overrides,
  };
}

function canonicalRow(event: OutboxEvent) {
  return {
    id: event.id,
    aggregate_type: event.aggregateType,
    aggregate_id: event.aggregateId,
    event_type: event.eventType,
    payload: event.payload,
    correlation_id: event.correlationId,
    created_at: new Date(event.createdAt),
  };
}

test("optional opt-out skips external delivery only after the in-app notification is persisted", async () => {
  const insertedKinds: string[] = [];
  let preferenceQueries = 0;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql === "BEGIN" || sql === "COMMIT") return { rowCount: null, rows: [] };
      if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rowCount: 1, rows: [{}] };
      if (sql.startsWith("SELECT * FROM notifications")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO notifications")) {
        insertedKinds.push(String(params[1]));
        return {
          rowCount: 1,
          rows: [{
            id: `notification-${insertedKinds.length}`,
            user_id: params[0],
            kind: params[1],
            title: params[2],
            body: params[3],
            data: JSON.parse(String(params[4])) as Record<string, unknown>,
            created_at: new Date("2026-08-25T03:00:00.000Z"),
          }],
        };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("FROM outbox_events")) {
        const canonical = String(params[0]) === "exchange-event-1"
          ? outboxEvent({
            id: "exchange-event-1",
            aggregateType: "EXCHANGE_OFFER",
            aggregateId: "offer-1",
            eventType: "exchange.offer.created",
            payload: { userId: "user-1" },
            correlationId: "request-1",
          })
          : outboxEvent({
            id: "order-event-1",
            aggregateId: "order-1",
            payload: { userId: "user-1" },
            correlationId: "request-2",
            createdAt: "2026-08-25T03:01:00.000Z",
          });
        return { rowCount: 1, rows: [canonicalRow(canonical)] };
      }
      if (sql.includes("FROM notification_preferences")) {
        preferenceQueries += 1;
        return {
          rowCount: 1,
          rows: [{
            exchange_updates: false,
            request_updates: false,
            restock_updates: false,
            marketing_sms: false,
            marketing_email: false,
            marketing_push: false,
            personalized_recommendations: false,
          }],
        };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    },
  } as unknown as DatabasePool;
  const deliveredKinds: string[] = [];
  const dependencies = {
    pool,
    notificationDelivery: {
      async deliver(notification: { kind: string }) { deliveredKinds.push(notification.kind); },
    },
    logger: { debug() {} },
  } as unknown as JobDependencies;

  await processWorkerJob(dependencies, {
    kind: "outbox.event",
    event: {
      id: "exchange-event-1",
      aggregateType: "EXCHANGE_OFFER",
      aggregateId: "offer-1",
      eventType: "exchange.offer.created",
      payload: { userId: "user-1" },
      correlationId: "request-1",
      createdAt: "2026-08-25T03:00:00.000Z",
    },
  });
  assert.deepEqual(insertedKinds, ["EXCHANGE_OFFER_CREATED"]);
  assert.deepEqual(deliveredKinds, []);
  assert.equal(preferenceQueries, 1);

  await processWorkerJob(dependencies, {
    kind: "outbox.event",
    event: {
      id: "order-event-1",
      aggregateType: "ORDER",
      aggregateId: "order-1",
      eventType: "order.paid",
      payload: { userId: "user-1" },
      correlationId: "request-2",
      createdAt: "2026-08-25T03:01:00.000Z",
    },
  });
  assert.deepEqual(insertedKinds, ["EXCHANGE_OFFER_CREATED", "ORDER_PAID"]);
  assert.deepEqual(deliveredKinds, ["ORDER_PAID"]);
  assert.equal(preferenceQueries, 1);
});

test("forged outbox jobs without a canonical PostgreSQL row are rejected before processing", async () => {
  let sideEffects = 0;
  const dependencies = {
    pool: {
      async query(sql: string) {
        assert.match(sql, /FROM outbox_events/);
        return { rowCount: 0, rows: [] };
      },
      async connect() {
        sideEffects += 1;
        throw new Error("notification processing must not start");
      },
    },
    queue: { async add() { sideEffects += 1; } },
    notificationDelivery: { async deliver() { sideEffects += 1; } },
    logger: { debug() { sideEffects += 1; } },
  } as unknown as JobDependencies;
  const forged = outboxEvent({ id: "forged-event" });

  await assert.rejects(
    () => processWorkerJob(dependencies, { kind: "outbox.event", event: forged }),
    /canonical outbox event was not found/i,
  );
  assert.equal(sideEffects, 0);
});

test("outbox jobs whose Redis payload differs from PostgreSQL are rejected before processing", async () => {
  let sideEffects = 0;
  const canonical = outboxEvent();
  const dependencies = {
    pool: {
      async query(sql: string) {
        assert.match(sql, /FROM outbox_events/);
        return { rowCount: 1, rows: [canonicalRow(canonical)] };
      },
      async connect() {
        sideEffects += 1;
        throw new Error("notification processing must not start");
      },
    },
    queue: { async add() { sideEffects += 1; } },
    notificationDelivery: { async deliver() { sideEffects += 1; } },
    logger: { debug() { sideEffects += 1; } },
  } as unknown as JobDependencies;
  const mismatched = outboxEvent({ payload: { userId: "attacker-controlled-user" } });

  await assert.rejects(
    () => processWorkerJob(dependencies, { kind: "outbox.event", event: mismatched }),
    /does not match the canonical PostgreSQL event/i,
  );
  assert.equal(sideEffects, 0);
});

test("a BullMQ outbox job matching the canonical PostgreSQL event is processed", async () => {
  const canonical = outboxEvent({ eventType: "notice.published", payload: {} });
  let canonicalQueries = 0;
  const debugEntries: Array<Record<string, unknown>> = [];
  const dependencies = {
    pool: {
      async query(sql: string, params: unknown[]) {
        canonicalQueries += 1;
        assert.match(sql, /FROM outbox_events/);
        assert.deepEqual(params, [canonical.id]);
        return { rowCount: 1, rows: [canonicalRow(canonical)] };
      },
    },
    logger: { debug(fields: Record<string, unknown>) { debugEntries.push(fields); } },
  } as unknown as JobDependencies;

  await processWorkerJob(dependencies, { kind: "outbox.event", event: canonical });

  assert.equal(canonicalQueries, 1);
  assert.equal(debugEntries.length, 1);
  assert.equal(debugEntries[0]?.outboxEventId, canonical.id);
  assert.equal(debugEntries[0]?.eventType, canonical.eventType);
});
