import type { Actor, UserRole } from "./admin-types";

export const CAPABILITIES = [
  "dashboard.read",
  "users.manage",
  "accountDeletions.manage",
  "administrators.manage",
  "notices.manage",
  "inquiries.manage",
  "moderation.manage",
  "reports.manage",
  "exchange.manage",
  "catalog.manage",
  "catalogRequests.manage",
  "orders.read",
  "payments.read",
  "refunds.manage",
  "inventory.read",
  "inventory.adjust",
  "shipping.manage",
  "shipping.destination.read",
  "audit.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const capabilityPermissions: Record<Capability, readonly string[]> = {
  "dashboard.read": ["dashboard.read"],
  "users.manage": ["users.read", "users.suspend"],
  "accountDeletions.manage": ["account_deletions.read", "account_deletions.review"],
  "administrators.manage": ["roles.manage"],
  "notices.manage": ["notices.read", "notices.write"],
  "inquiries.manage": ["inquiries.read", "inquiries.reply"],
  "moderation.manage": ["moderation.read", "moderation.action"],
  "reports.manage": ["reports.read", "reports.resolve"],
  "exchange.manage": ["exchange.resolve"],
  "catalog.manage": ["catalog.read", "catalog.write"],
  "catalogRequests.manage": ["catalog.read", "catalog.write"],
  "orders.read": ["orders.read"],
  "payments.read": ["payments.read"],
  "refunds.manage": ["refunds.read", "refunds.review"],
  "inventory.read": ["inventory.read"],
  "inventory.adjust": ["inventory.read", "inventory.adjust"],
  "shipping.manage": ["shipping.read", "shipping.manage"],
  "shipping.destination.read": ["shipping.destination.read"],
  "audit.read": ["audit.read"],
};

export function isAdminActor(actor: Actor): actor is Actor & { role: "ADMIN" | "SUPER_ADMIN" } {
  return actor.status === "ACTIVE" && (actor.role === "ADMIN" || actor.role === "SUPER_ADMIN");
}

export function can(actor: Actor, capability: Capability) {
  return isAdminActor(actor) && capabilityPermissions[capability].every((permission) => actor.permissions.includes(permission));
}
