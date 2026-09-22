#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  selectedAdminEnvironment,
  selectedApiEnvironment,
  selectedWorkerEnvironment,
} from './supabase-integration-profile.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
const commands = {
  api: () => ({
    args: ['pnpm', '--filter', '@dabboba/api', 'exec', 'tsx', 'watch', 'src/index.ts'],
    env: selectedApiEnvironment(process.env),
  }),
  worker: () => ({
    args: ['pnpm', '--filter', '@dabboba/worker', 'exec', 'tsx', 'src/index.ts'],
    env: selectedWorkerEnvironment(process.env),
  }),
  admin: () => ({
    args: ['pnpm', '--filter', '@dabboba/admin', 'exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', '4180'],
    env: selectedAdminEnvironment(process.env),
  }),
};

if (!Object.hasOwn(commands, target)) {
  process.stderr.write('Usage: node scripts/run-local-backend.mjs <api|worker|admin>\n');
  process.exit(64);
}

const command = commands[target]();
const child = spawn('corepack', command.args, {
  cwd: repositoryRoot,
  env: command.env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', () => {
  process.stderr.write(`Could not start the local ${target} process.\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
