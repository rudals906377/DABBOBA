export type OutboxEvent = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
};

export type WorkerJob =
  | { kind: "outbox.event"; event: OutboxEvent }
  | { kind: "reservation.sweep" }
  | { kind: "reservation.expire-order"; orderId: string }
  | { kind: "payment.reconcile" }
  | { kind: "inventory.storage-expiry" }
  | { kind: "account-auth.cleanup" }
  | { kind: "media.cleanup" }
  | { kind: "retention.sweep" }
  | { kind: "commerce.retention.sweep" };

export function parseWorkerJob(value: unknown): WorkerJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker job must be an object");
  const input = value as Record<string, unknown>;
  if (input.kind === "outbox.event") return { kind: "outbox.event", event: parseOutboxEvent(input.event) };
  if (input.kind === "reservation.sweep") return { kind: "reservation.sweep" };
  if (input.kind === "payment.reconcile") return { kind: "payment.reconcile" };
  if (input.kind === "inventory.storage-expiry") return { kind: "inventory.storage-expiry" };
  if (input.kind === "account-auth.cleanup") return { kind: "account-auth.cleanup" };
  if (input.kind === "media.cleanup") return { kind: "media.cleanup" };
  if (input.kind === "retention.sweep") return { kind: "retention.sweep" };
  if (input.kind === "commerce.retention.sweep") return { kind: "commerce.retention.sweep" };
  if (input.kind === "reservation.expire-order" && typeof input.orderId === "string" && input.orderId.length > 0) {
    return { kind: "reservation.expire-order", orderId: input.orderId };
  }
  throw new Error("Unsupported worker job payload");
}

export function parseOutboxEvent(value: unknown): OutboxEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Outbox event must be an object");
  const input = value as Record<string, unknown>;
  for (const key of ["id", "aggregateType", "aggregateId", "eventType", "correlationId", "createdAt"] as const) {
    if (typeof input[key] !== "string" || input[key].length === 0) throw new Error(`Outbox event ${key} is invalid`);
  }
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new Error("Outbox event payload must be an object");
  }
  return {
    id: input.id as string,
    aggregateType: input.aggregateType as string,
    aggregateId: input.aggregateId as string,
    eventType: input.eventType as string,
    payload: input.payload as Record<string, unknown>,
    correlationId: input.correlationId as string,
    createdAt: input.createdAt as string,
  };
}
