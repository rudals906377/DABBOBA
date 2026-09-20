import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';
import { SUPABASE_EDGE_PROFILE_FILE } from './prepare-supabase-edge-profile.mjs';

const baseUrl = `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1`;

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(130_000),
    ...init,
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  return { response, body };
}

function expectStatus(result, status, label) {
  if (result.response.status !== status) {
    throw new Error(`${label} returned ${result.response.status}, expected ${status}.`);
  }
}

async function main() {
  const profile = parseEnv(readFileSync(SUPABASE_EDGE_PROFILE_FILE, 'utf8'));
  const health = await jsonRequest('/dabboba-api/healthz');
  expectStatus(health, 200, 'API health');
  const ready = await jsonRequest('/dabboba-api/readyz');
  expectStatus(ready, 200, 'API readiness');
  const catalog = await jsonRequest('/dabboba-api/v1/catalog/products?limit=1');
  expectStatus(catalog, 200, 'API catalog');

  const denied = await jsonRequest('/dabboba-worker', {
    method: 'POST',
    headers: { authorization: `Bearer ${'x'.repeat(48)}` },
  });
  expectStatus(denied, 401, 'Worker unauthorized boundary');

  const worker = await jsonRequest('/dabboba-worker', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${profile.DABBOBA_WORKER_INVOKE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ source: 'manual-smoke' }),
  });
  expectStatus(worker, 200, 'Worker execution');
  if (worker.body?.ok !== true || typeof worker.body?.status !== 'string') {
    throw new Error('Worker execution response is invalid.');
  }
  process.stdout.write(JSON.stringify({
    api: { health: 200, readiness: 200, catalog: 200 },
    worker: {
      unauthorized: 401,
      authorized: 200,
      status: worker.body.status,
      outboxPublished: worker.body.outboxPublished,
      outboxDeferred: worker.body.outboxDeferred,
      queueCompleted: worker.body.queueCompleted,
      queueRetried: worker.body.queueRetried,
      queueDeadLettered: worker.body.queueDeadLettered,
      periodicCompleted: worker.body.periodicCompleted,
      periodicFailed: worker.body.periodicFailed,
    },
  }, null, 2));
  process.stdout.write('\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Supabase Edge runtime verification failed.'}\n`);
  process.exitCode = 1;
});
