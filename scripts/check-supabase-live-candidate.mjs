#!/usr/bin/env node

import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { assertSupabaseLiveEdgeProfile } from './prepare-supabase-edge-profile.mjs';
import { runSupabaseEdgeReleasePreflight } from './supabase-edge-release-preflight.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const SUPABASE_LIVE_CANDIDATE_FILE = resolve(repositoryRoot, '../.dabboba-launch/supabase-edge-live.env');

export function readSupabaseLiveCandidateProfile(path = SUPABASE_LIVE_CANDIDATE_FILE) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || stat.size < 1 || stat.size > 64 * 1_024) {
      throw new Error('LIVE candidate profile must be a private regular file owned by the current user.');
    }
    const values = parseEnv(readFileSync(descriptor, 'utf8'));
    if (Object.keys(values).some((key) => key.startsWith('SUPABASE_'))) {
      throw new Error('Reserved Supabase credentials must not be duplicated in the LIVE candidate file.');
    }
    assertSupabaseLiveEdgeProfile(values);
    return values;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export async function checkSupabaseLiveCandidate({
  readProfile = readSupabaseLiveCandidateProfile,
  preflight = runSupabaseEdgeReleasePreflight,
} = {}) {
  const edgeProfile = readProfile();
  const result = await preflight({ edgeProfile, expectedCommerceMode: 'LIVE' });
  return {
    status: 'candidate-checked',
    sourceHead: result.sourceHead,
    latestMigration: result.latestMigration,
    targetHash: result.targetHash,
    customerAuthProviders: result.releaseConfiguration.customerAuthProviders,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  checkSupabaseLiveCandidate().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(() => {
    process.stderr.write('LIVE candidate check failed. Confirm the private profile, reviewed source, and target database without sharing secrets.\n');
    process.exitCode = 1;
  });
}
