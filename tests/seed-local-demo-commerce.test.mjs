import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertIsolatedDemoDatabaseUrl,
  buildLocalDemoSeedSql,
  seedLocalDemoCommerce,
} from "../scripts/seed-local-demo-commerce.mjs";

const assignment = Array.from({ length: 10 }, (_, index) =>
  `(${index + 1},'da300000-0000-4000-8000-${String((index % 5) + 1).padStart(12, "0")}'::uuid)`,
).join(",\n  ");

test("local example seeding refuses every remote, default, or unmarked database", () => {
  assert.equal(
    assertIsolatedDemoDatabaseUrl("postgresql://tester:secret@127.0.0.1:55441/dabboba_flow_test_20260924"),
    "postgresql://tester:secret@127.0.0.1:55441/dabboba_flow_test_20260924",
  );
  assert.equal(
    assertIsolatedDemoDatabaseUrl("postgresql://tester:secret@127.0.0.1:55433/dabboba_flow_test_20260924"),
    "postgresql://tester:secret@127.0.0.1:55433/dabboba_flow_test_20260924",
  );
  for (const unsafe of [
    undefined,
    "postgresql://tester:secret@db.example.test:55441/dabboba_flow_test_20260924",
    "postgresql://tester:secret@127.0.0.1:5432/dabboba_flow_test_20260924",
    "postgresql://tester:secret@127.0.0.1:55441/postgres",
    "postgresql://tester:secret@127.0.0.1:55441/dabboba_development",
    "postgresql://tester:secret@127.0.0.1:55433/dabboba_development",
    "postgresql://tester:secret@127.0.0.1:55441/dabboba_flow_test_20260924?sslmode=require",
  ]) assert.throws(() => assertIsolatedDemoDatabaseUrl(unsafe));
});

test("local sample products align with TEST_PG catalog IDs and become sellable only after draw publication", async () => {
  const template = await readFile(new URL("../scripts/supabase-demo-seed.sql", import.meta.url), "utf8");
  const sql = buildLocalDemoSeedSql(template, assignment);
  assert.match(sql, /'gacha-demon-slayer-onemutan-13','DEMO-TEST-GACHA','gacha','예시상품 A \(가챠\)'/);
  assert.match(sql, /'kuji-sylvanian-adventure','DEMO-TEST-KUJI','kuji','예시상품 B \(쿠지\)'/);
  assert.match(sql, /'internalTestOnly',true,'catalogGeneration','product-photos-2026-09-10'/);
  assert.doesNotMatch(sql, /'demo-test-gacha'|'demo-test-kuji'|__DABBOBA_KUJI_ASSIGNMENTS__/);
  assert.ok(sql.indexOf("UPDATE draw_probability_versions") < sql.indexOf("SET sale_status='ON_SALE'"));
  assert.match(sql, /Local example products are not ready for TEST_PG/);
  assert.match(sql, /'local-example-gacha','예시 가챠 상품'/);
  assert.match(sql, /'local-example-kuji','예시 쿠지 상품'/);
  assert.match(sql, /Local example Home sections are incomplete/);
  assert.equal((sql.match(/DO \$\$ BEGIN/g) ?? []).length >= 2, true);
  assert.doesNotMatch(sql, /DO \$ BEGIN/);
  assert.ok(sql.trimEnd().endsWith("COMMIT;"));
  assert.throws(() => buildLocalDemoSeedSql(template.replace("__DABBOBA_KUJI_ASSIGNMENTS__", ""), assignment));
  assert.throws(() => buildLocalDemoSeedSql(template, "(1,'da300000-0000-4000-8000-000000000001'::uuid)"));
});

test("local example seeding requires explicit --run before opening a database", async () => {
  await assert.rejects(seedLocalDemoCommerce({ argv: [], env: {} }), /Explicit --run/);
  await assert.rejects(seedLocalDemoCommerce({ argv: ["--run"], env: {} }), /isolated loopback TEST database/);
});
