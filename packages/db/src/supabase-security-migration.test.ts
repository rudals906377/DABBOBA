import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const bootstrapMigration = readFile(
  new URL("../migrations/0000_backend_only_access.sql", import.meta.url),
  "utf8",
);
const rlsMigration = readFile(
  new URL("../migrations/0024_backend_only_rls.sql", import.meta.url),
  "utf8",
);
const advisorHardeningMigration = readFile(
  new URL("../migrations/0025_supabase_security_advisor_hardening.sql", import.meta.url),
  "utf8",
);
const runtimeRoleMigration = readFile(
  new URL("../migrations/0026_runtime_database_role.sql", import.meta.url),
  "utf8",
);

type SqlToken = {
  kind: "word" | "quoted-identifier" | "symbol";
  value: string;
};

type PublicRelationEvent = {
  key: string;
  name: string;
  tokenIndex: number;
};

const backendOnlyApiRoles = new Set(["public", "anon", "authenticated", "service_role"]);
const reviewedDynamicSqlMigrations = new Set([
  "0025_supabase_security_advisor_hardening.sql",
  "0027_supabase_worker_queue.sql",
  "0028_harden_pgmq_public.sql",
  "0029_worker_database_role.sql",
  "0030_harden_pgmq_function_defaults.sql",
  "0031_enforce_worker_least_privilege.sql",
  "0032_worker_payment_reconciliation_schedule.sql",
  "0034_home_catalog_sections.sql",
  "0042_storefront_category_settings.sql",
  "0045_home_product_click_events.sql",
]);

function tokenizeSql(source: string, includeDollarQuotedBodies = false): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index]!;
    const next = source[index + 1];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === "-" && next === "-") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === "/" && source[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (source[index] === "*" && source[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (character === "'") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\" && source[index + 1] !== undefined) {
          index += 2;
        } else if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }

    if (character === "$") {
      const dollarTag = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (dollarTag) {
        const closingIndex = source.indexOf(dollarTag, index + dollarTag.length);
        if (includeDollarQuotedBodies && closingIndex !== -1) {
          tokens.push(
            ...tokenizeSql(
              source.slice(index + dollarTag.length, closingIndex),
              includeDollarQuotedBodies,
            ),
          );
        }
        index = closingIndex === -1 ? source.length : closingIndex + dollarTag.length;
        continue;
      }
    }

    if (character === '"') {
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          value += '"';
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      tokens.push({ kind: "quoted-identifier", value });
      continue;
    }

    if (/[A-Za-z_\u0080-\uFFFF]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(source[index]!)) {
        index += 1;
      }
      tokens.push({ kind: "word", value: source.slice(start, index) });
      continue;
    }

    tokens.push({ kind: "symbol", value: character });
    index += 1;
  }

  return tokens;
}

function isKeyword(token: SqlToken | undefined, keyword: string): boolean {
  return token?.kind === "word" && token.value.toUpperCase() === keyword;
}

function normalizedIdentifier(token: SqlToken): string {
  return token.kind === "quoted-identifier" ? token.value : token.value.toLowerCase();
}

function readRelation(
  tokens: SqlToken[],
  startIndex: number,
): { schema: string; table: string; nextIndex: number } | null {
  const first = tokens[startIndex];
  if (!first || first.kind === "symbol") return null;

  if (tokens[startIndex + 1]?.value === ".") {
    const second = tokens[startIndex + 2];
    if (!second || second.kind === "symbol") return null;
    return {
      schema: normalizedIdentifier(first),
      table: normalizedIdentifier(second),
      nextIndex: startIndex + 3,
    };
  }

  return {
    schema: "public",
    table: normalizedIdentifier(first),
    nextIndex: startIndex + 1,
  };
}

function relationEvent(
  relation: { schema: string; table: string },
  tokenIndex: number,
): PublicRelationEvent | null {
  if (relation.schema !== "public") return null;
  return {
    key: JSON.stringify([relation.schema, relation.table]),
    name: `${relation.schema}.${relation.table}`,
    tokenIndex,
  };
}

function statementEnd(tokens: SqlToken[], startIndex: number): number {
  const end = tokens.findIndex((token, index) => index >= startIndex && token.value === ";");
  return end === -1 ? tokens.length : end;
}

function containsKeywordSequence(
  tokens: SqlToken[],
  startIndex: number,
  endIndex: number,
  keywords: string[],
): boolean {
  for (let index = startIndex; index <= endIndex - keywords.length; index += 1) {
    if (keywords.every((keyword, offset) => isKeyword(tokens[index + offset], keyword))) {
      return true;
    }
  }
  return false;
}

