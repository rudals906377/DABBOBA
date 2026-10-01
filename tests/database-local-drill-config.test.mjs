import assert from 'node:assert/strict';
import test from 'node:test';
import {assertLocalDrillContainerName,localDrillConfig} from '../ops/database/local-drill-config.mjs';
const env = {DABBOBA_BACKUP_TEST_CONTAINER:'dabboba-launch-ci-20261001-703d251',DABBOBA_BACKUP_TEST_SOURCE_DATABASE:'dabboba_restore_drill_launch_test',DABBOBA_BACKUP_TEST_APPROVE_DISPOSABLE:'YES',DABBOBA_BACKUP_TEST_USER:'dabboba',DABBOBA_BACKUP_TEST_PASSWORD:'local-fixture-only'};
const inspection = () => ({Config:{Image:'tembo.docker.scarf.sh/tembo/pg17-pgmq@sha256:ba00a1ec2694b76be07b9bc5331e2bc0fa671f296919d2bb12a1cb2e22dd15fd',Labels:{'dabboba.purpose':'disposable-launch-qa'}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'63274'}]}}});
test('fresh local restore drills require a pinned labelled container and explicit clone',()=>{
  assert.equal(localDrillConfig(env,inspection()).port,63274);
  for(const container of ['finde-postgres','dabboba-production','dabboba-local','dabboba-launch-ci-20261001-703d251;other',undefined]) assert.throws(()=>assertLocalDrillContainerName(container));
  for(const source of ['postgres','dabboba_ci','dabboba','dabboba_restore_drill_a;DROP']) assert.throws(()=>localDrillConfig({...env,DABBOBA_BACKUP_TEST_SOURCE_DATABASE:source},inspection()));
});
test('restore drill refuses missing approval, changed image, broad network binding and unknown credentials',()=>{
  assert.throws(()=>localDrillConfig({...env,DABBOBA_BACKUP_TEST_APPROVE_DISPOSABLE:''},inspection()));
  for(const change of [i=>i.Config.Image='postgres:latest',i=>i.Config.Labels={},i=>i.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0',i=>i.NetworkSettings.Ports['5432/tcp'].push({HostIp:'::',HostPort:'63274'}),i=>i.NetworkSettings.Ports['5432/tcp'][0].HostPort='70000']) {const i=inspection();change(i);assert.throws(()=>localDrillConfig(env,i));}
  assert.throws(()=>localDrillConfig({...env,DABBOBA_BACKUP_TEST_USER:'other'},inspection()));
  assert.throws(()=>localDrillConfig({...env,DABBOBA_BACKUP_TEST_PASSWORD:''},inspection()));
});
