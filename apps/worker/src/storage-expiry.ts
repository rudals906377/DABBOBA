import type { DatabasePool } from "@dabboba/db";
import { withTransaction } from "@dabboba/db";
import type { Logger } from "./logger.js";

type ExchangeCleanupRow = {
  cancelled_listings: number | string;
  rejected_offers: number | string;
  released_inventory: number | string;
};

type StorageEventRow = {
  recorded_events: number | string;
  outbox_events: number | string;
};

export type StorageExpiryBatchResult = {
  cancelledListings: number;
  rejectedOffers: number;
  releasedExchangeInventory: number;
  heldInventory: number;
  reminders: number;
};

const EMPTY_RESULT: StorageExpiryBatchResult = {
  cancelledListings: 0,
  rejectedOffers: 0,
  releasedExchangeInventory: 0,
  heldInventory: 0,
  reminders: 0,
};

export type InventoryStorageExpiryMode = "DISABLED" | "ENABLED";

/**
 * Storage-deadline reminders, the EXPIRED_HOLD transition and the expired
 * exchange cleanup are not an approved operating policy yet (AGENTS.md: scheduled
 * reminders and automatic expiry handling remain unapproved). They stay off
 * unless an operator explicitly enables them, so turning on the every-minute
 * worker Cron does not start them.
 */
export const DEFAULT_INVENTORY_STORAGE_EXPIRY_MODE: InventoryStorageExpiryMode = "DISABLED";

export function normalizeInventoryStorageExpiryMode(value: string | undefined): InventoryStorageExpiryMode {
  const mode = value?.trim() || DEFAULT_INVENTORY_STORAGE_EXPIRY_MODE;
  if (mode !== "DISABLED" && mode !== "ENABLED") {
    throw new Error("Inventory storage expiry mode must be DISABLED or ENABLED");
  }
  return mode;
}

export const DISABLED_STORAGE_EXPIRY_RESULT: Readonly<StorageExpiryBatchResult> = Object.freeze({ ...EMPTY_RESULT });

/** Reminder milestones, in days before the storage deadline. */
export const STORAGE_REMINDER_MILESTONE_DAYS = Object.freeze([1, 3, 7, 14] as const);
/**
 * The widest reminder window. The outer WHERE is bounded by it so the planner
 * can use the storage-expiry index range instead of evaluating the lateral
 * milestone join for every stored unit, most of which are months away.
 */
export const STORAGE_REMINDER_WINDOW_DAYS = Math.max(...STORAGE_REMINDER_MILESTONE_DAYS);

function count(value: number | string | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Storage expiry query returned an invalid count");
  }
  return parsed;
}

function assertOutboxParity(row: StorageEventRow | undefined, label: string): number {
  const recorded = count(row?.recorded_events);
  const emitted = count(row?.outbox_events);
  if (recorded !== emitted) {
    throw new Error(`${label} ledger/outbox invariant failed`);
  }
  return recorded;
}

