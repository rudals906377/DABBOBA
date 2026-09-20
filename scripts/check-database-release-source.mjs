import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const DATABASE_RELEASE_MIGRATIONS = Object.freeze([
  Object.freeze({
    file: '0049_shipping_storage_policy.sql',
    path: 'packages/db/migrations/0049_shipping_storage_policy.sql',
    sha256: '89550614260e11dd1a5dcce54cc9f1cc1efb8ce4f12d140dd7f4cc9bb9a363c9',
  }),
  Object.freeze({
    file: '0050_shipping_fee_policy.sql',
    path: 'packages/db/migrations/0050_shipping_fee_policy.sql',
    sha256: 'e7e4a2043208f00fcac89c18c8f8bfda36f77ae3a091861139fdfe6c79bb9d9b',
  }),
  Object.freeze({
    file: '0051_home_catalog_section_layout.sql',
    path: 'packages/db/migrations/0051_home_catalog_section_layout.sql',
    sha256: '44e7616f95e60d5d6d7a5008278a3bd0af1ac78ea2233d18b3032efc1277464e',
  }),
  Object.freeze({
    file: '0052_shipping_fee_checkout.sql',
    path: 'packages/db/migrations/0052_shipping_fee_checkout.sql',
    sha256: '29cb17f66ce75a496f5f3104b1bb65cab0806aa23517ac652e3e844087c7d8b8',
  }),
  Object.freeze({
    file: '0053_account_policy_and_auth_deletion.sql',
    path: 'packages/db/migrations/0053_account_policy_and_auth_deletion.sql',
    sha256: 'aee600b968356d0615a28c470c9a7443b6edbdffc59d2dd3d06770871fe316c0',
  }),
  Object.freeze({
    file: '0054_catalog_sale_status_and_prelaunch.sql',
    path: 'packages/db/migrations/0054_catalog_sale_status_and_prelaunch.sql',
    sha256: 'f83069425067db440492d2937a3158edec8bfb82d462d2e58eabad53f29bcd72',
  }),
  Object.freeze({
    file: '0055_ugc_trust_safety.sql',
    path: 'packages/db/migrations/0055_ugc_trust_safety.sql',
    sha256: '16aaa33cb9a854434872eb274b1f0480eb41a4befa0135a96d2060bdc6d5620a',
  }),
  Object.freeze({
    file: '0056_legal_acceptance_and_automatic_account_deletion.sql',
    path: 'packages/db/migrations/0056_legal_acceptance_and_automatic_account_deletion.sql',
    sha256: 'ce076ea2c3381971bca65189f7d6c35ad936a239090146f1f2d01421cb8ee730',
  }),
  Object.freeze({
    file: '0057_ugc_operations_policy_evidence.sql',
    path: 'packages/db/migrations/0057_ugc_operations_policy_evidence.sql',
    sha256: '8f22b4677fa49c29fc685f525e31638eb0cafe606202c797fdb68ef655e3e570',
  }),
  Object.freeze({
    file: '0058_active_policy_gate_and_apple_revocation.sql',
    path: 'packages/db/migrations/0058_active_policy_gate_and_apple_revocation.sql',
    sha256: '4e8dd99a843f38224788e944da13b7b4f972ee3c9d2407659377deab02fed40b',
  }),
  Object.freeze({
    file: '0059_expo_push_delivery.sql',
    path: 'packages/db/migrations/0059_expo_push_delivery.sql',
    sha256: '3816487f534fcc3cfc9907ebb82194a1c8b1eeec72af0c9ad557bec60241baeb',
  }),
  Object.freeze({
    file: '0060_worker_session_least_privilege.sql',
    path: 'packages/db/migrations/0060_worker_session_least_privilege.sql',
    sha256: '1684f1fdf4117d048bee12d939c39e96cdc2d42d84f6bb169f8eb0ffc8e258e5',
  }),
  Object.freeze({
    file: '0061_inventory_storage_expiry_lifecycle.sql',
    path: 'packages/db/migrations/0061_inventory_storage_expiry_lifecycle.sql',
    sha256: '1c9423e8d8ab47909ef965969c94b1f0d6d24601370b3cdb82f39c04943e18ff',
  }),
  Object.freeze({
    file: '0062_home_catalog_section_sources.sql',
    path: 'packages/db/migrations/0062_home_catalog_section_sources.sql',
    sha256: 'd673939e1679ff9a2c2b17fbab5c58173d5ed6575f4ba67f2bbbc3f5defdd9de',
  }),
  Object.freeze({
    file: '0063_shipping_quotes.sql',
    path: 'packages/db/migrations/0063_shipping_quotes.sql',
    sha256: '0f4dc872570ab82a7eb34f14c3e3538c4e1953abdb63fe56d6c6a7475dc7f210',
  }),
  Object.freeze({
    file: '0064_account_deletion_authored_data_cleanup.sql',
    path: 'packages/db/migrations/0064_account_deletion_authored_data_cleanup.sql',
    sha256: 'c3d0832852cca2610aabfb07fef4f85acdc86a5104e0d6ddcca3478661c07a32',
  }),
]);

