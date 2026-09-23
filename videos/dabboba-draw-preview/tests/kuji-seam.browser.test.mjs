import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4195';
const proof = new URL('../proof/', import.meta.url);

test('attached ticket matches a single assembled print without changing the curled leaf', { timeout: 120000 }, async () => {
  const baseline = await readFile(new URL('kuji-before-seam-cleanup.mjs', proof), 'utf8');
  // An independent, completely flat one-image reference through the previous
  // renderer. It is only used at p=0, not as a new animation implementation.
  const reference = baseline.replace('function applyFrontTexture(texture) {', `function applyFrontTexture(texture) {
    if (outerMaterial.map?.image) {
      const c = document.createElement('canvas'); c.width = ART_WIDTH; c.height = ART_HEIGHT;
      const ctx = c.getContext('2d');
      ctx.drawImage(outerMaterial.map.image, 0, 0, ART_WIDTH, ART_HEIGHT);
      ctx.drawImage(texture.image, 0, 0, ART_WIDTH, ART_HEIGHT);
      texture = new THREE.CanvasTexture(c); ownedTextures.add(texture);
    }
  `);
  assert.notEqual(reference, baseline);
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], prohibited = [];
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
        prohibited.push(request.url()); return route.abort();
      }
      if (url.pathname === '/scenes/__kuji-before-seam.mjs') return route.fulfill({ contentType: 'text/javascript', body: baseline });
      if (url.pathname === '/scenes/__kuji-flat-reference.mjs') return route.fulfill({ contentType: 'text/javascript', body: reference });
      if (url.pathname === '/__kuji-seam-test__') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
        @font-face { font-family: 'Noto Sans KR'; src: url('/assets/fonts/NotoSansKR_900Black.ttf'); font-weight: 900; }
        body { background: #101411; } canvas { display: block; }
      </style><canvas id="before"></canvas><canvas id="after"></canvas><canvas id="reference"></canvas>` });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/__kuji-seam-test__`);
    const result = await page.evaluate(async () => {
      const [oldModule, newModule, flatModule, { nativeTicketFront }, { acceptedShellMask }] = await Promise.all([
        import('/scenes/__kuji-before-seam.mjs'), import('/scenes/kuji.mjs'),
        import('/scenes/__kuji-flat-reference.mjs'), import('/artwork.mjs'),
        import('/tests/kuji-shell-mask.mjs'),
      ]);
      const canvases = ['before', 'after', 'reference'].map(id => document.getElementById(id));
      const scenes = [oldModule, newModule, flatModule].map((module, i) => module.createKujiScene(canvases[i]));
      const front = await nativeTicketFront();
      await Promise.all(scenes.map(scene => scene.ready));
      scenes.forEach(scene => scene.setFrontTexture(front));
      const pixels = canvas => {
        const gl = canvas.getContext('webgl2'), a = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, a); return a;
      };
      const diff = (a, b, mask = null) => {
        let changedPixels = 0, totalError = 0, maxError = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (mask && !mask[i / 4]) continue;
          let changed = false;
          for (let c = 0; c < 4; c++) { const error = Math.abs(a[i+c]-b[i+c]); changed ||= error > 0; totalError += error; maxError = Math.max(maxError, error); }
          if (changed) changedPixels++;
        }
        return { changedPixels, totalError, maxError };
      };
      const sourceAlpha = front.getContext('2d').getImageData(0, 0, front.width, front.height).data;
      function dilate(mask, width, height, radius) {
        const horizontal = new Uint8Array(mask.length), output = new Uint8Array(mask.length);
        for (let y = 0; y < height; y++) {
          let count = 0;
          for (let x = 0; x <= Math.min(radius, width - 1); x++) count += mask[y * width + x];
          for (let x = 0; x < width; x++) {
            horizontal[y * width + x] = Number(count > 0);
            if (x - radius >= 0) count -= mask[y * width + x - radius];
            if (x + radius + 1 < width) count += mask[y * width + x + radius + 1];
          }
        }
        for (let x = 0; x < width; x++) {
          let count = 0;
          for (let y = 0; y <= Math.min(radius, height - 1); y++) count += horizontal[y * width + x];
          for (let y = 0; y < height; y++) {
            output[y * width + x] = Number(count > 0);
            if (y - radius >= 0) count -= horizontal[(y - radius) * width + x];
            if (y + radius + 1 < height) count += horizontal[(y + radius + 1) * width + x];
          }
        }
        return output;
      }
      function printedLeafMask() {
        const canvas = canvases[1], hit = scenes[1].getHitRect();
        const fractionX = 300 / 316, fractionY = (1037 / 1517 * 300) / (1037 / 1517 * 300 + 16);
        const left = (hit.x + hit.width * (1 - fractionX) / 2) * canvas.width;
        const top = (hit.y + hit.height * (1 - fractionY) / 2) * canvas.height;
        const w = hit.width * fractionX * canvas.width, h = hit.height * fractionY * canvas.height;
        const mask = new Uint8Array(canvas.width * canvas.height);
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const u = Math.floor((x + .5 - left) / w * front.width);
          const v = Math.floor((canvas.height - y - .5 - top) / h * front.height);
          if (u >= 0 && u < front.width && v >= 0 && v < front.height) mask[y*canvas.width+x] = sourceAlpha[(v*front.width+u)*4+3] > 0 ? 1 : 0;
        }
        return mask;
      }
      const observations = [], captures = {};
      try {
        for (const dimensions of [[390, 500, 2], [360, 460, 1], [780, 560, 1]]) {
          scenes.forEach(scene => scene.resize(...dimensions));
          const leafMask = printedLeafMask();
          const allowedInterior = dilate(leafMask, canvases[1].width, canvases[1].height, Math.ceil(2 * dimensions[2]));
          const shellMask = await acceptedShellMask(canvases[0], scenes[0].getHitRect(), dimensions[2], front);
          const outsideInterior = allowedInterior.map((value, index) => Number(!value && !shellMask[index]));
          for (const progress of [0, .03, .25, .65, 1, 0]) {
            scenes.forEach(scene => scene.render({ progress, settle: 0, resultOpacity: 0 }));
            const [old, current, reference] = canvases.map(pixels);
            observations.push({ dimensions, progress, beforeVsAfter: diff(old, current), outsideInterior: diff(old, current, outsideInterior),
              ...(progress === 0 ? { beforeVsFlat: diff(old, reference), afterVsFlat: diff(current, reference),
                leafBeforeVsFlat: diff(old, reference, leafMask), leafAfterVsFlat: diff(current, reference, leafMask) } : {}) });
            if (dimensions[0] === 390 && [0, .03, .25, .65, 1].includes(progress)) {
              captures[`kuji-seam-${progress}`] = canvases[1].toDataURL('image/png');
              if (progress === 0) captures['kuji-seam-before-0'] = canvases[0].toDataURL('image/png');
            }
          }
        }
        return { observations, captures, scope: 'Local software GPU, original artwork retained; no native/device claims' };
      } finally { scenes.forEach(scene => scene.dispose()); }
    });
    const { captures, ...report } = result;
    await writeFile(new URL('kuji-seam-report.json', proof), JSON.stringify(report, null, 2));
    for (const [name, data] of Object.entries(captures)) await writeFile(new URL(`${name}.png`, proof), Buffer.from(data.split(',')[1], 'base64'));
    assert.deepEqual(errors, []); assert.deepEqual(prohibited, []);
    for (const sample of report.observations) {
      if (sample.progress === 0) {
        assert.ok(sample.beforeVsFlat.totalError > 0, 'The original split-alpha seam must be reproduced');
        assert.ok(sample.leafAfterVsFlat.totalError < sample.leafBeforeVsFlat.totalError * .10, 'Printed leaf seam error must drop by at least 90%; the stationary outer margin is intentionally separate');
      }
      if (sample.progress === 1) assert.equal(sample.outsideInterior.changedPixels, 0,
        'Only the original cavity and independently bounded approved shell ring may change; all other pixels remain exact');
    }
  } finally { await browser.close(); }
});
