import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4195';
const proof = new URL('../proof/', import.meta.url);

test('kuji ivory liner preserves closed/reset artwork and changes only the cavity apart from the approved shell ring', { timeout: 120000 }, async () => {
  const baseline = await readFile(new URL('kuji-before-interior.mjs', proof), 'utf8');
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], prohibited = [];
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
        prohibited.push(request.url()); return route.abort();
      }
      if (url.pathname === '/scenes/__kuji-before-interior.mjs') return route.fulfill({ contentType: 'text/javascript', body: baseline });
      if (url.pathname === '/__kuji-interior-test__') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
        @font-face { font-family: 'Noto Sans KR'; src: url('/assets/fonts/NotoSansKR_900Black.ttf'); font-weight: 900; }
        body { background: #101411; } canvas { display: block; }
      </style><canvas id="before"></canvas><canvas id="after"></canvas>` });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/__kuji-interior-test__`);
    const result = await page.evaluate(async () => {
      const [oldModule, newModule, { nativeTicketFront }, { acceptedShellMask }] = await Promise.all([
        import('/scenes/__kuji-before-interior.mjs'), import('/scenes/kuji.mjs'), import('/artwork.mjs'),
        import('/tests/kuji-shell-mask.mjs'),
      ]);
      const canvases = ['before', 'after'].map(id => document.getElementById(id));
      const scenes = [oldModule, newModule].map((module, index) => module.createKujiScene(canvases[index]));
      const front = await nativeTicketFront();
      await Promise.all(scenes.map(scene => scene.ready));
      scenes.forEach(scene => scene.setFrontTexture(front));
      const pixels = canvas => {
        const gl = canvas.getContext('webgl2');
        const values = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, values);
        return values;
      };
      // A separable 2-CSS-pixel expansion admits only edge filtering differences.
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
      const observations = [], captures = {};
      try {
        for (const dimensions of [[390, 500, 2], [320, 420, 1]]) {
          scenes.forEach(scene => scene.resize(...dimensions));
          const shellMask = await acceptedShellMask(canvases[0], scenes[0].getHitRect(), dimensions[2], front);
          const closed = { progress: 0, settle: 0, resultOpacity: 0, reducedMotion: false };
          // Build the cavity mask entirely from accepted BEFORE pixels: the
          // printed leaf disappears here, while the stationary outer remains.
          // This cannot bless an accidentally oversized new liner rectangle.
          scenes[0].render(closed);
          const oldClosed = pixels(canvases[0]);
          scenes[0].render({ progress: 1, settle: 1, resultOpacity: 1, reducedMotion: false });
          const oldEmpty = pixels(canvases[0]);
          const cavity = new Uint8Array(canvases[0].width * canvases[0].height);
          let cavityPixels = 0;
          for (let i = 0; i < cavity.length; i++) {
            cavity[i] = Number(oldClosed[i * 4 + 3] > oldEmpty[i * 4 + 3]);
            cavityPixels += cavity[i];
          }
          const allowed = dilate(cavity, canvases[0].width, canvases[0].height, Math.ceil(2 * dimensions[2]));
          const cases = [
            ['closed', closed],
            ...[.03, .25, .65, 1].map(progress => [`peel-${progress}`, { progress, settle: 0, resultOpacity: 0, reducedMotion: false }]),
            ['completed', { progress: 1, settle: 1, resultOpacity: 1, reducedMotion: false }],
            ['reset', closed],
            ['reduced-closed', { ...closed, reducedMotion: true }],
            ['reduced-completed', { progress: 0, settle: 0, resultOpacity: 1, reducedMotion: true }],
            ['reduced-reset', { ...closed, reducedMotion: true }],
            ['reopen', { progress: .65, settle: 0, resultOpacity: 0, reducedMotion: false }],
            ['reset-again', closed],
          ];
          for (const [name, state] of cases) {
            scenes.forEach(scene => scene.render(state));
            const [before, after] = canvases.map(pixels);
            let changedPixels = 0, outsideCavityPixels = 0, changedOutsideShellPixels = 0, newlyCoveredCavityPixels = 0;
            for (let i = 0; i < cavity.length; i++) {
              const offset = i * 4;
              const changed = [0, 1, 2, 3].some(channel => before[offset + channel] !== after[offset + channel]);
              if (changed) {
                changedPixels++;
                if (!shellMask[i]) changedOutsideShellPixels++;
                if (!allowed[i] && !shellMask[i]) outsideCavityPixels++;
              }
              if (cavity[i] && after[offset + 3] > before[offset + 3]) newlyCoveredCavityPixels++;
            }
            const inspected = scenes[1].inspect(), prior = scenes[0].inspect();
            observations.push({ dimensions, name, state, changedPixels, changedOutsideShellPixels, outsideCavityPixels, newlyCoveredCavityPixels,
              cavityPixels, liner: inspected.interiorLiner, paperVisible: inspected.paperVisible, light: inspected.lightLeak,
              geometryUnchanged: JSON.stringify([inspected.hitRect, inspected.subdivisions, inspected.thickness])
                === JSON.stringify([prior.hitRect, prior.subdivisions, prior.thickness]) });
            if (dimensions[0] === 390 && ['closed', 'peel-0.25', 'peel-0.65', 'completed', 'reduced-completed'].includes(name)) {
              captures[`kuji-interior-${name}`] = canvases[1].toDataURL('image/png');
              if (name === 'closed') captures['kuji-interior-before-closed'] = canvases[0].toDataURL('image/png');
            }
          }
        }
        return { observations, captures, scope: 'Local headless Chromium software GPU; original cavity only plus independently bounded v5 shell ring; closed artwork exact, not native/device evidence' };
      } finally { scenes.forEach(scene => scene.dispose()); }
    });
    const { captures, ...report } = result;
    await mkdir(proof, { recursive: true });
    await writeFile(new URL('kuji-interior-report.json', proof), JSON.stringify(report, null, 2));
    for (const [name, data] of Object.entries(captures)) await writeFile(new URL(`${name}.png`, proof), Buffer.from(data.split(',')[1], 'base64'));
    assert.deepEqual(errors, []); assert.deepEqual(prohibited, []);
    assert.equal(report.observations.length, 24);
    for (const sample of report.observations) {
      assert.ok(sample.cavityPixels > 0, 'Accepted-source cavity mask must not be empty');
      assert.ok(sample.geometryUnchanged, 'Original camera, hit rect, thickness and curl subdivisions stay exact');
      assert.equal(sample.outsideCavityPixels, 0, `${sample.name} at ${sample.dimensions}: changes stay within original cavity or approved shell ring + 2 CSS px AA`);
      assert.equal(sample.liner.material, 'ivory printed stock');
      assert.equal(sample.liner.source, 'inverse original stationary cavity alpha');
      assert.equal(sample.liner.frontOccluded, true);
      const closed = sample.state.progress === 0 && sample.state.resultOpacity === 0;
      if (closed) {
        assert.equal(sample.changedOutsideShellPixels, 0, `${sample.name} original CLOSED artwork/cavity must remain exact; only the approved shell ring may change`);
        assert.equal(sample.liner.visible, false);
        assert.equal(sample.light.visible, false);
      } else assert.equal(sample.liner.visible, true, `${sample.name} requires the interior layer`);
      if (sample.name === 'completed' || sample.name === 'reduced-completed') {
        assert.equal(sample.paperVisible, false);
        assert.equal(sample.light.visible, false);
        assert.equal(sample.light.fade, 0);
        assert.ok(sample.changedPixels > 0 && sample.newlyCoveredCavityPixels > 0, 'Result needs visible ivory stock, not a metadata-only liner');
      }
    }
  } finally { await browser.close(); }
});
