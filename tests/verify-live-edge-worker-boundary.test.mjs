import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyLiveEdgeWorkerBoundary } from '../scripts/verify-live-edge-worker-boundary.mjs';

const workerUrl = 'https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-worker';

function workerFetch({ getStatus = 405, getCode = 'METHOD_NOT_ALLOWED', postStatus = 401, postCode = 'UNAUTHORIZED' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const status = init.method === 'GET' ? getStatus : postStatus;
    const code = init.method === 'GET' ? getCode : postCode;
    return new Response(JSON.stringify({ ok: false, code }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

test('LIVE worker check proves deployed handler and configured anonymous-denial boundary without invoking work', async () => {
  const { calls, fetchImpl } = workerFetch();
  const result = await verifyLiveEdgeWorkerBoundary({ fetchImpl });
  assert.deepEqual(result, { deployed: true, anonymousDenied: true });
  assert.deepEqual(calls.map(({ url, init }) => [url, init.method]), [
    [workerUrl, 'GET'],
    [workerUrl, 'POST'],
  ]);
  assert.equal(calls.every(({ init }) => init.redirect === 'error' && init.signal instanceof AbortSignal), true);
  assert.equal(calls.every(({ init }) => !init.headers?.authorization && init.body === undefined), true);
});

test('LIVE worker check rejects missing deployment, missing invoke secret, and generic gateway responses', async () => {
  for (const fixture of [
    { getStatus: 404 },
    { getCode: 'SOME_OTHER_HANDLER' },
    { postStatus: 503, postCode: 'WORKER_AUTH_UNAVAILABLE' },
    { postCode: 'GATEWAY_UNAUTHORIZED' },
  ]) {
    await assert.rejects(
      verifyLiveEdgeWorkerBoundary({ fetchImpl: workerFetch(fixture).fetchImpl }),
      /LIVE worker boundary/i,
    );
  }
});

test('LIVE worker check does not hide an unreachable endpoint', async () => {
  await assert.rejects(
    verifyLiveEdgeWorkerBoundary({ fetchImpl: async () => { throw new Error('network down'); } }),
    /LIVE worker boundary/i,
  );
});
