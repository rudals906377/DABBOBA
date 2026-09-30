#!/usr/bin/env node
// Fails a CI test step when `node --test` (or `tsx --test`) skipped any test
// outside an explicit, exact-name allowlist. Integration suites skip silently
// when their database URL is missing, so a zero-skip gate is what proves the
// disposable PostgreSQL tests actually ran.
//
// Usage: node scripts/check-node-test-skips.mjs <tap-file> [--allow "<exact test name>"]...

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_LINE = /^\s*(?:not )?ok \d+ - (.*?) # SKIP(?:\s.*)?$/;
const SKIP_SUMMARY = /^# skipped (\d+)\s*$/m;
const TEST_SUMMARY = /^# tests (\d+)\s*$/m;

function unescapeTapName(name) {
  return name.replace(/\\(.)/g, '$1');
}

export function findSkippedTests(tap) {
  if (!TEST_SUMMARY.test(tap) || !SKIP_SUMMARY.test(tap)) {
    throw new Error('TAP output has no node:test summary; the reporter did not run to completion.');
  }
  const skipped = tap.split(/\r?\n/)
    .map((line) => line.match(SKIP_LINE))
    .filter(Boolean)
    .map((match) => unescapeTapName(match[1]));
  const reported = Number(tap.match(SKIP_SUMMARY)[1]);
  if (reported !== skipped.length) {
    throw new Error(`TAP summary reports ${reported} skipped tests but ${skipped.length} were listed.`);
  }
  return skipped;
}

export function assertAllowedSkips(tap, allowlist = []) {
  const skipped = findSkippedTests(tap);
  const remaining = [...allowlist];
  const unexpected = [];
  for (const name of skipped) {
    const index = remaining.indexOf(name);
    if (index === -1) unexpected.push(name);
    else remaining.splice(index, 1);
  }
  if (unexpected.length > 0) {
    throw new Error(`Unexpected skipped tests (${unexpected.length}):\n${unexpected.map((name) => `  - ${name}`).join('\n')}`);
  }
  return { skipped, unusedAllowlist: remaining };
}

function parseArguments(argv) {
  const [file, ...rest] = argv;
  if (!file || file.startsWith('--')) throw new Error('A TAP file path is required.');
  const allowlist = [];
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== '--allow' || typeof rest[index + 1] !== 'string') {
      throw new Error(`Unknown argument: ${rest[index]}`);
    }
    allowlist.push(rest[index + 1]);
    index += 1;
  }
  return { file, allowlist };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const { file, allowlist } = parseArguments(process.argv.slice(2));
    const { skipped, unusedAllowlist } = assertAllowedSkips(readFileSync(file, 'utf8'), allowlist);
    for (const name of unusedAllowlist) {
      process.stderr.write(`WARN allowlisted test did not skip; remove it from the allowlist: ${name}\n`);
    }
    process.stdout.write(`Skipped-test gate passed (${skipped.length} allowlisted skip(s)).\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Skipped-test gate failed.'}\n`);
    process.exitCode = 1;
  }
}
