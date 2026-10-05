import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app = readFileSync(new URL('../public/review/app.js', import.meta.url), 'utf8');

test('review page shows inventory counts only when the server sent real totals', () => {
  const start = app.indexOf('const quantityLine = ');
  const quantityLine = new Function('esc', `${app.slice(start, app.indexOf('\nconst cards = ', start))}; return quantityLine;`)(
    (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  );
  assert.equal(quantityLine({totalQuantity: 1200, openedQuantity: 35}), '전체 1,200개 / 35개 오픈');
  for (const product of [{totalQuantity: null, openedQuantity: null}, {}, {totalQuantity: '<img>', openedQuantity: 1}, {totalQuantity: -1, openedQuantity: 0}]) {
    assert.equal(quantityLine(product), '');
  }
  // No raw interpolation of server quantities remains in innerHTML templates.
  assert.doesNotMatch(app, /\$\{p(?:roduct)?\.(?:totalQuantity|openedQuantity)\}/);
});
