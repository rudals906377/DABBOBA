import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFileNames, productFolders } from '../scripts/inspect-local-product-media.mjs';

test('Sylvanian gallery images are not silently counted as prize types', () => {
  const product = productFolders.find((item) => item.id === 'gacha-sylvanian-adventure');
  const result = classifyFileNames(['1.jpg', '2.jpg', '3.jpg', '시크릿.jpeg', '아기 팬더.jpeg'], product);
  assert.deepEqual(result.cover, []);
  assert.deepEqual(result.gallery, ['1.jpg', '2.jpg', '3.jpg']);
  assert.deepEqual(result.detail, ['시크릿.jpeg', '아기 팬더.jpeg']);
});

test('NFD local filenames match the reviewed NFC cover name', () => {
  const product = productFolders.find((item) => item.id === 'gacha-demon-slayer-onemutan-13');
  const result = classifyFileNames(['오네무탄 13형.jpg'.normalize('NFD'), '도우마.jpeg'.normalize('NFD')], product);
  assert.equal(result.cover.length, 1);
  assert.equal(result.detail.length, 1);
});

test('gallery order follows the reviewed slide order, not filesystem order', () => {
  const product = productFolders.find((item) => item.id === 'gacha-sylvanian-adventure');
  const result = classifyFileNames(['3.jpg', '시크릿.jpeg', '2.jpg', '1.jpg'], product);
  assert.deepEqual(result.gallery, ['1.jpg', '2.jpg', '3.jpg']);
  assert.deepEqual(result.detail, ['시크릿.jpeg']);
});
