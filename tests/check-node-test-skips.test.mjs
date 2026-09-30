import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertAllowedSkips, findSkippedTests } from '../scripts/check-node-test-skips.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tap = (lines, skipped) => [
  'TAP version 13',
  ...lines,
  '1..3',
  '# tests 4',
  '# pass 2',
  '# fail 0',
  `# skipped ${skipped}`,
].join('\n');

const sample = tap([
  'ok 1 - runs, with comma',
  'ok 2 - skipped \\# hash # SKIP',
  '    ok 1 - child skip # SKIP why',
  'ok 3 - parent',
], 2);

test('skipped tests are collected from nested TAP output with names unescaped', () => {
  assert.deepEqual(findSkippedTests(sample), ['skipped # hash', 'child skip']);
});

test('only exact allowlisted names may skip', () => {
  assert.deepEqual(assertAllowedSkips(sample, ['skipped # hash', 'child skip']).unusedAllowlist, []);
  assert.throws(() => assertAllowedSkips(sample, ['skipped # hash']), /Unexpected skipped tests \(1\):\n  - child skip/);
  assert.throws(() => assertAllowedSkips(sample, ['skipped']), /Unexpected skipped tests \(2\)/);
  assert.deepEqual(
    assertAllowedSkips(tap(['ok 1 - a', 'ok 2 - b', 'ok 3 - c'], 0), ['gone']).unusedAllowlist,
    ['gone'],
  );
});

test('missing or inconsistent summaries fail closed', () => {
  assert.throws(() => findSkippedTests('TAP version 13\nok 1 - a # SKIP\n'), /no node:test summary/);
  assert.throws(() => findSkippedTests(tap(['ok 1 - a'], 1)), /reports 1 skipped tests but 0/);
});

test('the CLI exits non-zero for an unexpected skip', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dabboba-tap-'));
  try {
    const file = path.join(directory, 'out.tap');
    writeFileSync(file, sample);
    const script = path.join(rootDir, 'scripts/check-node-test-skips.mjs');
    const failed = spawnSync(process.execPath, [script, file, '--allow', 'child skip'], { encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /skipped # hash/);
    const passed = spawnSync(process.execPath, [script, file, '--allow', 'child skip', '--allow', 'skipped # hash'], { encoding: 'utf8' });
    assert.equal(passed.status, 0, passed.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
