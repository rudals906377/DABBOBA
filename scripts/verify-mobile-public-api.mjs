#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isApprovedProductionApiUrl } from './check-mobile-release-config.mjs';
import { verifyMobilePublicApiSurface } from './verify-public-edge-surface.mjs';

const COMMERCE_MODES = new Set(['PRELAUNCH', 'LIVE']);

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Verifies the exact customer API baked into a store build and compares the
 * server's self-reported state with the build environment's declarations.
 *
 * Limitation: `/v1/public/config` currently exposes only `commerceMode` and
 * policy versions, not the server's PAYMENT_PROVIDER. Commerce mode is
 * therefore always attested, while PAYMENT_PROVIDER is attested only when a
 * future public config contract exposes `paymentProvider`. Until then the
 * result reports `paymentProviderAttested: false` and PAYMENT_PROVIDER stays a
 * build-environment declaration checked by check-mobile-release-config.mjs.
 */
export async function verifyMobilePublicApiFromEnvironment({
  environment = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const apiBaseUrl = trimmed(environment.EXPO_PUBLIC_DABBOBA_API_URL);
  const expectedCommerceMode = trimmed(environment.EXPO_PUBLIC_COMMERCE_CAPABILITY);
  const declaredServerMode = trimmed(environment.DABBOBA_COMMERCE_MODE);
  const declaredProvider = trimmed(environment.PAYMENT_PROVIDER);

  if (!apiBaseUrl || !COMMERCE_MODES.has(expectedCommerceMode)) {
    throw new Error('Mobile public API verification requires the candidate API URL and commerce capability.');
  }
  if (!isApprovedProductionApiUrl(apiBaseUrl)) {
    throw new Error('EXPO_PUBLIC_DABBOBA_API_URL host is not an approved production API host.');
  }
  if (!declaredServerMode) {
    throw new Error('DABBOBA_COMMERCE_MODE must be declared so the build can be compared with the server.');
  }
  if (declaredServerMode !== expectedCommerceMode) {
    throw new Error(`DABBOBA_COMMERCE_MODE=${declaredServerMode} does not match EXPO_PUBLIC_COMMERCE_CAPABILITY=${expectedCommerceMode}.`);
  }

  const phoneFlag = trimmed(environment.DABBOBA_PHONE_LOGIN_READY);
  if (phoneFlag && phoneFlag !== 'true' && phoneFlag !== 'false') {
    throw new Error('DABBOBA_PHONE_LOGIN_READY must be true or false.');
  }
  const result = await verifyMobilePublicApiSurface({
    apiBaseUrl,
    fetchImpl,
    expectedCommerceMode,
    requirePhoneLogin: phoneFlag === 'true',
  });
  const observedMode = result.observed?.commerceMode;
  if (observedMode !== declaredServerMode) {
    throw new Error(`Server reports commerceMode=${observedMode ?? 'unknown'}; build declares DABBOBA_COMMERCE_MODE=${declaredServerMode}.`);
  }

  const observedProvider = result.observed?.paymentProvider;
  if (observedProvider !== undefined) {
    if (!declaredProvider) {
      throw new Error(`Server reports paymentProvider=${observedProvider}; build declares no PAYMENT_PROVIDER.`);
    }
    if (observedProvider !== declaredProvider) {
      throw new Error(`Server reports paymentProvider=${observedProvider}; build declares PAYMENT_PROVIDER=${declaredProvider}.`);
    }
  }

  return {
    ...result,
    commerceModeAttested: true,
    paymentProviderAttested: observedProvider !== undefined,
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyMobilePublicApiFromEnvironment().then((result) => {
    if (!result.paymentProviderAttested) {
      process.stderr.write('WARN public config does not expose paymentProvider; only commerceMode was attested against the server.\n');
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`Mobile public API verification failed: ${error instanceof Error ? error.message : 'unknown response'}\n`);
    process.exitCode = 1;
  });
}
