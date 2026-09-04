import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0027_supabase_worker_queue.sql", import.meta.url),
  "utf8",
);
const pgmqPublicHardeningMigration = readFile(
  new URL("../migrations/0028_harden_pgmq_public.sql", import.meta.url),
  "utf8",
);
const pgmqFunctionDefaultsMigration = readFile(
  new URL("../migrations/0030_harden_pgmq_function_defaults.sql", import.meta.url),
  "utf8",
);

test("pgmq migration installs an unpinned 1.5+ extension with the required typed API", async () => {
  const source = await migration;

  assert.match(source, /^CREATE EXTENSION IF NOT EXISTS pgmq;$/im);
  assert.doesNotMatch(source, /CREATE\s+EXTENSION[^;]*\bVERSION\b/i);
  assert.match(source, /regexp_match\(installed_version, '\^\(\[0-9\]\+\)\\\.\(\[0-9\]\+\)'\)/i);
  assert.match(source, /major_version\s*=\s*1\s+AND\s+minor_version\s*<\s*5/i);

  for (const signature of [
    "pgmq.send(text,jsonb,integer)",
    "pgmq.send(text,jsonb,jsonb,timestamp with time zone)",
    "pgmq.read(text,integer,integer,jsonb)",
    "pgmq.delete(text,bigint)",
    "pgmq.set_vt(text,bigint,integer)",
    "pgmq.format_table_name(text,text)",
  ]) {
    assert.match(source, new RegExp(`to_regprocedure\\('${signature.replace(/[()]/g, "\\$&")}\\'\\)`, "i"));
  }
});

test("pgmq migration creates one durable basic queue idempotently", async () => {
  const source = await migration;

  assert.match(source, /SELECT\s+pgmq\.create\('dabboba_worker'::text\);/i);
  assert.doesNotMatch(source, /pgmq\.create_(?:unlogged|partitioned)/i);
  assert.match(
    source,
    /queue_name\s*=\s*'dabboba_worker'::text[\s\S]*is_partitioned\s*=\s*false[\s\S]*is_unlogged\s*=\s*false/i,
  );
  assert.match(source, /relpersistence\s*<>\s*'p'/i);
  assert.match(source, /ALTER TABLE pgmq\.q_dabboba_worker ENABLE ROW LEVEL SECURITY/i);
  assert.match(source, /ALTER TABLE pgmq\.a_dabboba_worker ENABLE ROW LEVEL SECURITY/i);
});

test("worker dead letters are bounded, RLS-protected, and keyed by queue message", async () => {
  const source = await migration;

  assert.match(source, /CREATE TABLE IF NOT EXISTS public\.worker_dead_letters/i);
  assert.match(source, /PRIMARY KEY \(queue_name, message_id\)/i);
  assert.match(source, /char_length\(queue_name\) BETWEEN 1 AND 47/i);
  assert.match(source, /queue_name ~ '\^\[a-z0-9_-\]\+\$'/i);
  assert.match(source, /message_id > 0/i);
  assert.match(source, /read_count BETWEEN 1 AND 1000000/i);
  assert.match(source, /octet_length\(job_payload::text\) <= 1048576/i);
  assert.match(source, /octet_length\(error_message\) <= 4096/i);
  assert.match(source, /ALTER TABLE public\.worker_dead_letters ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(source, /CREATE\s+POLICY/i);
});

test("queue privileges stay server-only and runtime grants are exact", async () => {
  const source = await migration;

  assert.match(source, /REVOKE ALL ON SCHEMA pgmq FROM PUBLIC/i);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM PUBLIC/i);
  assert.match(source, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM PUBLIC/i);
  assert.match(source, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM PUBLIC/i);
  assert.match(source, /rolname IN \('anon', 'authenticated', 'service_role'\)/i);
  assert.match(source, /'REVOKE ALL ON SCHEMA pgmq FROM %I'/i);
  assert.match(source, /'REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM %I'/i);
  assert.match(source, /'REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM %I'/i);
  assert.match(source, /'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM %I'/i);
  assert.match(source, /'REVOKE ALL ON TABLE public\.worker_dead_letters FROM %I'/i);
  assert.doesNotMatch(source, /pgmq_public/i);

  assert.match(source, /GRANT USAGE ON SCHEMA pgmq TO dabboba_runtime/i);
  const expectedFunctionSignatures = [
    "send\\(text, jsonb, integer\\)",
    "send\\(text, jsonb, jsonb, timestamp with time zone\\)",
    "format_table_name\\(text, text\\)",
    "read\\(text, integer, integer, jsonb\\)",
    "delete\\(text, bigint\\)",
    "set_vt\\(text, bigint, integer\\)",
  ];
  for (const signature of expectedFunctionSignatures) {
    assert.match(
      source,
      new RegExp(`GRANT EXECUTE ON FUNCTION pgmq\\.${signature}\\s+TO dabboba_runtime`, "i"),
    );
  }
  assert.equal(
    source.match(/GRANT EXECUTE ON FUNCTION pgmq\.[^;]+;/gi)?.length,
    expectedFunctionSignatures.length,
  );
  assert.match(
    source,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pgmq\.q_dabboba_worker TO dabboba_runtime/i,
  );
  assert.match(
    source,
    /GRANT USAGE ON SEQUENCE pgmq\.q_dabboba_worker_msg_id_seq TO dabboba_runtime/i,
  );
  assert.match(
    source,
    /GRANT INSERT ON TABLE public\.worker_dead_letters TO dabboba_runtime/i,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+(?:SELECT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)[^;]*public\.worker_dead_letters/i,
  );
  assert.doesNotMatch(
    source,
    /GRANT[^;]*ON TABLE pgmq\.(?!q_dabboba_worker\b)[a-z0-9_]+[^;]*TO dabboba_runtime/i,
  );
  assert.doesNotMatch(
    source,
    /GRANT[^;]*ON SEQUENCE pgmq\.(?!q_dabboba_worker_msg_id_seq\b)[a-z0-9_]+[^;]*TO dabboba_runtime/i,
  );
  assert.doesNotMatch(source, /GRANT\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS/i);
});

