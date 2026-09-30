import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DATABASE_RELEASE_MIGRATIONS,
  checkDatabaseReleaseSource,
} from '../scripts/check-database-release-source.mjs';

const repositoryRoot = new URL('../', import.meta.url);

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

async function releaseRepository({ omit = [], mutate = null } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-release-source-'));
  await mkdir(join(directory, 'packages/db/migrations'), { recursive: true });
  await mkdir(join(directory, 'apps/api/src'), { recursive: true });
  await mkdir(join(directory, 'apps/worker/src'), { recursive: true });
  const migrationDirectory = new URL('packages/db/migrations/', repositoryRoot);
  const migrations = (await readdir(migrationDirectory))
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file) && Number(file.slice(0, 4)) <= 77)
    .sort();
  for (const file of migrations) {
    if (omit.includes(file)) continue;
    const path = `packages/db/migrations/${file}`;
    const source = await readFile(new URL(path, repositoryRoot), 'utf8');
    await writeFile(join(directory, path), mutate === file ? `${source}\n-- changed\n` : source);
  }
  await writeFile(join(directory, 'apps/api/src/app.ts'), 'export const apiVersion = 1;\n');
  await writeFile(join(directory, 'apps/worker/src/runner.ts'), 'export const workerVersion = 1;\n');
  git(directory, 'init', '--quiet');
  git(directory, 'config', 'user.email', 'release-source@example.test');
  git(directory, 'config', 'user.name', 'Release Source Test');
  git(directory, 'add', '.');
  git(directory, 'commit', '--quiet', '-m', 'release source fixture');
  return directory;
}

test('release source accepts a clean Git commit containing every reviewed release migration through 0077', async () => {
  const directory = await releaseRepository();
  try {
    const report = checkDatabaseReleaseSource({ repositoryRoot: directory });
    assert.equal(report.status, 'pass', JSON.stringify(report));
    assert.equal(report.latestMigration, '0077_session_scope.sql');
    assert.deepEqual(report.blockers, []);
    assert.match(report.head, /^[0-9a-f]{40,64}$/);
    assert.equal(report.worktreeClean, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release source blocks tracked, staged, and untracked deploy-relevant files outside migrations', async () => {
  const tracked = await releaseRepository();
  const staged = await releaseRepository();
  const untracked = await releaseRepository();
  try {
    await writeFile(join(tracked, 'apps/api/src/app.ts'), 'export const apiVersion = 2;\n');
    await writeFile(join(staged, 'apps/worker/src/runner.ts'), 'export const workerVersion = 2;\n');
    git(staged, 'add', 'apps/worker/src/runner.ts');
    await writeFile(join(untracked, 'apps/api/src/uncommitted-release.ts'), 'export const release = true;\n');

    for (const directory of [tracked, staged, untracked]) {
      const report = checkDatabaseReleaseSource({ repositoryRoot: directory });
      assert.equal(report.status, 'blocked');
      assert.equal(report.worktreeClean, false);
      assert.ok(report.blockers.includes('repository_worktree_not_clean'));
    }
  } finally {
    await Promise.all([
      rm(tracked, { recursive: true, force: true }),
      rm(staged, { recursive: true, force: true }),
      rm(untracked, { recursive: true, force: true }),
    ]);
  }
});

test('release source blocks an uncommitted required migration even when its bytes still match', async () => {
  const directory = await releaseRepository();
  try {
    await writeFile(
      join(directory, DATABASE_RELEASE_MIGRATIONS[1].path),
      await readFile(new URL(DATABASE_RELEASE_MIGRATIONS[1].path, repositoryRoot), 'utf8'),
    );
    await writeFile(join(directory, DATABASE_RELEASE_MIGRATIONS[1].path), `${await readFile(join(directory, DATABASE_RELEASE_MIGRATIONS[1].path), 'utf8')}\n`);
    const report = checkDatabaseReleaseSource({ repositoryRoot: directory });
    assert.equal(report.status, 'blocked');
    assert.ok(report.blockers.includes('required_migration_worktree_not_clean:0050_shipping_fee_policy.sql'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release source blocks a missing or checksum-rotated required migration', async () => {
  const missing = await releaseRepository({ omit: ['0068_worker_account_deletion_privileges.sql'] });
  const changed = await releaseRepository({ mutate: '0054_catalog_sale_status_and_prelaunch.sql' });
  try {
    const missingReport = checkDatabaseReleaseSource({ repositoryRoot: missing });
    assert.equal(missingReport.status, 'blocked');
    assert.ok(missingReport.blockers.includes('required_migration_not_committed:0068_worker_account_deletion_privileges.sql'));
    assert.ok(missingReport.blockers.includes('committed_migration_sequence_incomplete:0068'));

    const changedReport = checkDatabaseReleaseSource({ repositoryRoot: changed });
    assert.equal(changedReport.status, 'blocked');
    assert.ok(changedReport.blockers.includes('required_migration_checksum_mismatch:0054_catalog_sale_status_and_prelaunch.sql'));
  } finally {
    await Promise.all([
      rm(missing, { recursive: true, force: true }),
      rm(changed, { recursive: true, force: true }),
    ]);
  }
});

test('release source rejects a release missing the business-phone policy migration', async () => {
  const directory = await releaseRepository({ omit: ['0076_legal_policy_business_phone.sql'] });
  try {
    const report = checkDatabaseReleaseSource({ repositoryRoot: directory });
    assert.equal(report.status, 'blocked');
    assert.ok(report.blockers.includes('required_migration_not_committed:0076_legal_policy_business_phone.sql'));
    assert.ok(report.blockers.includes('latest_committed_migration_below_0077'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release source rejects a release missing the session-scope migration', async () => {
  const directory = await releaseRepository({ omit: ['0077_session_scope.sql'] });
  try {
    const report = checkDatabaseReleaseSource({ repositoryRoot: directory });
    assert.equal(report.status, 'blocked');
    assert.ok(report.blockers.includes('required_migration_not_committed:0077_session_scope.sql'));
    assert.ok(report.blockers.includes('latest_committed_migration_below_0077'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release source blocks any gap before the committed latest migration', async () => {
  const directory = await releaseRepository({ omit: ['0042_storefront_category_settings.sql'] });
  try {
    const report = checkDatabaseReleaseSource({ repositoryRoot: directory });
    assert.equal(report.status, 'blocked');
    assert.ok(report.blockers.includes('committed_migration_sequence_incomplete:0042'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
