import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL("../migrations/0029_worker_database_role.sql", import.meta.url),
  "utf8",
);
const leastPrivilegeMigration = readFile(
  new URL("../migrations/0031_enforce_worker_least_privilege.sql", import.meta.url),
  "utf8",
);

test("worker role migration keeps credentials out and fixes role membership options", async () => {
  const source = await migration;

  assert.match(source, /CREATE ROLE dabboba_worker/i);
  assert.match(
    source,
    /ALTER ROLE dabboba_worker[\s\S]*NOLOGIN[\s\S]*NOCREATEROLE[\s\S]*INHERIT[\s\S]*BYPASSRLS/i,
  );
  assert.match(
    source,
    /GRANT dabboba_runtime TO dabboba_worker\s+WITH ADMIN FALSE, INHERIT TRUE, SET FALSE/i,
  );
  assert.match(source, /REVOKE dabboba_worker FROM dabboba_runtime/i);
  assert.doesNotMatch(source, /PASSWORD/i);
});

test("worker role receives only the exact direct pgmq surface", async () => {
  const source = await migration;
  const signatures = [
    "send\\(text, jsonb, integer\\)",
    "send\\(text, jsonb, jsonb, timestamp with time zone\\)",
    "format_table_name\\(text, text\\)",
    "read\\(text, integer, integer, jsonb\\)",
    "delete\\(text, bigint\\)",
    "set_vt\\(text, bigint, integer\\)",
  ];

  assert.match(source, /GRANT USAGE ON SCHEMA pgmq TO dabboba_worker/i);
  for (const signature of signatures) {
    assert.match(
      source,
      new RegExp(`GRANT EXECUTE ON FUNCTION pgmq\\.${signature}\\s+TO dabboba_worker`, "i"),
    );
  }
  assert.equal(
    source.match(/GRANT EXECUTE ON FUNCTION pgmq\.[^;]+\s+TO dabboba_worker;/gi)?.length,
    signatures.length,
  );
  assert.match(
    source,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pgmq\.q_dabboba_worker TO dabboba_worker/i,
  );
  assert.match(
    source,
    /GRANT USAGE ON SEQUENCE pgmq\.q_dabboba_worker_msg_id_seq TO dabboba_worker/i,
  );
  assert.match(source, /GRANT INSERT ON TABLE public\.worker_dead_letters TO dabboba_worker/i);
  assert.doesNotMatch(
    source,
    /GRANT[^;]*ON TABLE pgmq\.(?!q_dabboba_worker\b)[a-z0-9_]+[^;]*TO dabboba_worker/i,
  );
  assert.doesNotMatch(
    source,
    /GRANT[^;]*ON SEQUENCE pgmq\.(?!q_dabboba_worker_msg_id_seq\b)[a-z0-9_]+[^;]*TO dabboba_worker/i,
  );
});

test("worker role migration removes every queue path from the API role and pgmq_public from worker", async () => {
  const source = await migration;

  assert.match(source, /REVOKE ALL ON SCHEMA pgmq FROM dabboba_runtime/i);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA pgmq FROM dabboba_runtime/i);
  assert.match(source, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA pgmq FROM dabboba_runtime/i);
  assert.match(source, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq FROM dabboba_runtime/i);
  assert.match(source, /REVOKE ALL ON TABLE public\.worker_dead_letters FROM dabboba_runtime/i);
  assert.match(source, /RAISE EXCEPTION 'dabboba_runtime retains worker queue privileges'/i);

  assert.match(source, /to_regnamespace\('pgmq_public'\)/i);
  assert.match(source, /REVOKE ALL ON SCHEMA pgmq_public FROM dabboba_worker/i);
  assert.match(source, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq_public FROM dabboba_worker/i);
  assert.match(source, /RAISE EXCEPTION 'pgmq_public remains accessible to dabboba_worker'/i);
});

test("forward worker hardening removes all memberships and normalizes an exact ACL", async () => {
  const source = await leastPrivilegeMigration;

  assert.match(source, /WHERE member\.rolname = 'dabboba_worker'/i);
  assert.match(source, /REVOKE %I FROM dabboba_worker/i);
  assert.match(
    source,
    /ALTER ROLE dabboba_worker WITH[\s\S]*NOSUPERUSER[\s\S]*NOINHERIT[\s\S]*BYPASSRLS[\s\S]*NOLOGIN/i,
  );
  assert.match(source, /IF worker_role_state IS NULL THEN[\s\S]*role is missing before least-privilege enforcement/i);
  assert.match(source, /IF worker_role_state\.rolsuper[\s\S]*EXECUTE 'ALTER ROLE dabboba_worker WITH/i);
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dabboba_worker/i);
  assert.match(source, /FOREACH privilege_name IN ARRAY/i);
  assert.match(source, /unexpected dabboba_worker %\.% privilege/i);
  assert.match(source, /point_ledger_entries', ARRAY\['INSERT'\]/i);
  assert.match(source, /worker_dead_letters', ARRAY\['INSERT'\]/i);
  assert.match(source, /dabboba_worker pgmq relation privileges are not the exact allow-list/i);
  assert.match(source, /pgmq_public is accessible to dabboba_worker/i);
  assert.match(
    source,
    /has_schema_privilege\('dabboba_worker',routine\.pronamespace,'USAGE'\)[\s\S]*has_function_privilege\('dabboba_worker',routine\.oid,'EXECUTE'\)/i,
  );
  assert.doesNotMatch(source, /PASSWORD\s+'|PASSWORD\s+\$/i);
});