test("pgmq_public hardening follows the immutable queue migration and revokes every API path", async () => {
  const queueSource = await migration;
  const source = await pgmqPublicHardeningMigration;

  assert.doesNotMatch(queueSource, /pgmq_public/i);
  assert.match(source, /separate from 0027 because migration checksums are immutable once applied/i);
  assert.match(source, /to_regnamespace\('pgmq_public'\)/i);
  assert.match(source, /REVOKE ALL ON SCHEMA pgmq_public FROM PUBLIC/i);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA pgmq_public FROM PUBLIC/i);
  assert.match(source, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq_public FROM PUBLIC/i);
  assert.match(source, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM PUBLIC/i);
  assert.match(source, /rolname IN \('anon', 'authenticated', 'service_role', 'dabboba_runtime'\)/i);
  assert.match(source, /'REVOKE ALL ON SCHEMA pgmq_public FROM %I'/i);
  assert.match(source, /'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM %I'/i);
  assert.doesNotMatch(source, /DROP\s+(?:SCHEMA|FUNCTION|TABLE)|GRANT\s+/i);
});

test("pgmq_public hardening fails closed for PUBLIC and inherited API-role ACLs", async () => {
  const source = await pgmqPublicHardeningMigration;

  assert.match(source, /aclexplode\([\s\S]*acldefault\('n'/i);
  assert.match(source, /aclexplode\([\s\S]*acldefault\('f'/i);
  assert.match(source, /privilege\.grantee = 0/i);
  assert.match(source, /has_schema_privilege\(api_role\.rolname, pgmq_public_schema, 'USAGE'\)/i);
  assert.match(source, /has_function_privilege\(api_role\.rolname, routine\.oid, 'EXECUTE'\)/i);
  assert.match(source, /has_table_privilege\(api_role\.rolname, relation\.oid, 'SELECT'\)/i);
  assert.match(source, /has_sequence_privilege\(api_role\.rolname, sequence\.oid, 'USAGE'\)/i);
  assert.match(source, /RAISE EXCEPTION 'pgmq_public remains accessible to role %/i);
});

test("forward pgmq hardening removes current and future PUBLIC function execution", async () => {
  const source = await pgmqFunctionDefaultsMigration;

  assert.match(
    source,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA pgmq REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/i,
  );
  assert.match(source, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM PUBLIC/i);
  assert.match(
    source,
    /rolname IN \(\s*'anon',\s*'authenticated',\s*'service_role',\s*'dabboba_runtime',\s*'dabboba_worker'\s*\)/i,
  );
  assert.match(source, /aclexplode\([\s\S]*acldefault\('f'/i);
  assert.match(source, /pg_default_acl/i);
  assert.match(source, /defaclobjtype = 'f'/i);
  assert.match(source, /dabboba_worker pgmq function privileges are not the exact allow-list/i);
  assert.match(
    source,
    /has_schema_privilege\('dabboba_worker', routine\.pronamespace, 'USAGE'\)[\s\S]*has_function_privilege\('dabboba_worker', routine\.oid, 'EXECUTE'\)/i,
  );
  assert.equal(
    source.match(/GRANT EXECUTE ON FUNCTION pgmq\.[^;]+\s+TO dabboba_worker;/gi)?.length,
    6,
  );
  assert.match(source, /FROM pg_auth_members AS membership/i);
  assert.match(source, /REVOKE %I FROM dabboba_worker/i);
  assert.match(source, /ALTER ROLE dabboba_worker NOINHERIT/i);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dabboba_worker/i);
  assert.match(source, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.outbox_events TO dabboba_worker/i);
  assert.match(source, /GRANT SELECT, UPDATE ON TABLE public\.media_assets TO dabboba_worker/i);
  assert.match(source, /dabboba_worker can access unexpected public relation/i);
  assert.match(source, /dabboba_worker retains an unreviewed mutation or sequence privilege/i);
});
