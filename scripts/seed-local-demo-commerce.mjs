#!/usr/bin/env node

import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createMigrationDatabasePool } from "../packages/db/dist/index.js";

const GACHA_ID = "gacha-demon-slayer-onemutan-13";
const KUJI_ID = "kuji-sylvanian-adventure";
const KUJI_POOL_IDS = Object.freeze([
  "da300000-0000-4000-8000-000000000001",
  "da300000-0000-4000-8000-000000000002",
  "da300000-0000-4000-8000-000000000003",
  "da300000-0000-4000-8000-000000000004",
  "da300000-0000-4000-8000-000000000005",
]);

export function assertIsolatedDemoDatabaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("An isolated loopback TEST database URL is required."); }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !["55433", "55441"].includes(url.port)
    || !/^\/dabboba_flow_test_[a-z0-9_]+$/.test(url.pathname)
    || !url.username || !url.password || url.search || url.hash
  ) throw new Error("Only an isolated loopback dabboba_flow_test database on an approved local port is allowed.");
  return value;
}

function replaceRequired(source, oldValue, newValue) {
  if (!source.includes(oldValue)) throw new Error("The local example fixture template is out of date.");
  return source.replaceAll(oldValue, newValue);
}

export function buildLocalDemoSeedSql(template, assignments) {
  if (typeof template !== "string" || template.split("__DABBOBA_KUJI_ASSIGNMENTS__").length !== 2
    || !template.startsWith("BEGIN;") || !template.trimEnd().endsWith("COMMIT;")) {
    throw new Error("The local example fixture template is invalid.");
  }
  const slots = typeof assignments === "string" ? assignments.split(",\n  ") : [];
  const counts = new Map(KUJI_POOL_IDS.map((id) => [id, 0]));
  if (slots.length !== 10 || slots.some((slot, index) => {
    const match = /^\((\d+),'([0-9a-f-]{36})'::uuid\)$/.exec(slot);
    if (!match || Number(match[1]) !== index + 1 || !counts.has(match[2])) return true;
    counts.set(match[2], counts.get(match[2]) + 1);
    return false;
  }) || [...counts.values()].some((count) => count !== 2)) {
    throw new Error("The sealed kuji assignment is invalid.");
  }
  let sql = template;
  sql = replaceRequired(sql, "'demo-test-gacha'", `'${GACHA_ID}'`);
  sql = replaceRequired(sql, "'demo-test-kuji'", `'${KUJI_ID}'`);
  sql = replaceRequired(sql, "'다뽀바 럭키 캡슐'", "'예시상품 A (가챠)'");
  sql = replaceRequired(sql, "'다뽀바 럭키 쿠지'", "'예시상품 B (쿠지)'");
  sql = replaceRequired(
    sql,
    "jsonb_build_object('dabbobaFixture','supabase-demo-v1','internalTestOnly',true)",
    "jsonb_build_object('dabbobaFixture','supabase-demo-v1','internalTestOnly',true,'catalogGeneration','product-photos-2026-09-10')",
  );
  sql = replaceRequired(sql, "__DABBOBA_KUJI_ASSIGNMENTS__", assignments);
  sql = sql.replace(/COMMIT;\s*$/, () => `
UPDATE catalog_products
SET sale_status='ON_SALE'
WHERE id IN ('${GACHA_ID}','${KUJI_ID}')
  AND metadata->>'dabbobaFixture'='supabase-demo-v1'
  AND sale_status='DRAFT';

DO $$ BEGIN
  IF (SELECT count(*) FROM catalog_products WHERE id IN ('${GACHA_ID}','${KUJI_ID}')
      AND sale_status='ON_SALE' AND metadata->>'dabbobaFixture'='supabase-demo-v1') <> 2
  THEN RAISE EXCEPTION 'Local example products are not ready for TEST_PG' USING ERRCODE='23505'; END IF;
END $$;

INSERT INTO home_catalog_sections
  (id,title,subtitle,ip_id,layout_kind,source_kind,visible_limit,sort_order,is_active)
VALUES
  ('local-example-gacha','예시 가챠 상품',NULL,'demo-test-ip','gacha','MANUAL',1,10,true),
  ('local-example-kuji','예시 쿠지 상품',NULL,'demo-test-ip','kuji','MANUAL',1,20,true)
ON CONFLICT DO NOTHING;

INSERT INTO home_catalog_section_products(section_id,product_id,sort_order)
VALUES
  ('local-example-gacha','${GACHA_ID}',0),
  ('local-example-kuji','${KUJI_ID}',0)
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF (SELECT count(*) FROM home_catalog_sections section
      JOIN home_catalog_section_products choice ON choice.section_id=section.id
      WHERE section.is_active=true AND section.source_kind='MANUAL'
        AND section.ip_id='demo-test-ip' AND section.visible_limit=1
        AND choice.sort_order=0
        AND ((section.id='local-example-gacha' AND section.layout_kind='gacha'
               AND choice.product_id='${GACHA_ID}')
         OR (section.id='local-example-kuji' AND section.layout_kind='kuji'
               AND choice.product_id='${KUJI_ID}'))) <> 2
  THEN RAISE EXCEPTION 'Local example Home sections are incomplete' USING ERRCODE='23505'; END IF;
END $$;

COMMIT;`);
  return sql;
}

function sealedKujiAssignments() {
  const shuffled = KUJI_POOL_IDS.flatMap((id) => [id, id]);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled.map((id, index) => `(${index + 1},'${id}'::uuid)`).join(",\n  ");
}

export async function seedLocalDemoCommerce({ argv = process.argv.slice(2), env = process.env } = {}) {
  if (argv.length !== 1 || argv[0] !== "--run") {
    throw new Error("Explicit --run is required for the isolated local example fixture.");
  }
  const databaseUrl = assertIsolatedDemoDatabaseUrl(env.DABBOBA_LOCAL_DEMO_DATABASE_URL);
  const template = await readFile(new URL("./supabase-demo-seed.sql", import.meta.url), "utf8");
  const sql = buildLocalDemoSeedSql(template, sealedKujiAssignments());
  const pool = createMigrationDatabasePool(databaseUrl, "dabboba-local-demo-fixture");
  try {
    await pool.query(sql);
    const result = await pool.query(`SELECT count(*)::integer AS ready FROM catalog_products
      WHERE id IN ($1,$2) AND sale_status='ON_SALE'
        AND metadata->>'internalTestOnly'='true'
        AND metadata->>'catalogGeneration'='product-photos-2026-09-10'`, [GACHA_ID, KUJI_ID]);
    if (result.rows[0]?.ready !== 2) throw new Error("The local example products are incomplete.");
    return { products: 2, realMoney: false, database: "isolated-loopback-test" };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedLocalDemoCommerce().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(() => {
    process.stderr.write("Local example fixture failed; inspect the isolated TEST database privately.\n");
    process.exitCode = 1;
  });
}
