const LEGACY_CONTAINER = 'dabboba-backend-integration-20260905';
const PINNED_IMAGE = 'tembo.docker.scarf.sh/tembo/pg17-pgmq@sha256:ba00a1ec2694b76be07b9bc5331e2bc0fa671f296919d2bb12a1cb2e22dd15fd';

export function assertLocalDrillContainerName(container) {
  if (container !== LEGACY_CONTAINER && !/^dabboba-launch-ci-\d{8}-[a-f0-9]{7}$/.test(container ?? '')) {
    throw new Error('Explicit dedicated test container required.');
  }
}

export function localDrillConfig(env, inspection) {
  const container = env.DABBOBA_BACKUP_TEST_CONTAINER;
  assertLocalDrillContainerName(container);
  const source = env.DABBOBA_BACKUP_TEST_SOURCE_DATABASE;
  if (!/^dabboba_restore_drill_[a-z0-9_]+$/.test(source ?? '')) {
    throw new Error('An explicit disposable restore-clone source is required.');
  }
  if (container !== LEGACY_CONTAINER && (
    env.DABBOBA_BACKUP_TEST_APPROVE_DISPOSABLE !== 'YES'
    || inspection?.Config?.Labels?.['dabboba.purpose'] !== 'disposable-launch-qa'
    || inspection?.Config?.Image !== PINNED_IMAGE
  )) throw new Error('A pinned, explicitly approved disposable launch container is required.');
  const mapping = inspection?.NetworkSettings?.Ports?.['5432/tcp'];
  if (!Array.isArray(mapping) || mapping.length !== 1 || mapping[0].HostIp !== '127.0.0.1'
    || !/^[0-9]+$/.test(mapping[0].HostPort) || Number(mapping[0].HostPort) < 1 || Number(mapping[0].HostPort) > 65535) {
    throw new Error('Fixture PostgreSQL requires a single known loopback port.');
  }
  const user = env.DABBOBA_BACKUP_TEST_USER ?? 'postgres';
  const password = env.DABBOBA_BACKUP_TEST_PASSWORD ?? (container === LEGACY_CONTAINER ? 'dabboba-disposable-local-only-20260905' : '');
  if (!['postgres', 'dabboba'].includes(user) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new Error('Explicit fixture database credentials are required.');
  }
  return {container, source, user, password, port:Number(mapping[0].HostPort)};
}
