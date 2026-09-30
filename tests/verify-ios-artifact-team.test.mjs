import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  extractProvisioningPlist,
  inspectProvisioningPlist,
  verifyIosArtifactTeam,
} from '../scripts/verify-ios-artifact-team.mjs';

function provisioningProfile({
  team = 'MCZ4884P7F',
  applicationIdentifier = 'MCZ4884P7F.com.dabboba.mobile',
  getTaskAllow = false,
  devices = false,
} = {}) {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>AppIDName</key><string>DABBOBA</string>
  <key>ApplicationIdentifierPrefix</key><array><string>${team}</string></array>
  <key>Entitlements</key><dict>
    <key>application-identifier</key><string>${applicationIdentifier}</string>
    <key>keychain-access-groups</key><array><string>${team}.*</string></array>
    <key>get-task-allow</key><${getTaskAllow}/>
    <key>com.apple.developer.team-identifier</key><string>${team}</string>
    <key>aps-environment</key><string>production</string>
  </dict>
  ${devices ? '<key>ProvisionedDevices</key><array><string>00008110-000000000000001E</string></array>' : ''}
  <key>TeamIdentifier</key><array><string>${team}</string></array>
  <key>TeamName</key><string>Release team</string>
</dict></plist>`;
  // Surround the plist with opaque CMS-like bytes, as a real profile does.
  return Buffer.concat([Buffer.from([0x30, 0x82, 0x2a, 0x10, 0x06, 0x09]), Buffer.from(plist, 'utf8'), Buffer.from([0xa0, 0x82, 0x01])]);
}

const verify = (options) => verifyIosArtifactTeam('/tmp/release.ipa', { readProfile: () => provisioningProfile(options) });

test('a friend-team App Store profile passes the artifact signing check', () => {
  const result = verify();
  assert.deepEqual(result.teams, ['MCZ4884P7F']);
  assert.equal(result.applicationIdentifier, 'MCZ4884P7F.com.dabboba.mobile');
  assert.equal(result.getTaskAllow, false);
  assert.equal(result.listsDevices, false);
});

test('the developer team, another bundle, a debuggable or an ad hoc profile is rejected', () => {
  assert.throws(() => verify({ team: '52HC8BV2BL', applicationIdentifier: '52HC8BV2BL.com.dabboba.mobile' }), /may not publish DABBOBA: 52HC8BV2BL/);
  assert.throws(() => verify({ applicationIdentifier: 'MCZ4884P7F.com.example.other' }), /application-identifier must be MCZ4884P7F\.com\.dabboba\.mobile/);
  assert.throws(() => verify({ getTaskAllow: true }), /get-task-allow must be false/);
  assert.throws(() => verify({ devices: true }), /not an App Store distribution profile/);
  assert.throws(() => verifyIosArtifactTeam('/tmp/release.zip', { readProfile: () => provisioningProfile() }), /Usage/);
  assert.throws(() => extractProvisioningPlist(Buffer.from('not a profile')), /does not contain a property list/);
  assert.deepEqual(inspectProvisioningPlist('<plist></plist>').teams, []);
});

test('the default reader extracts the app-level profile from a real .ipa archive', { skip: spawnSync('zip', ['-v']).status !== 0 }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dabboba-ipa-'));
  try {
    const appDirectory = path.join(directory, 'Payload', 'DABBOBA.app');
    mkdirSync(appDirectory, { recursive: true });
    writeFileSync(path.join(appDirectory, 'embedded.mobileprovision'), provisioningProfile());
    const ipa = path.join(directory, 'release.ipa');
    assert.equal(spawnSync('zip', ['-qr', ipa, 'Payload'], { cwd: directory }).status, 0);
    assert.deepEqual(verifyIosArtifactTeam(ipa).teams, ['MCZ4884P7F']);

    writeFileSync(path.join(appDirectory, 'embedded.mobileprovision'), provisioningProfile({ team: '52HC8BV2BL', applicationIdentifier: '52HC8BV2BL.com.dabboba.mobile' }));
    const developerIpa = path.join(directory, 'developer.ipa');
    assert.equal(spawnSync('zip', ['-qr', developerIpa, 'Payload'], { cwd: directory }).status, 0);
    assert.throws(() => verifyIosArtifactTeam(developerIpa), /52HC8BV2BL/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
