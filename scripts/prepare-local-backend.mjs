#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_BACKEND_DATABASE,
  LOCAL_BACKEND_ENV_FILE,
  LOCAL_BACKEND_ENVIRONMENT_TIER,
  LOCAL_BACKEND_PROFILE,
  LOCAL_RELEASE_ENVIRONMENT_TIER,
  assertLocalBackendProfileEnv,
  readLocalBackendProfileEnv,
} from './local-backend-profile.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const dockerPrefix = ['--context', 'desktop-linux'];
const composeArgs = [...dockerPrefix, 'compose', '--env-file', '/dev/null', '-p', 'dabboba-development', '-f', 'ops/local/backend.compose.yaml'];
const postgresContainer = 'dabboba-development-postgres-1';
const postgresVolume = 'dabboba-development_dabboba_development_postgres17_pgmq_data';
const postgresImage = 'tembo.docker.scarf.sh/tembo/pg17-pgmq@sha256:ba00a1ec2694b76be07b9bc5331e2bc0fa671f296919d2bb12a1cb2e22dd15fd';
const mode = process.argv[2];
if ((mode !== '--apply' && mode !== '--check') || process.argv.length !== 3) {
  process.stderr.write('Usage: node scripts/prepare-local-backend.mjs <--apply|--check>\n');
  process.exit(64);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error('Local backend command failed.'), { code }));
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function dockerCompose(...args) {
  return run('docker', [...composeArgs, ...args], { env: safeHostEnvironment() });
}

function docker(...args) {
  return run('docker', [...dockerPrefix, ...args], { env: safeHostEnvironment() });
}

function safeHostEnvironment() {
  const result = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM']) {
    if (process.env[key]) result[key] = process.env[key];
  }
  return result;
}

async function optionalInspect(kind, name) {
  try {
    return JSON.parse((await docker(kind, 'inspect', name, '--format', '{{json .}}')).stdout);
  } catch (error) {
    if (error?.code === 1) return null;
    throw error;
  }
}

async function assertPostgresIdentity(allowAbsent) {
  const volume = await optionalInspect('volume', postgresVolume);
  if (!volume) {
    if (allowAbsent) return;
    throw new Error('The expected DABBOBA PostgreSQL volume is missing.');
  }
  if (volume.Labels?.['com.docker.compose.project'] !== 'dabboba-development'
      || volume.Labels?.['com.docker.compose.volume'] !== 'dabboba_development_postgres17_pgmq_data') {
    throw new Error('The PostgreSQL volume identity does not match the DABBOBA local profile.');
  }
  const container = await optionalInspect('container', postgresContainer);
  if (!container) {
    if (allowAbsent) return;
    throw new Error('The expected DABBOBA PostgreSQL container is missing.');
  }
  const bindings = container.HostConfig?.PortBindings?.['5432/tcp'];
  const mounts = container.Mounts?.filter((mount) => mount.Destination === '/var/lib/postgresql/data');
  if (container.Config?.Labels?.['com.docker.compose.project'] !== 'dabboba-development'
      || container.Config?.Labels?.['com.docker.compose.service'] !== 'postgres'
      || container.Config?.Image !== postgresImage
      || !Array.isArray(bindings) || bindings.length !== 1
      || bindings[0].HostIp !== '127.0.0.1' || bindings[0].HostPort !== '55433'
      || !Array.isArray(mounts) || mounts.length !== 1 || mounts[0].Name !== postgresVolume) {
    throw new Error('The PostgreSQL container identity, port, or volume does not match the DABBOBA local profile.');
  }
}

async function psql(query, database = 'dabboba') {
  const result = await dockerCompose(
    'exec', '-T', 'postgres',
    'psql', '--no-psqlrc', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1',
    '--username', 'dabboba', '--dbname', database, '--command', query,
  );
  return result.stdout.trim();
}

function encode(value) {
  return encodeURIComponent(value);
}

