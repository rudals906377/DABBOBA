import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkSupabaseLiveCandidate, readSupabaseLiveCandidateProfile } from '../scripts/check-supabase-live-candidate.mjs';

test('LIVE candidate reader rejects public files and symlinks before parsing credentials', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dabboba-live-candidate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const publicPath = join(directory, 'public.env');
  writeFileSync(publicPath, 'DABBOBA_ENVIRONMENT_TIER=PRODUCTION\n', { mode: 0o644 });
  assert.throws(() => readSupabaseLiveCandidateProfile(publicPath), /private regular file/);
  const symlinkPath = join(directory, 'linked.env');
  symlinkSync(publicPath, symlinkPath);
  assert.throws(() => readSupabaseLiveCandidateProfile(symlinkPath));
});

test('LIVE candidate check reports only reviewed non-secret evidence and never deploys', async () => {
  const secret = 'must-not-appear-in-check-result';
  const input = { DABBOBA_API_PORTONE_API_SECRET: secret };
  let calls = 0;
  const result = await checkSupabaseLiveCandidate({
    readProfile() { calls += 1; return input; },
    preflight({ edgeProfile, expectedCommerceMode }) {
      calls += 1;
      assert.equal(edgeProfile, input);
      assert.equal(expectedCommerceMode, 'LIVE');
      return {
        sourceHead: 'a'.repeat(40),
        latestMigration: '0075_shipping_request_retry_after_cancellation.sql',
        targetHash: 'b'.repeat(64),
        releaseConfiguration: { customerAuthProviders: ['PHONE', 'KAKAO', 'NAVER', 'GOOGLE', 'APPLE'] },
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 'candidate-checked');
  assert.doesNotMatch(JSON.stringify(result), /must-not-appear/);
});
