#!/usr/bin/env node

import { verifyMobilePublicApiSurface } from './verify-public-edge-surface.mjs';

const apiBaseUrl = process.env.EXPO_PUBLIC_DABBOBA_API_URL?.trim();
const expectedCommerceMode = process.env.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim();

if (!apiBaseUrl || !['PRELAUNCH', 'LIVE'].includes(expectedCommerceMode)) {
  process.stderr.write('Mobile public API verification requires the candidate API URL and commerce capability.\n');
  process.exitCode = 1;
} else {
  verifyMobilePublicApiSurface({ apiBaseUrl, expectedCommerceMode }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`Mobile public API verification failed: ${error instanceof Error ? error.message : 'unknown response'}\n`);
    process.exitCode = 1;
  });
}
