import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Deliberately public, disposable LOCAL fixture values. Never load project .env.
export const prefix = 'dabboba-storage-conformance-20260906';
export const names = { network: `${prefix}-net`, db: `${prefix}-db`, storage: `${prefix}-api` };
export const jwtSecret = 'local-storage-conformance-only-not-a-production-secret';
export const accessKey = 'local-conformance-access';
export const secretKey = 'local-conformance-s3-secret-never-use-outside-local-test';
export const region = 'us-east-1';
export const storageImage = 'supabase/storage-api@sha256:0f41ebe206d817fa9c1664f747789cbfb3653f111cd0d7a363f314039c4c1ddf';
export function storageEnvironment() {
  return {
    SERVER_PORT: '5000', AUTH_JWT_SECRET: jwtSecret, AUTH_JWT_ALGORITHM: 'HS256',
    DATABASE_URL: 'postgres://postgres:local-conformance-postgres@conformance-db:5432/postgres',
    DB_INSTALL_ROLES: 'true', DATABASE_MAX_CONNECTIONS: '5',
    STORAGE_BACKEND: 'file', STORAGE_FILE_BACKEND_PATH: '/var/lib/storage', STORAGE_S3_BUCKET: 'local-fixture',
    TENANT_ID: 'local-conformance', STORAGE_S3_REGION: region,
    UPLOAD_FILE_SIZE_LIMIT: '10485760', UPLOAD_FILE_SIZE_LIMIT_STANDARD: '10485760',
    UPLOAD_SIGNED_URL_EXPIRATION_TIME: '120', IMAGE_TRANSFORMATION_ENABLED: 'false',
    S3_PROTOCOL_ACCESS_KEY_ID: accessKey, S3_PROTOCOL_ACCESS_KEY_SECRET: secretKey,
    LOG_LEVEL: 'error',
  };
}
export function docker(args) { return execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim(); }
export function serviceToken() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'service_role', iat: now, exp: now + 3600 })}`;
  return `${input}.${createHmac('sha256', jwtSecret).update(input).digest('base64url')}`;
}
export function localOrigin(containerName = names.storage) {
  if (!containerName.startsWith(prefix)) throw new Error('Refusing a non-fixture container');
  const binding = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', containerName]))['5000/tcp'][0];
  if (binding.HostIp !== '127.0.0.1') throw new Error('Refusing a non-loopback Storage fixture');
  return `http://127.0.0.1:${binding.HostPort}`;
}
