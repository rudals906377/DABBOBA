import type { SQLiteDatabase } from "expo-sqlite";
import type { HomeCatalogSnapshot } from "@/features/catalog/catalog-api";
import type { ExchangeCategory, ExchangeRoomSnapshot } from "@/features/exchange/exchange-api";

const DATABASE_VERSION = 4;
const HOME_CATALOG_KEY = "home.catalog.v1";
const EXCHANGE_RULES_DISMISSED_KEY = "exchange.rules.dismissed.v2";

export async function initializeLocalDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const result = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = result?.user_version ?? 0;
  if (currentVersion >= DATABASE_VERSION) return;

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS catalog_cache (
      cache_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exchange_listing_cache (
      cache_key TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recent_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      searched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recently_viewed_products (
      product_id TEXT PRIMARY KEY NOT NULL,
      viewed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS post_drafts (
      draft_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS upload_queue (
      upload_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      scope TEXT PRIMARY KEY NOT NULL,
      cursor TEXT,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_preferences (
      preference_key TEXT PRIMARY KEY NOT NULL,
      preference_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

export async function readExchangeRulesDismissed(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ preference_value: string }>(
    "SELECT preference_value FROM app_preferences WHERE preference_key = ?",
    EXCHANGE_RULES_DISMISSED_KEY,
  );
  return row?.preference_value === "dismissed";
}

export async function writeExchangeRulesDismissed(
  db: SQLiteDatabase,
  dismissed: boolean,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_preferences (preference_key, preference_value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (preference_key) DO UPDATE SET
       preference_value=excluded.preference_value,
       updated_at=excluded.updated_at`,
    EXCHANGE_RULES_DISMISSED_KEY,
    dismissed ? "dismissed" : "visible",
    new Date().toISOString(),
  );
}

function exchangeListingCacheKey(category?: ExchangeCategory): string {
  return `exchange.listings.v2.${category ?? "all"}`;
}

export async function readExchangeListingCache(
  db: SQLiteDatabase,
  category?: ExchangeCategory,
): Promise<ExchangeRoomSnapshot | null> {
  const row = await db.getFirstAsync<{ payload: string }>(
    "SELECT payload FROM exchange_listing_cache WHERE cache_key = ?",
    exchangeListingCacheKey(category),
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as ExchangeRoomSnapshot;
    if (!Array.isArray(parsed.items) || !parsed.ipNames || !parsed.fetchedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeExchangeListingCache(
  db: SQLiteDatabase,
  category: ExchangeCategory | undefined,
  snapshot: ExchangeRoomSnapshot,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO exchange_listing_cache (cache_key, payload, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at`,
    exchangeListingCacheKey(category),
    JSON.stringify(snapshot),
    snapshot.fetchedAt,
  );
}

export async function readHomeCatalogCache(
  db: SQLiteDatabase,
): Promise<HomeCatalogSnapshot | null> {
  const row = await db.getFirstAsync<{ payload: string }>(
    "SELECT payload FROM catalog_cache WHERE cache_key = ?",
    HOME_CATALOG_KEY,
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as HomeCatalogSnapshot;
    if (!Array.isArray(parsed.ips) || !Array.isArray(parsed.products) || !parsed.fetchedAt) return null;
    return { ...parsed, notices: Array.isArray(parsed.notices) ? parsed.notices : [] };
  } catch {
    return null;
  }
}

export async function writeHomeCatalogCache(
  db: SQLiteDatabase,
  snapshot: HomeCatalogSnapshot,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO catalog_cache (cache_key, payload, fetched_at)
     VALUES (?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at`,
    HOME_CATALOG_KEY,
    JSON.stringify(snapshot),
    snapshot.fetchedAt,
  );
}

export async function recordRecentlyViewedProduct(
  db: SQLiteDatabase,
  productId: string,
): Promise<void> {
  const viewedAt = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO recently_viewed_products (product_id, viewed_at)
     VALUES (?, ?)
     ON CONFLICT (product_id) DO UPDATE SET viewed_at=excluded.viewed_at`,
    productId,
    viewedAt,
  );
  await db.execAsync(`
    DELETE FROM recently_viewed_products
    WHERE product_id NOT IN (
      SELECT product_id FROM recently_viewed_products
      ORDER BY viewed_at DESC LIMIT 50
    )
  `);
}

export async function readRecentlyViewedProductIds(
  db: SQLiteDatabase,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ product_id: string }>(
    "SELECT product_id FROM recently_viewed_products ORDER BY viewed_at DESC LIMIT 50",
  );
  return rows.map((row) => row.product_id);
}
