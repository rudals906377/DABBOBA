import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePhotoSyncTarget } from '../scripts/sync-product-photo-catalog.mjs';

const approved = {
  databaseUrl: 'postgresql://dabboba_runtime.rconfxsykttfvznakile:secret@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres',
  supabaseUrl: 'https://rconfxsykttfvznakile.supabase.co',
  s3Endpoint: 'https://rconfxsykttfvznakile.storage.supabase.co/storage/v1/s3',
};

test('the photo sync targets the approved project and its rebased delivery host', () => {
  assert.deepEqual(resolvePhotoSyncTarget(approved), {
    projectRef: 'rconfxsykttfvznakile',
    catalogBaseUrl: 'https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api',
  });
  assert.equal(
    resolvePhotoSyncTarget({ ...approved, databaseUrl: 'postgresql://postgres:secret@db.rconfxsykttfvznakile.supabase.co:5432/postgres' }).projectRef,
    'rconfxsykttfvznakile',
  );
});

test('the photo sync refuses the legacy project or any mixed endpoint before connecting', () => {
  const legacy = 'yxkmvgfruphgghowzvmo';
  for (const override of [
    { databaseUrl: `postgresql://postgres:secret@db.${legacy}.supabase.co:5432/postgres` },
    { supabaseUrl: `https://${legacy}.supabase.co` },
    { s3Endpoint: `https://${legacy}.storage.supabase.co/storage/v1/s3` },
    { supabaseUrl: 'http://rconfxsykttfvznakile.supabase.co' },
    { s3Endpoint: undefined },
  ]) {
    assert.throws(() => resolvePhotoSyncTarget({ ...approved, ...override }), /승인된 하나의 프로젝트/);
  }
});