export const MINIMUM_DATABASE_RELEASE_VERSION =
  DATABASE_RELEASE_MIGRATIONS.at(-1).file.slice(0, 4);

function git(repositoryRoot, args) {
  return spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function text(result) {
  return Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8').trim() : '';
}

export function checkDatabaseReleaseSource({ repositoryRoot = defaultRepositoryRoot } = {}) {
  const report = {
    scope: 'database-release-source/v1',
    status: 'blocked',
    head: null,
    latestMigration: null,
    worktreeClean: false,
    blockers: [],
  };
  let root;
  try {
    root = realpathSync(resolve(repositoryRoot));
  } catch {
    report.blockers.push('repository_root_unavailable');
    return report;
  }

  const rootResult = git(root, ['rev-parse', '--show-toplevel']);
  if (rootResult.error || rootResult.status !== 0) {
    report.blockers.push('git_repository_unavailable');
    return report;
  }
  try {
    if (realpathSync(text(rootResult)) !== root) {
      report.blockers.push('repository_root_mismatch');
      return report;
    }
  } catch {
    report.blockers.push('repository_root_mismatch');
    return report;
  }

  const headResult = git(root, ['rev-parse', '--verify', 'HEAD']);
  if (headResult.error || headResult.status !== 0 || !/^[0-9a-f]{40,64}$/.test(text(headResult))) {
    report.blockers.push('git_head_unavailable');
    return report;
  }
  report.head = text(headResult);

  const statusResult = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (statusResult.error || statusResult.status !== 0 || !Buffer.isBuffer(statusResult.stdout)) {
    report.blockers.push('git_worktree_status_unavailable');
  } else if (statusResult.stdout.length > 0) {
    report.blockers.push('repository_worktree_not_clean');
  } else {
    report.worktreeClean = true;
  }

  const treeResult = git(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'packages/db/migrations']);
  if (treeResult.error || treeResult.status !== 0) {
    report.blockers.push('git_migration_tree_unavailable');
    return report;
  }
  const trackedPaths = text(treeResult).split('\n').filter(Boolean);
  const committedMigrations = trackedPaths
    .map((path) => path.match(/^packages\/db\/migrations\/(\d{4}_[a-z0-9_]+\.sql)$/)?.[1])
    .filter(Boolean)
    .sort();
  report.latestMigration = committedMigrations.at(-1) ?? null;
  if (!report.latestMigration || report.latestMigration.slice(0, 4) < MINIMUM_DATABASE_RELEASE_VERSION) {
    report.blockers.push(`latest_committed_migration_below_${MINIMUM_DATABASE_RELEASE_VERSION}`);
  }
  if (report.latestMigration) {
    const counts = new Map();
    for (const migration of committedMigrations) {
      const version = migration.slice(0, 4);
      counts.set(version, (counts.get(version) ?? 0) + 1);
    }
    const latestVersion = Number(report.latestMigration.slice(0, 4));
    for (let version = 0; version <= latestVersion; version += 1) {
      const key = String(version).padStart(4, '0');
      if (counts.get(key) !== 1) {
        report.blockers.push(`committed_migration_sequence_incomplete:${key}`);
      }
    }
  }

  const tracked = new Set(trackedPaths);
  for (const migration of DATABASE_RELEASE_MIGRATIONS) {
    if (!tracked.has(migration.path)) {
      report.blockers.push(`required_migration_not_committed:${migration.file}`);
      continue;
    }

    const blob = git(root, ['show', `HEAD:${migration.path}`]);
    if (blob.error || blob.status !== 0 || sha256(blob.stdout) !== migration.sha256) {
      report.blockers.push(`required_migration_checksum_mismatch:${migration.file}`);
      continue;
    }

    try {
      const path = resolve(root, migration.path);
      if (!statSync(path).isFile() || sha256(readFileSync(path)) !== migration.sha256) {
        report.blockers.push(`required_migration_worktree_checksum_mismatch:${migration.file}`);
      }
    } catch {
      report.blockers.push(`required_migration_worktree_unavailable:${migration.file}`);
    }

    const diff = git(root, ['diff', '--quiet', 'HEAD', '--', migration.path]);
    if (diff.error || ![0, 1].includes(diff.status)) {
      report.blockers.push(`required_migration_git_check_failed:${migration.file}`);
    } else if (diff.status === 1) {
      report.blockers.push(`required_migration_worktree_not_clean:${migration.file}`);
    }
  }

  report.blockers = [...new Set(report.blockers)];
  report.status = report.blockers.length === 0 ? 'pass' : 'blocked';
  return report;
}

function main() {
  const report = checkDatabaseReleaseSource();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
