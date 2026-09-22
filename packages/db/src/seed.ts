import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadApiConfig, type RuntimeEnvironment } from "@dabboba/config";
import { createDatabasePool, withTransaction } from "./index.js";

type IpSeed = {
  id: string;
  slug: string;
  nameKo: string;
  nameEn: string;
  nameJa: string;
  aliases: string[];
  description: string;
  image: string;
  isActive: boolean;
  characters: string[];
};

type ProductSeed = {
  id: string;
  ipId: string;
  categoryId: "gacha" | "figure" | "kuji" | "tcg";
  title: string;
  price: number;
  stock: number;
  asset: string;
  edition: string;
  reward: string;
};

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8")) as T;
}

export async function seedCatalog(
  databaseUrl: string,
  options: { environment?: RuntimeEnvironment; allowProductionSeed?: boolean } = {},
): Promise<{ ips: number; characters: number; products: number }> {
  const production = options.environment === "production";
  if (production && !options.allowProductionSeed) {
    throw new Error("Production catalog seed is disabled. Set DABBOBA_ALLOW_PRODUCTION_SEED=true for an explicit insert-only run.");
  }
  const ips = await readJson<IpSeed[]>("../../../src/fixtures/ip-seed.json");
  const products = await readJson<ProductSeed[]>("../../../src/fixtures/product-seed.json");
  const pool = createDatabasePool(databaseUrl, "dabboba-seed");
  try {
    await withTransaction(pool, async (client) => {
      for (const ip of ips) {
        await client.query(
          `INSERT INTO catalog_ips (id, slug, name_ko, name_en, name_ja, aliases, description, image_url, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ${production ? "ON CONFLICT (id) DO NOTHING" : `ON CONFLICT (id) DO UPDATE SET
             slug = EXCLUDED.slug, name_ko = EXCLUDED.name_ko, name_en = EXCLUDED.name_en,
             name_ja = EXCLUDED.name_ja, aliases = EXCLUDED.aliases, description = EXCLUDED.description,
             image_url = EXCLUDED.image_url, is_active = EXCLUDED.is_active, updated_at = now()`}`,
          [ip.id, ip.slug, ip.nameKo, ip.nameEn, ip.nameJa || null, ip.aliases, ip.description, ip.image, ip.isActive],
        );
        for (const character of ip.characters) {
          await client.query(
            `INSERT INTO catalog_characters (ip_id, name, aliases, is_active)
             VALUES ($1,$2,'{}',true)
             ${production ? "ON CONFLICT (ip_id, name) DO NOTHING" : `ON CONFLICT (ip_id, name) DO UPDATE SET
               is_active = true, updated_at = now()`}`,
            [ip.id, character],
          );
        }
      }
      for (const product of products) {
        await client.query(
          `INSERT INTO catalog_products
             (id, sku, ip_id, category, name, price, image_url, metadata, is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
           ${production ? "ON CONFLICT (id) DO NOTHING" : `ON CONFLICT (id) DO UPDATE SET
             sku = EXCLUDED.sku, ip_id = EXCLUDED.ip_id, category = EXCLUDED.category,
             name = EXCLUDED.name, price = EXCLUDED.price, image_url = EXCLUDED.image_url,
             metadata = EXCLUDED.metadata, updated_at = now()`}`,
          [
            product.id,
            product.id.toUpperCase(),
            product.ipId,
            product.categoryId,
            product.title,
            product.price,
            product.asset,
            { edition: product.edition, reward: product.reward },
          ],
        );
        await client.query(
          `INSERT INTO product_stock (product_id, on_hand, reserved)
           VALUES ($1,$2,0)
           ON CONFLICT (product_id) DO NOTHING`,
          [product.id, product.stock],
        );
      }
    });
  } finally {
    await pool.end();
  }
  return {
    ips: ips.length,
    characters: ips.reduce((total, ip) => total + ip.characters.length, 0),
    products: products.length,
  };
}

async function main() {
  const config = loadApiConfig();
  const result = await seedCatalog(config.databaseUrl, {
    environment: config.environment,
    allowProductionSeed: process.env.DABBOBA_ALLOW_PRODUCTION_SEED === "true",
  });
  process.stdout.write(`Seeded ${result.ips} IPs, ${result.characters} characters, and ${result.products} products.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