function newProfile() {
  const runtimePassword = randomBytes(24).toString('base64url');
  const workerPassword = randomBytes(24).toString('base64url');
  const pepper = randomBytes(32).toString('base64url');
  const owner = `postgresql://dabboba:dabboba_local@127.0.0.1:55433/${LOCAL_BACKEND_DATABASE}`;
  return {
    DABBOBA_LOCAL_BACKEND_PROFILE: LOCAL_BACKEND_PROFILE,
    DABBOBA_ENVIRONMENT_TIER: LOCAL_BACKEND_ENVIRONMENT_TIER,
    DABBOBA_RELEASE_ENVIRONMENT_TIER: LOCAL_RELEASE_ENVIRONMENT_TIER,
    NODE_ENV: 'development',
    DATABASE_MIGRATION_URL: owner,
    DATABASE_URL: `postgresql://dabboba_runtime:${encode(runtimePassword)}@127.0.0.1:55433/${LOCAL_BACKEND_DATABASE}`,
    WORKER_DATABASE_URL: `postgresql://dabboba_worker:${encode(workerPassword)}@127.0.0.1:55433/${LOCAL_BACKEND_DATABASE}`,
    SESSION_TOKEN_PEPPER: pepper,
    ADMIN_PROXY_IDENTITY_SECRET: '',
    PAYMENT_PROVIDER: 'UNCONFIGURED',
    PAYMENT_WEBHOOK_SECRET: '',
    SUPABASE_URL: '',
    SUPABASE_STORAGE_SERVICE_KEY: '',
    SUPABASE_STORAGE_S3_ENDPOINT: '',
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: '',
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: '',
    GCS_BUCKET: '',
    GCS_PROJECT_ID: '',
    GOOGLE_APPLICATION_CREDENTIALS: '',
    NOTIFICATION_DELIVERY_URL: '',
    NOTIFICATION_DELIVERY_TOKEN: '',
  };
}

function serializeProfile(profile) {
  const order = [
    'DABBOBA_LOCAL_BACKEND_PROFILE', 'DABBOBA_ENVIRONMENT_TIER', 'DABBOBA_RELEASE_ENVIRONMENT_TIER',
    'NODE_ENV', 'DATABASE_MIGRATION_URL', 'DATABASE_URL', 'WORKER_DATABASE_URL',
    'SESSION_TOKEN_PEPPER', 'ADMIN_PROXY_IDENTITY_SECRET', 'PAYMENT_PROVIDER',
    'PAYMENT_WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_STORAGE_SERVICE_KEY',
    'SUPABASE_STORAGE_S3_ENDPOINT', 'SUPABASE_STORAGE_S3_ACCESS_KEY_ID',
    'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY', 'GCS_BUCKET', 'GCS_PROJECT_ID',
    'GOOGLE_APPLICATION_CREDENTIALS', 'NOTIFICATION_DELIVERY_URL', 'NOTIFICATION_DELIVERY_TOKEN',
  ];
  return `${order.map((key) => `${key}=${profile[key]}`).join('\n')}\n`;
}

function checkProfileFileMode() {
  const permissions = statSync(LOCAL_BACKEND_ENV_FILE).mode & 0o777;
  if (permissions !== 0o600) {
    throw new Error('.env.development.local must have file mode 0600.');
  }
}

async function assertFreshRoleSafety() {
  const existingDatabase = await psql(
    `SELECT datname FROM pg_database WHERE datname = '${LOCAL_BACKEND_DATABASE}'`,
  );
  if (existingDatabase) {
    throw new Error('The local development database already exists without its profile; refusing to guess credentials.');
  }
  const loginRoles = await psql(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('dabboba_runtime','dabboba_worker') AND rolcanlogin ORDER BY rolname",
  );
  if (loginRoles) {
    throw new Error('Existing local runtime/worker LOGIN roles may serve another database; refusing to rotate them.');
  }
}