export async function processInventoryStorageExpiryBatch(
  pool: DatabasePool,
  batchSize: number,
  logger: Logger,
  now = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<StorageExpiryBatchResult> {
  if (!shouldContinue()) return { ...EMPTY_RESULT };
  const limit = Math.max(1, Math.min(Math.trunc(batchSize), 1_000));

  const result = await withTransaction(pool, async (client) => {
    if (!shouldContinue()) throw new Error("Worker run deadline reached before storage expiry cleanup");
    const exchangeCleanup = await client.query<ExchangeCleanupRow>(
      `WITH stale_listing_candidates AS MATERIALIZED (
         SELECT listing.id
           FROM exchange_listings listing
          WHERE listing.status='OPEN'
            AND (
              listing.expires_at<=$2::timestamptz
              OR EXISTS (
                SELECT 1
                  FROM exchange_listing_items item
                  JOIN inventory_units inventory ON inventory.id=item.inventory_unit_id
                 WHERE item.listing_id=listing.id
                   AND inventory.storage_expires_at<=$2::timestamptz
              )
            )
          ORDER BY listing.expires_at,listing.id
          LIMIT $1
          FOR UPDATE OF listing SKIP LOCKED
       ), expired_listings AS (
         UPDATE exchange_listings listing
            SET status='CANCELLED',cancelled_at=$2::timestamptz,cancelled_by=listing.author_id,
                cancel_reason='AUTO_EXPIRED'
           FROM stale_listing_candidates candidate
          WHERE listing.id=candidate.id AND listing.status='OPEN'
          RETURNING listing.id
       ), rejected_listing_offers AS (
         UPDATE exchange_offers offer
            SET status='REJECTED',decided_at=$2::timestamptz
          WHERE offer.status='PENDING'
            AND offer.listing_id IN (SELECT id FROM expired_listings)
          RETURNING offer.id
       ), stale_offer_candidates AS MATERIALIZED (
         SELECT offer.id
           FROM exchange_offers offer
           JOIN exchange_listings listing ON listing.id=offer.listing_id
          WHERE offer.status='PENDING'
            AND listing.status='OPEN'
            AND listing.id NOT IN (SELECT id FROM expired_listings)
            AND EXISTS (
              SELECT 1
                FROM exchange_offer_items item
                JOIN inventory_units inventory ON inventory.id=item.inventory_unit_id
               WHERE item.offer_id=offer.id
                 AND inventory.storage_expires_at<=$2::timestamptz
            )
          ORDER BY offer.created_at,offer.id
          LIMIT $1
          FOR UPDATE OF offer SKIP LOCKED
       ), rejected_expired_offers AS (
         UPDATE exchange_offers offer
            SET status='REJECTED',decided_at=$2::timestamptz
           FROM stale_offer_candidates candidate
          WHERE offer.id=candidate.id AND offer.status='PENDING'
          RETURNING offer.id
       ), rejected_offers AS (
         SELECT id FROM rejected_listing_offers
         UNION ALL
         SELECT id FROM rejected_expired_offers
       ), released_listing_items AS (
         UPDATE inventory_units inventory
            SET status='OWNED'
          WHERE inventory.status='EXCHANGE_LISTED'
            AND inventory.id IN (
              SELECT item.inventory_unit_id
                FROM exchange_listing_items item
               WHERE item.listing_id IN (SELECT id FROM expired_listings)
            )
          RETURNING inventory.id
       ), released_offer_items AS (
         UPDATE inventory_units inventory
            SET status='OWNED'
          WHERE inventory.status='EXCHANGE_OFFERED'
            AND inventory.id IN (
              SELECT item.inventory_unit_id
                FROM exchange_offer_items item
               WHERE item.offer_id IN (SELECT id FROM rejected_offers)
            )
          RETURNING inventory.id
       )
       SELECT
         (SELECT count(*)::integer FROM expired_listings) AS cancelled_listings,
         (SELECT count(*)::integer FROM rejected_offers) AS rejected_offers,
         ((SELECT count(*) FROM released_listing_items)
           +(SELECT count(*) FROM released_offer_items))::integer AS released_inventory`,
      [limit, now],
    );

    if (!shouldContinue()) throw new Error("Worker run deadline reached before storage expiry holds");
    const held = await client.query<StorageEventRow>(
      `WITH candidates AS MATERIALIZED (
         SELECT inventory.id,inventory.owner_id,inventory.storage_expires_at,
                gen_random_uuid() AS outbox_event_id
           FROM inventory_units inventory
          WHERE inventory.status='OWNED'
            AND inventory.storage_expires_at<=$2::timestamptz
          ORDER BY inventory.storage_expires_at,inventory.id
          LIMIT $1
          FOR UPDATE OF inventory SKIP LOCKED
       ), transitioned AS (
         UPDATE inventory_units inventory
            SET status='EXPIRED_HOLD'
           FROM candidates candidate
          WHERE inventory.id=candidate.id AND inventory.status='OWNED'
          RETURNING inventory.id AS inventory_unit_id,inventory.owner_id,
                    inventory.storage_expires_at,candidate.outbox_event_id
       ), recorded AS (
         INSERT INTO inventory_storage_expiry_events(
           inventory_unit_id,owner_id,storage_expires_at,event_kind,outbox_event_id
         )
         SELECT inventory_unit_id,owner_id,storage_expires_at,'EXPIRED_HOLD',outbox_event_id
           FROM transitioned
         ON CONFLICT (inventory_unit_id,storage_expires_at,event_kind) DO NOTHING
         RETURNING inventory_unit_id,owner_id,storage_expires_at,outbox_event_id
       ), emitted AS (
         INSERT INTO outbox_events(
           id,aggregate_type,aggregate_id,event_type,payload,correlation_id
         )
         SELECT outbox_event_id,'INVENTORY_UNIT',inventory_unit_id::text,
                'inventory.storage_expired_hold',
                jsonb_build_object(
                  'userId',owner_id,
                  'inventoryUnitId',inventory_unit_id,
                  'storageExpiresAt',storage_expires_at
                ),
                'worker-storage-expiry:' || outbox_event_id::text
           FROM recorded
         RETURNING id
       )
       SELECT
         (SELECT count(*)::integer FROM recorded) AS recorded_events,
         (SELECT count(*)::integer FROM emitted) AS outbox_events`,
      [limit, now],
    );
    const heldInventory = assertOutboxParity(held.rows[0], "Storage expiry hold");

    if (!shouldContinue()) throw new Error("Worker run deadline reached before storage expiry reminders");
    const reminders = await client.query<StorageEventRow>(
      `WITH candidates AS MATERIALIZED (
         SELECT inventory.id AS inventory_unit_id,inventory.owner_id,
                inventory.storage_expires_at,reminder.days AS remaining_days,
                ('REMINDER_' || reminder.days::text || 'D') AS event_kind,
                gen_random_uuid() AS outbox_event_id
           FROM inventory_units inventory
           CROSS JOIN LATERAL (
             SELECT milestone.days
               FROM unnest($3::integer[]) AS milestone(days)
              WHERE inventory.storage_expires_at
                    <= $2::timestamptz + make_interval(days => milestone.days)
              ORDER BY milestone.days
              LIMIT 1
           ) reminder
          WHERE inventory.status IN ('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED')
            AND inventory.storage_expires_at>$2::timestamptz
            AND inventory.storage_expires_at
                <= $2::timestamptz + make_interval(days => $4::integer)
            AND NOT EXISTS (
              SELECT 1
                FROM exchange_listing_items item
                JOIN exchange_listings listing ON listing.id=item.listing_id
               WHERE item.inventory_unit_id=inventory.id
                 AND listing.status='MATCHED'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM exchange_offer_items item
                JOIN exchange_offers offer ON offer.id=item.offer_id
                JOIN exchange_listings listing ON listing.id=offer.listing_id
               WHERE item.inventory_unit_id=inventory.id
                 AND offer.status='ACCEPTED'
                 AND listing.status='MATCHED'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM inventory_storage_expiry_events event
               WHERE event.inventory_unit_id=inventory.id
                 AND event.storage_expires_at=inventory.storage_expires_at
                 AND event.event_kind=('REMINDER_' || reminder.days::text || 'D')
            )
          ORDER BY inventory.storage_expires_at,inventory.id
          LIMIT $1
          FOR UPDATE OF inventory SKIP LOCKED
       ), recorded AS (
         INSERT INTO inventory_storage_expiry_events(
           inventory_unit_id,owner_id,storage_expires_at,event_kind,outbox_event_id
         )
         SELECT inventory_unit_id,owner_id,storage_expires_at,event_kind,outbox_event_id
           FROM candidates
         ON CONFLICT (inventory_unit_id,storage_expires_at,event_kind) DO NOTHING
         RETURNING inventory_unit_id,owner_id,storage_expires_at,event_kind,outbox_event_id
       ), emitted AS (
         INSERT INTO outbox_events(
           id,aggregate_type,aggregate_id,event_type,payload,correlation_id
         )
         SELECT outbox_event_id,'INVENTORY_UNIT',inventory_unit_id::text,
                'inventory.storage_expiry_reminder',
                jsonb_build_object(
                  'userId',owner_id,
                  'inventoryUnitId',inventory_unit_id,
                  'storageExpiresAt',storage_expires_at,
                  'remainingDays',substring(event_kind FROM '[0-9]+')::integer
                ),
                'worker-storage-reminder:' || outbox_event_id::text
           FROM recorded
         RETURNING id
       )
       SELECT
         (SELECT count(*)::integer FROM recorded) AS recorded_events,
         (SELECT count(*)::integer FROM emitted) AS outbox_events`,
      [limit, now, [...STORAGE_REMINDER_MILESTONE_DAYS], STORAGE_REMINDER_WINDOW_DAYS],
    );
    const reminderCount = assertOutboxParity(reminders.rows[0], "Storage expiry reminder");

    const cleanupRow = exchangeCleanup.rows[0];
    return {
      cancelledListings: count(cleanupRow?.cancelled_listings),
      rejectedOffers: count(cleanupRow?.rejected_offers),
      releasedExchangeInventory: count(cleanupRow?.released_inventory),
      heldInventory,
      reminders: reminderCount,
    };
  });

  logger.debug(result, "Inventory storage expiry lifecycle processed");
  return result;
}
