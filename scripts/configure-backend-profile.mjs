#!/usr/bin/env node
import {
  SUPABASE_INTEGRATION_PROFILE,
  SUPABASE_DEMO_PROFILE,
  SUPABASE_DEMO_SECRETS_FILE,
  SUPABASE_DEMO_SOURCE_FILE,
  configureBackendProfile,
} from './supabase-integration-profile.mjs';
import { LOCAL_BACKEND_PROFILE } from './local-backend-profile.mjs';

const requested = process.argv[2];
const profile = requested === '--supabase'
  ? SUPABASE_INTEGRATION_PROFILE
  : requested === '--supabase-demo'
    ? SUPABASE_DEMO_PROFILE
  : requested === '--local'
    ? LOCAL_BACKEND_PROFILE
    : null;

if (!profile) {
  process.stderr.write('Usage: node scripts/configure-backend-profile.mjs <--local|--supabase|--supabase-demo>\n');
  process.exitCode = 64;
} else {
  try {
    configureBackendProfile(profile, profile === SUPABASE_DEMO_PROFILE ? {
      sourceFile: SUPABASE_DEMO_SOURCE_FILE,
      secretsFile: SUPABASE_DEMO_SECRETS_FILE,
      selectionFile: new URL('../../.dabboba-launch/backend-profile', import.meta.url).pathname,
    } : undefined);
    process.stdout.write(`DABBOBA backend profile selected: ${profile}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(`Could not select the DABBOBA backend profile: ${message}\n`);
    process.exitCode = 1;
  }
}