function assertPostRlsMigrationIsBackendOnly(file: string, source: string): void {
  const tokens = tokenizeSql(source);
  const securityTokens = tokenizeSql(source, true);
  const createdTables: PublicRelationEvent[] = [];
  const rlsEnables: PublicRelationEvent[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (isKeyword(tokens[index], "CREATE")) {
      let cursor = index + 1;
      if (isKeyword(tokens[cursor], "UNLOGGED")) cursor += 1;

      if (isKeyword(tokens[cursor], "TABLE")) {
        cursor += 1;
        if (
          isKeyword(tokens[cursor], "IF")
          && isKeyword(tokens[cursor + 1], "NOT")
          && isKeyword(tokens[cursor + 2], "EXISTS")
        ) {
          cursor += 3;
        }
        const relation = readRelation(tokens, cursor);
        assert.ok(relation, `${file} contains a CREATE TABLE target that cannot be audited`);
        const event = relationEvent(relation, index);
        if (event) createdTables.push(event);
      }
    }

    if (isKeyword(tokens[index], "ALTER") && isKeyword(tokens[index + 1], "TABLE")) {
      let cursor = index + 2;
      if (isKeyword(tokens[cursor], "IF") && isKeyword(tokens[cursor + 1], "EXISTS")) {
        cursor += 2;
      }
      if (isKeyword(tokens[cursor], "ONLY")) cursor += 1;
      const relation = readRelation(tokens, cursor);
      if (!relation) continue;

      const end = statementEnd(tokens, relation.nextIndex);
      if (containsKeywordSequence(tokens, relation.nextIndex, end, ["ENABLE", "ROW", "LEVEL", "SECURITY"])) {
        const event = relationEvent(relation, index);
        if (event) rlsEnables.push(event);
      }
    }
  }

  for (let index = 0; index < securityTokens.length; index += 1) {
    if (
      isKeyword(securityTokens[index], "EXECUTE")
      && !isKeyword(securityTokens[index + 1], "FUNCTION")
      && !isKeyword(securityTokens[index + 1], "PROCEDURE")
      && !isKeyword(securityTokens[index + 1], "ON")
      && !reviewedDynamicSqlMigrations.has(file)
    ) {
      assert.fail(`${file} contains dynamic SQL that cannot be audited safely`);
    }

    if (isKeyword(securityTokens[index], "CREATE") && isKeyword(securityTokens[index + 1], "POLICY")) {
      assert.fail(`${file} creates an RLS policy in the backend-only database`);
    }

    if (containsKeywordSequence(
      securityTokens,
      index,
      Math.min(index + 4, securityTokens.length),
      ["DISABLE", "ROW", "LEVEL", "SECURITY"],
    )) {
      assert.fail(`${file} disables RLS in the backend-only database`);
    }

    if (isKeyword(securityTokens[index], "GRANT")) {
      const end = statementEnd(securityTokens, index + 1);
      const toIndex = securityTokens.findIndex(
        (token, tokenIndex) => tokenIndex > index && tokenIndex < end && isKeyword(token, "TO"),
      );
      if (toIndex !== -1) {
        for (let cursor = toIndex + 1; cursor < end; cursor += 1) {
          const token = securityTokens[cursor]!;
          if (token.kind !== "symbol" && backendOnlyApiRoles.has(normalizedIdentifier(token))) {
            assert.fail(`${file} grants database access to ${normalizedIdentifier(token)}`);
          }
        }
      }
    }
  }

  for (const createdTable of createdTables) {
    assert.ok(
      rlsEnables.some(
        (rlsEnable) => rlsEnable.key === createdTable.key && rlsEnable.tokenIndex > createdTable.tokenIndex,
      ),
      `${file} creates ${createdTable.name} without subsequently enabling RLS`,
    );
  }
}

test("backend-only bootstrap removes Data API privileges before app tables are created", async () => {
  const source = await bootstrapMigration;

  assert.match(source, /REVOKE ALL ON SCHEMA public FROM PUBLIC/i);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC/i);
  assert.match(source, /rolname IN \('anon', 'authenticated', 'service_role'\)/i);
  assert.match(source, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON TABLES FROM PUBLIC/i);
  assert.match(source, /ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/i);
  assert.doesNotMatch(
    source,
    /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS/i,
  );
  assert.doesNotMatch(source, /GRANT[\s\S]*(?:anon|authenticated|service_role)/i);
});

test("backend-only RLS migration protects every public table", async () => {
  const source = await rlsMigration;

  assert.match(source, /pg_class/);
  assert.match(source, /relkind IN \('r', 'p'\)/);
  assert.match(source, /ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /rolname IN \('anon', 'authenticated', 'service_role'\)/i);
  assert.doesNotMatch(
    source,
    /CREATE POLICY|GRANT[\s\S]*(?:anon|authenticated|service_role)/i,
  );
});

