#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';

const WORKER_URL = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-worker`;

async function probeWorker(fetchImpl, method) {
  let response;
  try {
    response = await fetchImpl(WORKER_URL, {
      method,
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error('LIVE worker boundary is unreachable.');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('LIVE worker boundary did not return its expected JSON contract.');
  }
  return { status: response.status, body };
}

/** Read-only deployment/auth-boundary check; no invoke secret or work payload is sent. */
export async function verifyLiveEdgeWorkerBoundary({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('LIVE worker boundary requires fetch.');
  const methodDenied = await probeWorker(fetchImpl, 'GET');
  if (methodDenied.status !== 405 || methodDenied.body?.ok !== false
    || methodDenied.body?.code !== 'METHOD_NOT_ALLOWED') {
    throw new Error('LIVE worker boundary has no verified deployed handler.');
  }

  // The deployed handler checks its invoke secret before any worker config or
  // job is read. An anonymous request must be denied, never run the worker.
  const anonymousDenied = await probeWorker(fetchImpl, 'POST');
  if (anonymousDenied.status !== 401 || anonymousDenied.body?.ok !== false
    || anonymousDenied.body?.code !== 'UNAUTHORIZED') {
    throw new Error('LIVE worker boundary did not deny an anonymous invocation.');
  }
  return { deployed: true, anonymousDenied: true };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  verifyLiveEdgeWorkerBoundary().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`LIVE worker verification failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
