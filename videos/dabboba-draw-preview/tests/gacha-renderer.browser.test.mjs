import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4195';
const proof = new URL('../proof/', import.meta.url);

test('only the bounded pre-focus contact shadow changes RGBA; atlas caching and later frames remain exact', { timeout: 120000 }, async () => {
  const baseline = await readFile(new URL('gacha-renderer-before-smooth.mjs', proof), 'utf8');
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], prohibited = [];
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
        prohibited.push(request.url()); return route.abort();
      }
      if (url.pathname === '/scenes/__before-smooth.mjs') return route.fulfill({ contentType: 'text/javascript', body: baseline });
      if (url.pathname === '/__renderer-test__') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id="before"></canvas><canvas id="after"></canvas>' });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/__renderer-test__`);
    const result = await page.evaluate(async () => {
      const [{ createGachaScene: beforeScene }, { createGachaScene: afterScene }, { sampleGacha }] = await Promise.all([
        import('/scenes/__before-smooth.mjs'), import('/scenes/gacha.mjs'), import('/motion.mjs'),
      ]);
      const beforeCanvas = document.querySelector('#before'), afterCanvas = document.querySelector('#after');
      const before = beforeScene(beforeCanvas), after = afterScene(afterCanvas);
      await Promise.all([before.ready, after.ready]);
      const frames = [];
      function pixels(canvas) {
        const gl = canvas.getContext('webgl2');
        const bytes = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        return bytes;
      }
      function compare(time, dimensions, reducedMotion = false) {
        const state = sampleGacha(time, reducedMotion);
        before.render(state); after.render(state);
        const a = pixels(beforeCanvas), b = pixels(afterCanvas);
        const inspected = after.inspect(), original = before.inspect();
        const shadow = inspected.projection.contactShadow;
        const pixelRatioX = afterCanvas.width / dimensions[0];
        const pixelRatioY = afterCanvas.height / dimensions[1];
        let differentBytes = 0, outsideShadowBytes = 0;
        for (let i = 0; i < a.length; i++) {
          if (a[i] === b[i]) continue;
          differentBytes++;
          const pixel = Math.floor(i / 4);
          const x = (pixel % afterCanvas.width + .5) / pixelRatioX;
          // readPixels starts at the lower-left; projection uses CSS top-left.
          const y = (afterCanvas.height - Math.floor(pixel / afterCanvas.width) - .5) / pixelRatioY;
          const inside = shadow && state.focus < 1 && !reducedMotion && shadow.opacity > 0
            && x >= shadow.left - 2 && x <= shadow.left + shadow.width + 2
            && y >= shadow.top - 2 && y <= shadow.top + shadow.height + 2;
          if (!inside) outsideShadowBytes++;
        }
        const projectionUnchanged = Object.entries(original.projection)
          .every(([key, value]) => JSON.stringify(inspected.projection[key]) === JSON.stringify(value));
        frames.push({ time, dimensions, reducedMotion, state, differentBytes, outsideShadowBytes,
          projectionUnchanged, projection: inspected.projection, ...inspected.rendering });
      }
      try {
        before.resize(390, 500, 1); after.resize(390, 500, 1);
        for (const time of [0, .44, .50, .70, .89, 1.10, 1.20, 1.50, 1.65, 1.74, 1.76, 1.80,
          1.92, 2.10, 2.53, 3.12, 3.30, 3.71, 3.83, 4, 4.06, 4.2, 0, 3, 1.65, 1.65]) compare(time, [390, 500, 1]);
        before.resize(360, 480, 2); after.resize(360, 480, 2);
        for (const time of [.50, 1.65, 1.80, 2.53, 4.2]) compare(time, [360, 480, 2]);
        compare(1.10, [360, 480, 2], true);
        return { frames, scope: 'same motion state through previous and current renderers; only the finite contact-shadow footprint plus 2 CSS px antialias allowance may differ before focus ends' };
      } finally { before.dispose(); after.dispose(); }
    });
    await writeFile(new URL('gacha-renderer-regression.json', proof), JSON.stringify(result, null, 2));
    assert.equal(result.frames.length, 32);
    assert.ok(result.frames.every(frame => frame.outsideShadowBytes === 0), 'Every RGBA byte outside the approved shadow footprint must stay exact');
    assert.ok(result.frames.every(frame => frame.projectionUnchanged), 'Camera, capsule, aperture and machine projection must remain exact');
    assert.ok(result.frames.some(frame => frame.time === .50 && frame.differentBytes > 0), 'The landing contact shadow must make a visible change within its footprint');
    for (const frame of result.frames) {
      const { contactShadow: shadow, centerX, restY, diameter } = frame.projection;
      assert.ok(shadow && Object.values(shadow).every(Number.isFinite), 'Shadow inspection must expose a finite CSS-pixel rectangle and opacity');
      const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, label);
      near(shadow.left, centerX - diameter * .36, 'shadow left');
      near(shadow.top, restY + diameter * .43, 'shadow top');
      near(shadow.width, diameter * .72, 'shadow width');
      near(shadow.height, diameter * .14, 'shadow height');
      const expectedOpacity = frame.time >= .44 && !frame.reducedMotion
        ? .30 * Math.exp(-frame.state.dropHeight * 9) * (1 - frame.state.focus) : 0;
      near(shadow.opacity, expectedOpacity, 'contact shadow grows only near the tray and fades with focus');
      if (frame.time >= 1.8 || frame.time < .44 || frame.reducedMotion) assert.equal(frame.differentBytes, 0,
        'Closed early-fall, reduced-motion and fully focused frames remain pixel-identical');
      assert.deepEqual(frame.atlasResolution, [576, 768], 'No atlas quality reduction is permitted');
    }
    const closedFocus = result.frames.find(frame => frame.time === 1.65);
    assert.equal(closedFocus.state.opening, 0);
    assert.equal(closedFocus.lastAtlasUpdated, false, 'Pre-opening zoom must reuse the exact closed-shell atlas');
    const repeated = result.frames.filter(frame => frame.time === 1.65 && frame.dimensions[0] === 390).slice(-2);
    assert.equal(repeated[1].atlasRenderCount, repeated[0].atlasRenderCount, 'Identical repeated seeks must not rerender the closed atlas');
    const opening = result.frames.find(frame => frame.time === 2.53);
    assert.equal(opening.lastPassCount, 3, 'Opening needs only atlas, spill and capsule passes instead of six');
    assert.equal(opening.lastAtlasUpdated, true);
    assert.deepEqual(opening.atlasResolution, [576, 768]);
    assert.deepEqual(errors, []); assert.deepEqual(prohibited, []);
  } finally { await browser.close(); }
});
