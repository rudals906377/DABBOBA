#!/usr/bin/env node

// Verifies which Apple team actually signed a built iOS artifact. The source
// `appleTeamId` pin in app.json cannot prove which EAS credentials signed the
// binary, so every release .ipa is checked here before it is uploaded.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXPECTED_RELEASE_TEAM_ID = 'MCZ4884P7F';
export const EXPECTED_BUNDLE_ID = 'com.dabboba.mobile';
// The developer's individual team must never sign a DABBOBA release.
export const FORBIDDEN_RELEASE_TEAM_IDS = Object.freeze(['52HC8BV2BL']);

/**
 * The embedded provisioning profile is a CMS envelope whose payload is a plain
 * XML property list, so the plist can be read without decoding the signature.
 */
export function extractProvisioningPlist(profileBytes) {
  const text = Buffer.from(profileBytes).toString('latin1');
  const start = text.indexOf('<?xml');
  const end = text.indexOf('</plist>');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('The embedded provisioning profile does not contain a property list.');
  }
  return text.slice(start, end + '</plist>'.length);
}

export function inspectProvisioningPlist(xml) {
  const teamArray = /<key>TeamIdentifier<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? '';
  const teams = [...teamArray.matchAll(/<string>([^<]*)<\/string>/g)].map((item) => item[1].trim());
  // application-identifier and get-task-allow appear only inside Entitlements.
  const applicationIdentifier = /<key>application-identifier<\/key>\s*<string>([^<]*)<\/string>/.exec(xml)?.[1]?.trim() ?? null;
  const getTaskAllow = /<key>get-task-allow<\/key>\s*<(true|false)\s*\/>/.exec(xml)?.[1];
  return {
    teams,
    applicationIdentifier,
    getTaskAllow: getTaskAllow === undefined ? null : getTaskAllow === 'true',
    // App Store profiles never list devices; ad hoc and development profiles do.
    listsDevices: /<key>ProvisionedDevices<\/key>/.test(xml),
  };
}

export function assertReleaseProvisioning(profile) {
  const problems = [];
  const forbidden = profile.teams.filter((team) => FORBIDDEN_RELEASE_TEAM_IDS.includes(team));
  if (forbidden.length) problems.push(`signed by a team that may not publish DABBOBA: ${forbidden.join(', ')}`);
  if (profile.teams.length !== 1 || profile.teams[0] !== EXPECTED_RELEASE_TEAM_ID) {
    problems.push(`TeamIdentifier must be exactly ${EXPECTED_RELEASE_TEAM_ID} (found ${profile.teams.join(', ') || 'none'})`);
  }
  if (profile.applicationIdentifier !== `${EXPECTED_RELEASE_TEAM_ID}.${EXPECTED_BUNDLE_ID}`) {
    problems.push(`application-identifier must be ${EXPECTED_RELEASE_TEAM_ID}.${EXPECTED_BUNDLE_ID} (found ${profile.applicationIdentifier ?? 'none'})`);
  }
  if (profile.getTaskAllow !== false) problems.push('get-task-allow must be false for a distribution build');
  if (profile.listsDevices) problems.push('the profile lists devices, so it is not an App Store distribution profile');
  if (problems.length) throw new Error(`iOS artifact signing check failed: ${problems.join('; ')}.`);
  return profile;
}

function defaultReadProfile(ipaPath) {
  const listed = spawnSync('unzip', ['-Z1', ipaPath], { encoding: 'utf8' });
  if (listed.status !== 0) throw new Error('The .ipa could not be listed with unzip.');
  const entries = listed.stdout.split('\n').filter((entry) => /^Payload\/[^/]+\.app\/embedded\.mobileprovision$/.test(entry));
  if (entries.length !== 1) throw new Error('The .ipa must contain exactly one app-level embedded.mobileprovision.');
  const extracted = spawnSync('unzip', ['-p', ipaPath, entries[0]], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  if (extracted.status !== 0 || !extracted.stdout?.length) throw new Error('The embedded provisioning profile could not be read.');
  return extracted.stdout;
}

export function verifyIosArtifactTeam(ipaPath, { readProfile = defaultReadProfile } = {}) {
  if (typeof ipaPath !== 'string' || !ipaPath.endsWith('.ipa')) {
    throw new Error('Usage: node scripts/verify-ios-artifact-team.mjs <path-to-release.ipa>');
  }
  if (readProfile === defaultReadProfile && !existsSync(ipaPath)) throw new Error(`No .ipa at ${ipaPath}.`);
  const plist = extractProvisioningPlist(readProfile(ipaPath));
  return assertReleaseProvisioning(inspectProvisioningPlist(plist));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyIosArtifactTeam(process.argv[2] ? path.resolve(process.argv[2]) : '');
    process.stdout.write(`${JSON.stringify({ status: 'pass', ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'iOS artifact signing check failed.'}\n`);
    process.exitCode = 1;
  }
}
