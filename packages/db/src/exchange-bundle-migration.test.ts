import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0033_exchange_bundle_items.sql", import.meta.url),
  "utf8",
);

test("exchange bundles normalize one or two inventory units while backfilling legacy primary items", async () => {
  const source = await migration;

  assert.match(source, /CREATE TABLE public\.exchange_listing_items/i);
  assert.match(source, /CREATE TABLE public\.exchange_offer_items/i);
  assert.match(source, /position smallint NOT NULL CHECK \(position BETWEEN 0 AND 1\)/i);
  assert.match(source, /PRIMARY KEY \(listing_id, inventory_unit_id\)/i);
  assert.match(source, /UNIQUE \(listing_id, position\)/i);
  assert.match(source, /PRIMARY KEY \(offer_id, inventory_unit_id\)/i);
  assert.match(source, /UNIQUE \(offer_id, position\)/i);
  assert.match(
    source,
    /INSERT INTO public\.exchange_listing_items[\s\S]*SELECT id, offered_inventory_unit_id, 0[\s\S]*FROM public\.exchange_listings/i,
  );
  assert.match(
    source,
    /INSERT INTO public\.exchange_offer_items[\s\S]*SELECT id, offered_inventory_unit_id, 0[\s\S]*FROM public\.exchange_offers/i,
  );
});

test("exchange bundle guards keep position zero compatible and active offers bounded", async () => {
  const source = await migration;

  assert.match(source, /exchange_listing_bundle_size_check/i);
  assert.match(source, /exchange_listing_primary_item_check/i);
  assert.match(source, /exchange_offer_bundle_size_check/i);
  assert.match(source, /exchange_offer_primary_item_check/i);
  assert.match(source, /DEFERRABLE INITIALLY DEFERRED/i);
  assert.match(source, /CREATE TRIGGER exchange_listings_seed_primary_item/i);
  assert.match(source, /CREATE TRIGGER exchange_offers_seed_primary_item/i);
  assert.match(
    source,
    /CREATE UNIQUE INDEX exchange_offers_one_active_bundle_per_proposer_idx[\s\S]*WHERE status IN \('PENDING', 'ACCEPTED'\)/i,
  );
  assert.doesNotMatch(source, /SECURITY DEFINER/i);
  assert.match(source, /SET search_path = pg_catalog, public/i);
});

test("exchange bundle tables remain backend-only with a minimal runtime allow-list", async () => {
  const source = await migration;

  assert.match(source, /ALTER TABLE public\.exchange_listing_items ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /ALTER TABLE public\.exchange_offer_items ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.exchange_listing_items FROM PUBLIC/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.exchange_offer_items FROM PUBLIC/i);
  assert.match(
    source,
    /GRANT SELECT, INSERT ON TABLE\s+public\.exchange_listing_items,\s+public\.exchange_offer_items\s+TO dabboba_runtime/i,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+(?:ALL|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)[^;]*exchange_(?:listing|offer)_items/i,
  );
  assert.doesNotMatch(source, /PASSWORD|DATABASE_URL|service_role\s+TO/i);
});
