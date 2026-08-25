import type { SQLiteDatabase } from "expo-sqlite";
import type { HomeCatalogSnapshot } from "@/features/catalog/catalog-api";

const DATABASE_VERSION = 1;
const HOME_CATALOG_KEY = "home.catalog.v1";

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
    CREATE TABLE IF NOT EXISTS recent_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      searched_at TEXT NOT NULL
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
  `);
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
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
    return parsed;
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