function commandEnvironment(profile) {
  const allow = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM']) {
    if (process.env[key]) allow[key] = process.env[key];
  }
  return {
    ...allow,
    NODE_ENV: 'development',
    DABBOBA_ENVIRONMENT_TIER: LOCAL_BACKEND_ENVIRONMENT_TIER,
    DABBOBA_RELEASE_ENVIRONMENT_TIER: LOCAL_RELEASE_ENVIRONMENT_TIER,
    DATABASE_MIGRATION_URL: profile.DATABASE_MIGRATION_URL,
    DATABASE_URL: profile.DATABASE_URL,
    WORKER_DATABASE_URL: profile.WORKER_DATABASE_URL,
  };
}

function passwordFromUrl(value) {
  return decodeURIComponent(new URL(value).password);
}

async function verifyPreparedProfile(profile) {
  await dockerCompose('exec', '-T', 'postgres', 'pg_isready', '-U', 'dabboba', '-d', LOCAL_BACKEND_DATABASE);
  await run('corepack', ['pnpm', '--filter', '@dabboba/db', 'check:release'], {
    env: commandEnvironment(profile),
  });
}

try {
  if (mode === '--check') {
    await assertPostgresIdentity(false);
    await run('corepack', ['pnpm', 'run', 'workspace:packages'], { env: safeHostEnvironment() });
    checkProfileFileMode();
    const profile = readLocalBackendProfileEnv();
    await verifyPreparedProfile(profile);
    process.stdout.write('Local backend profile is isolated and ready.\n');
  } else {
    await assertPostgresIdentity(true);
    await run('corepack', ['pnpm', 'run', 'workspace:packages'], { env: safeHostEnvironment() });
    await dockerCompose('up', '-d', '--wait', 'postgres');
    await assertPostgresIdentity(false);
    let profile;
    if (existsSync(LOCAL_BACKEND_ENV_FILE)) {
      checkProfileFileMode();
      profile = readLocalBackendProfileEnv();
      const databaseExists = await psql(
        `SELECT datname FROM pg_database WHERE datname = '${LOCAL_BACKEND_DATABASE}'`,
      );
      if (!databaseExists) {
        throw new Error('The existing local profile has no matching database; refusing implicit recovery.');
      }
      await verifyPreparedProfile(profile);
      process.stdout.write('Existing local API/worker database profile is valid and was reused without credential rotation.\n');
      process.exit(0);
    } else {
      await assertFreshRoleSafety();
      profile = assertLocalBackendProfileEnv(newProfile());
      await writeFile(LOCAL_BACKEND_ENV_FILE, serializeProfile(profile), { mode: 0o600, flag: 'wx' });
    }

    const databaseExists = await psql(
      `SELECT datname FROM pg_database WHERE datname = '${LOCAL_BACKEND_DATABASE}'`,
    );
    if (!databaseExists) await dockerCompose('exec', '-T', 'postgres', 'createdb', '--username', 'dabboba', '--owner', 'dabboba', LOCAL_BACKEND_DATABASE);
    await psql(`DO $roles$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $roles$;`, LOCAL_BACKEND_DATABASE);

    const env = commandEnvironment(profile);
    await run('corepack', ['pnpm', '--filter', '@dabboba/db', 'migrate'], { env });
    await run('corepack', ['pnpm', '--filter', '@dabboba/db', 'provision:runtime-role', '--', '--password-stdin'], {
      env,
      input: `${passwordFromUrl(profile.DATABASE_URL)}\n`,
    });
    await run('corepack', ['pnpm', '--filter', '@dabboba/db', 'provision:worker-role', '--', '--password-stdin'], {
      env,
      input: `${passwordFromUrl(profile.WORKER_DATABASE_URL)}\n`,
    });
    await verifyPreparedProfile(profile);
    process.stdout.write('Local API/worker database profile is prepared. Production files and remote services were not used.\n');
  }
} catch (error) {
  const message = error instanceof Error && !('code' in error)
    ? error.message
    : 'Local backend preparation failed; inspect Docker and local profile state privately.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
