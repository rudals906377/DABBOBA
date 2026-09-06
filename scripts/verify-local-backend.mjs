#!/usr/bin/env node
// A local fixture verifier, never a remote deployment or migration command.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const cwd = fileURLToPath(new URL('../', import.meta.url));
const container = 'dabboba-backend-integration-20260905';
const sourceDatabase = 'dabboba_integration';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--container' || args[1] !== container) {
  process.stderr.write(`Usage: node scripts/verify-local-backend.mjs --container ${container}\n`);
  process.exit(64);
}

try {
  const { stdout } = await execute('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container], { timeout: 10_000 });
  const bindings = JSON.parse(stdout)['5432/tcp'];
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1'
    || !/^[0-9]{1,5}$/.test(bindings[0].HostPort) || Number(bindings[0].HostPort) < 1024
    || Number(bindings[0].HostPort) > 65535) throw new Error('The dedicated DB must have one explicit loopback-only port.');
  const port = bindings[0].HostPort;
  // Deliberately fixed disposable fixture credentials, not application .env.
  const owner = `postgresql://postgres:dabboba-disposable-local-only-20260905@127.0.0.1:${port}/${sourceDatabase}`;
  const runtime = `postgresql://dabboba_runtime:dabboba-runtime-disposable-only-20260905@127.0.0.1:${port}/${sourceDatabase}`;
  const worker = `postgresql://dabboba_worker:dabboba-worker-disposable-only-20260905@127.0.0.1:${port}/${sourceDatabase}`;
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
    DATABASE_URL: '',
    DATABASE_MIGRATION_URL: owner,
    DABBOBA_TEST_DATABASE_URL: owner,
    DABBOBA_RUNTIME_TEST_DATABASE_URL: runtime,
    DABBOBA_WORKER_TEST_DATABASE_URL: worker,
    WORKER_DATABASE_URL: worker,
  };
  // Abort before tests on a stopped/mismatched fixture; never restart based on
  // a stale saved port and never silently skip role tests due to missing envs.
  await execute('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', sourceDatabase], { timeout: 10_000 });
  const steps = [
    { name: 'shared-build', args: ['pnpm', 'run', 'workspace:packages'] },
    { name: 'api-build', args: ['pnpm', '--filter', '@dabboba/api', 'build'] },
    { name: 'worker-build', args: ['pnpm', '--filter', '@dabboba/worker', 'build'] },
    { name: 'database', args: ['pnpm', '--filter', '@dabboba/db', 'test'], tests: true },
    { name: 'api', args: ['pnpm', '--filter', '@dabboba/api', 'test'], tests: true },
    { name: 'worker', args: ['pnpm', '--filter', '@dabboba/worker', 'test'], tests: true },
  ];
  for (const step of steps) {
    process.stdout.write(`${step.name}: running\n`);
    let result;
    try {
      result = await execute('corepack', step.args, { cwd, env, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
    } catch {
      // Avoid leaking raw query/connection diagnostics. Run the named fixture
      // suite directly to inspect the failure privately, never against .env.
      throw new Error(`${step.name} failed; inspect this local fixture suite before continuing.`);
    }
    if (step.tests) {
      const report = result.stdout + result.stderr;
      const passed = report.match(/(?:#|ℹ) pass (\d+)/)?.[1];
      const failed = report.match(/(?:#|ℹ) fail (\d+)/)?.[1];
      const skipped = report.match(/(?:#|ℹ) skipped (\d+)/)?.[1];
      if (!passed || !Number.isSafeInteger(Number(passed)) || Number(passed) < 1
        || failed !== '0' || skipped !== '0') throw new Error(`${step.name} did not prove a complete zero-skip pass.`);
      process.stdout.write(`${step.name}: ${passed} passed, 0 failed, 0 skipped\n`);
    } else process.stdout.write(`${step.name}: passed\n`);
  }
  process.stdout.write('Local fixture verification passed. No production connection, deployment, or provider transaction was tested.\n');
} catch (error) {
  const safe = error.code ? 'Cannot inspect the dedicated local fixture; check Docker and the container privately.' : error.message;
  process.stderr.write(`${safe}\n`);
  process.exitCode = 1;
}
