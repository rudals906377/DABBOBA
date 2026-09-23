import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('playwright-core/lib/utilsBundle');
const [scene, preview, capture, maskBytes, previewHtml, captureHtml] = await Promise.all([
  readFile(new URL('../scenes/kuji.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../preview.css', import.meta.url), 'utf8'),
  readFile(new URL('../capture.css', import.meta.url), 'utf8'),
  readFile(new URL('../assets/kuji/kuji-ticket-peel-layer.png', import.meta.url)),
  readFile(new URL('../preview.html', import.meta.url), 'utf8'),
  readFile(new URL('../kuji/index.html', import.meta.url), 'utf8'),
]);
const mask = PNG.sync.read(maskBytes);
const resultBlock = scene.match(/function getResultRect\(\) \{([\s\S]*?)\n  \}/)?.[1];
assert.ok(resultBlock, 'result projection must remain independently inspectable');
const corners = [...resultBlock.matchAll(/new THREE\.Vector3\(([-.\d]+) \* WIDTH, ([-.\d]+) \* HEIGHT, PAPER_Z\)/g)]
  .map(match => [Number(match[1]), Number(match[2])]);
assert.equal(corners.length, 2);

function cssRule(css, selector) {
  const rules = [];
  let start = css.indexOf(`${selector}{`);
  while (start >= 0) {
    const end = css.indexOf('}', start);
    rules.push(css.slice(start + selector.length + 1, end));
    start = css.indexOf(`${selector}{`, end);
  }
  assert.ok(rules.length, `Missing ${selector}`);
  return rules.join(';');
}

test('enlarged result area retains fully peeled padding inside the original cavity', () => {
  const [[left, top], [right, bottom]] = corners;
  const padding = 37;
  const x0 = Math.ceil((left + .5) * mask.width) - padding;
  const x1 = Math.floor((right + .5) * mask.width) + padding;
  const y0 = Math.ceil((.5 - top) * mask.height) - padding;
  const y1 = Math.floor((.5 - bottom) * mask.height) + padding;
  assert.ok(x0 >= 0 && y0 >= 0 && x1 < mask.width && y1 < mask.height);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      assert.equal(mask.data[(y * mask.width + x) * 4 + 3], 255, `Result or safety padding overlaps original orange frame at ${x},${y}`);
    }
  }
});

test('preview and capture keep the same larger image column and reserved two-line name', () => {
  for (const [css, root, name] of [
    [preview, '.device[data-scene=kuji] .kuji-result', 'p'],
    [capture, '[data-scene=kuji] #capture-result', 'span'],
  ]) {
    assert.match(cssRule(css, root), /grid-template-columns:48% minmax\(0,1fr\)/);
    assert.match(cssRule(css, root), /gap:6px 12px/);
    assert.match(cssRule(css, `${root} img`), /width:100%;height:auto;max-height:112px;object-fit:contain/);
    const title = cssRule(css, `${root} ${name}`);
    assert.match(title, /-webkit-line-clamp:2/);
    assert.match(title, /min-height:3\.1em/);
    assert.match(title, /font-size:14px/);
    assert.match(title, /line-height:1\.55/);
  }
  assert.match(preview, /@media\(max-width:350px\)\{\.device\[data-scene=kuji\] \.kuji-result\{column-gap:10px\}\.device\[data-scene=kuji\] \.kuji-result p\{font-size:13px\}\}/);
});

test('ivory interior uses readable printed ink without tinting the fixture or adding a DOM card', () => {
  for (const [css, root, name, disclosure] of [
    [preview, '.device[data-scene=kuji] .kuji-result', 'p', 'span'],
    [capture, '[data-scene=kuji] #capture-result', 'span', 'p'],
  ]) {
    assert.doesNotMatch(cssRule(css, root), /background(?:-color)?:|box-shadow:|border:/);
    const photo = cssRule(css, `${root} img`);
    assert.match(photo, /border-radius:0(?:;|$)/);
    assert.doesNotMatch(photo, /(?:^|;)(?:filter|mix-blend-mode|opacity):/);
    assert.match(cssRule(css, `${root} ${name}`), /color:#28271f(?:;|$)/);
    const note = cssRule(css, `${root} ${disclosure}`);
    assert.match(note, /color:#655f50(?:;|$)/);
    assert.match(note, /font-family:Galmuri11,sans-serif/);
    assert.match(note, /font-size:10px;line-height:1\.6/);
  }
  const luminance = hex => {
    const rgb = hex.match(/[0-9a-f]{2}/g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  // Static palette contrast only; rendered contrast remains a GPU/HF check.
  for (const ink of ['28271f', '655f50']) {
    assert.ok((luminance('f8f6ed') + .05) / (luminance(ink) + .05) >= 4.5);
  }
  for (const html of [previewHtml, captureHtml]) {
    assert.match(html, /src="(?:\.\/)?assets\/products\/sample-kuji-rabbit\.jpeg"/);
    assert.match(html, /초콜릿 토끼<br>티아라/);
    assert.match(html, /시안 예시 · 실제 당첨 아님/);
    const result = html.match(/<div[^>]+(?:class="kuji-result"|id="capture-result")[^>]*>([\s\S]*?)<\/div>/)?.[1];
    assert.ok(result);
    assert.doesNotMatch(result, /(?:[A-Z]상|[A-Z]등급|SSR|serial|rarity|dabboba-wordmark)/);
  }
});

test('image grows 20–30 percent without exceeding the available row at mobile and desktop widths', () => {
  const [[left, top], [right, bottom]] = corners;
  // These are projection/layout bounds, not a substitute for rendered-browser
  // text-fit QA. The existing scene test fingerprints the unchanged resize.
  for (const stageWidth of [286, 356, 388, 390, 396]) {
    const ticketPixels = stageWidth * .735;
    const resultWidth = (right - left) * 3 / 3.16 * ticketPixels;
    const resultHeight = (top - bottom) * (3 * mask.height / mask.width) / 3.16 * ticketPixels * (10 / Math.hypot(10, .55));
    const oldImage = .74 * 3 / 3.16 * ticketPixels * .42;
    const imageWidth = resultWidth * .48;
    const imageHeight = imageWidth * 528 / 529;
    const availableRowHeight = resultHeight - 4 - 6 - 16;
    assert.ok(imageWidth / oldImage >= 1.2 && imageWidth / oldImage <= 1.3);
    assert.ok(imageHeight < availableRowHeight, `Image clips at ${stageWidth}px stage`);
    assert.ok(imageHeight < 112, 'max-height must not cancel the intended enlargement');
    const small = stageWidth === 286;
    const titleWidth = resultWidth - imageWidth - (small ? 10 : 12);
    assert.ok(titleWidth >= (small ? 13 : 14) * 5.6, 'fixture name needs a five-Hangul first line plus space');
  }
});
