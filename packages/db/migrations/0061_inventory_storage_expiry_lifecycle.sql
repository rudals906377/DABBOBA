-- Stored inventory is never discarded automatically. The finite worker moves
-- only expired, freely-owned inventory into an explicit hold state after
-- resolving stale open exchange reservations, and records every reminder or
-- hold transition before it emits the corresponding outbox event.

ALTER TABLE public.inventory_units
DROP CONSTRAINT inventory_units_status_check;

ALTER TABLE public.inventory_units
ADD CONSTRAINT inventory_units_status_check
CHECK (status IN (
  'OWNED',
  'EXCHANGE_LISTED',
  'EXCHANGE_OFFERED',
  'SHIPPING',
  'DELIVERED',
  'TRANSFERRED',
  'REFUNDED',
  'POINT_RETURNED',
  'EXPIRED_HOLD'
)) NOT VALID;

ALTER TABLE public.inventory_units
VALIDATE CONSTRAINT inventory_units_status_check;

CREATE TABLE public.inventory_storage_expiry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_unit_id uuid NOT NULL REFERENCES public.inventory_units(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  storage_expires_at timestamptz NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN (
    'REMINDER_14D',
    'REMINDER_7D',
    'REMINDER_3D',
    'REMINDER_1D',
    'EXPIRED_HOLD'
  )),
  outbox_event_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inventory_unit_id, storage_expires_at, event_kind),
  CONSTRAINT inventory_storage_expiry_events_outbox_fk
    FOREIGN KEY (outbox_event_id) REFERENCES public.outbox_events(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX inventory_storage_expiry_events_owner_idx
ON public.inventory_storage_expiry_events (owner_id, created_at DESC, id DESC);

CREATE TRIGGER inventory_storage_expiry_events_immutable
BEFORE UPDATE OR DELETE ON public.inventory_storage_expiry_events
FOR EACH ROW EXECUTE FUNCTION public.reject_row_mutation();

ALTER TABLE public.inventory_storage_expiry_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.inventory_storage_expiry_events
FROM PUBLIC, anon, authenticated, dabboba_runtime, dabboba_worker;
GRANT SELECT, INSERT ON TABLE public.inventory_storage_expiry_events TO dabboba_worker;

-- The worker receives only the columns and bundle membership needed to unwind
-- stale OPEN exchanges before an OWNED unit is placed on expiry hold. MATCHED
-- exchanges and SHIPPING inventory are intentionally outside these grants and
-- transition predicates.
GRANT SELECT ON TABLE
  public.exchange_listing_items,
  public.exchange_offer_items
TO dabboba_worker;

GRANT UPDATE (status) ON TABLE public.inventory_units TO dabboba_worker;
GRANT UPDATE (status, cancelled_at, cancelled_by, cancel_reason)
ON TABLE public.exchange_listings TO dabboba_worker;
GRANT UPDATE (status, decided_at)
ON TABLE public.exchange_offers TO dabboba_worker;

COMMENT ON TABLE public.inventory_storage_expiry_events IS
  'Append-only deduplication ledger for 14/7/3/1-day storage reminders and non-destructive expiry holds.';
COMMENT ON COLUMN public.inventory_storage_expiry_events.outbox_event_id IS
  'Outbox event created atomically with this milestone; the deferred foreign key permits ledger-first deduplication.';