test("Supabase advisor hardening relocates extensions and fixes function search paths", async () => {
  const source = await advisorHardeningMigration;

  assert.match(source, /ALTER EXTENSION %I SET SCHEMA extensions/i);
  assert.match(source, /ALTER FUNCTION[\s\S]*SET search_path = public, extensions, pg_temp/i);
  assert.match(source, /IF hardened_count <> 21/i);
  assert.doesNotMatch(source, /SECURITY DEFINER/i);
});

test("runtime role is DML-only and keeps login credentials out of migrations", async () => {
  const source = await runtimeRoleMigration;

  assert.match(source, /CREATE ROLE dabboba_runtime/i);
  assert.match(source, /ALTER ROLE dabboba_runtime[\s\S]*NOLOGIN[\s\S]*NOCREATEROLE[\s\S]*BYPASSRLS/i);
  assert.match(source, /GRANT USAGE ON SCHEMA public TO dabboba_runtime/i);
  assert.match(source, /GRANT SELECT ON TABLE[\s\S]*public\.users[\s\S]*TO dabboba_runtime/i);
  assert.match(source, /GRANT INSERT ON TABLE[\s\S]*public\.admin_login_events[\s\S]*TO dabboba_runtime/i);
  assert.match(source, /GRANT UPDATE ON TABLE[\s\S]*public\.orders[\s\S]*TO dabboba_runtime/i);
  assert.match(source, /GRANT DELETE ON TABLE[\s\S]*public\.wishlist_items[\s\S]*TO dabboba_runtime/i);
  assert.match(source, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM dabboba_runtime/i);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.default_notification_preference_state\(integer\)/i);
  assert.match(source, /GRANT EXECUTE ON FUNCTION extensions\.citext_eq\(extensions\.citext, extensions\.citext\)/i);
  assert.doesNotMatch(source, /PASSWORD/i);
  assert.doesNotMatch(source, /GRANT\s+(?:CREATE|TRUNCATE|TRIGGER|REFERENCES|ALL)|ALTER DEFAULT PRIVILEGES/i);
});

test("migrations after the blanket RLS migration cannot add an unprotected table", async () => {
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  for (const file of files.filter((name) => name > "0024_backend_only_rls.sql")) {
    const source = await readFile(new URL(file, migrationDirectory), "utf8");
    assertPostRlsMigrationIsBackendOnly(file, source);
  }
});

test("post-RLS migration guard recognizes quoted, qualified, unlogged, and CTAS tables", () => {
  assert.doesNotThrow(() => assertPostRlsMigrationIsBackendOnly("safe.sql", `
    CREATE UNLOGGED TABLE "public"."AuditTrail" (id bigint);
    ALTER TABLE ONLY "public"."AuditTrail" ENABLE ROW LEVEL SECURITY;

    CREATE TABLE public.snapshot AS SELECT 1 AS id;
    ALTER TABLE public.snapshot ENABLE ROW LEVEL SECURITY;

    CREATE TABLE "MixedCase" (id bigint);
    ALTER TABLE "MixedCase" ENABLE ROW LEVEL SECURITY;

    CREATE TABLE private.internal_only (id bigint);
    CREATE TRIGGER keep_updated_at BEFORE UPDATE ON public.snapshot
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    -- GRANT SELECT ON public.snapshot TO anon;
    SELECT 'CREATE POLICY ignored text';
  `));
});

test("post-RLS migration guard rejects backend-only access regressions", () => {
  const unsafeMigrations = [
    "CREATE TABLE public.unprotected (id bigint);",
    'CREATE TABLE "public"."QuotedTable" (id bigint);',
    "CREATE UNLOGGED TABLE public.audit_log (id bigint);",
    "CREATE TABLE public.snapshot AS SELECT 1 AS id;",
    "ALTER TABLE ONLY public.users DISABLE ROW LEVEL SECURITY;",
    "GRANT SELECT ON ALL TABLES IN SCHEMA public TO PUBLIC;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;",
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO internal_worker, "service_role";',
    "CREATE POLICY open_access ON public.users TO anon USING (true);",
    "DO $guard$ BEGIN EXECUTE 'DROP TABLE public.users'; END $guard$;",
    "DO $guard$ BEGIN EXECUTE 'GR' || 'ANT SELECT ON public.users TO anon'; END $guard$;",
    `CREATE TABLE public.comment_spoof (id bigint);
     -- ALTER TABLE public.comment_spoof ENABLE ROW LEVEL SECURITY;`,
  ];

  for (const source of unsafeMigrations) {
    assert.throws(() => assertPostRlsMigrationIsBackendOnly("unsafe.sql", source));
  }
});
