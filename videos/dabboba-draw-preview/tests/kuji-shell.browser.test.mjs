import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = 'http://127.0.0.1:4195';
const proof = new URL('../proof/', import.meta.url);

test('v5 orange shell changes only the original exterior ring and preserves v4 print, cavity, curl and resets', { timeout: 120000 }, async () => {
  const baseline = await readFile(new URL('kuji-before-shell.mjs', proof), 'utf8');
  assert.match(baseline, /paper-ivory-result-liner-v4/);
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], prohibited = [];
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
        prohibited.push(request.url()); return route.abort();
      }
      if (url.pathname === '/scenes/__kuji-before-shell.mjs') return route.fulfill({ contentType: 'text/javascript', body: baseline });
      if (url.pathname === '/__kuji-shell-test__') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
        @font-face { font-family: 'Noto Sans KR'; src: url('/assets/fonts/NotoSansKR_900Black.ttf'); font-weight: 900; }
        body { background: #101411; } canvas { display: block; }
      </style><canvas id="before"></canvas><canvas id="after"></canvas>` });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${origin}/__kuji-shell-test__`);
    const result = await page.evaluate(async () => {
      const [prior, current, { nativeTicketFront }, { acceptedShellMask }] = await Promise.all([
        import('/scenes/__kuji-before-shell.mjs'), import('/scenes/kuji.mjs'),
        import('/artwork.mjs'), import('/tests/kuji-shell-mask.mjs'),
      ]);
      const canvases = ['before', 'after'].map(id => document.getElementById(id));
      const scenes = [prior, current].map((module, index) => module.createKujiScene(canvases[index]));
      const front = await nativeTicketFront();
      await Promise.all(scenes.map(scene => scene.ready));
      scenes.forEach(scene => scene.setFrontTexture(front));
      const pixels = canvas => {
        const gl = canvas.getContext('webgl2'), values = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, values);
        return values;
      };
      const difference = (before, after, allowed, width = 0, height = 0) => {
        let changedPixels = 0, protectedPixelsChanged = 0, newlyFilledRingPixels = 0;
        const protectedExamples = [];
        for (let index = 0; index < before.length; index += 4) {
          const changed = [0, 1, 2, 3].some(channel => before[index + channel] !== after[index + channel]);
          if (changed) {
            changedPixels++;
            if (!allowed?.[index / 4]) {
              protectedPixelsChanged++;
              if (width && protectedExamples.length < 32) protectedExamples.push({
                x: index / 4 % width, y: height - 1 - Math.floor(index / 4 / width),
                before: Array.from(before.slice(index, index + 4)), after: Array.from(after.slice(index, index + 4)),
              });
            }
          }
          if (allowed?.[index / 4] && after[index + 3] > before[index + 3]) newlyFilledRingPixels++;
        }
        return { changedPixels, protectedPixelsChanged, newlyFilledRingPixels, protectedExamples };
      };
      const observations = [], captures = {};
      const closed = { progress: 0, settle: 0, resultOpacity: 0, reducedMotion: false };
      const cases = [
        ['closed', closed],
        ...[.03, .25, .65].map(progress => [`peel-${progress}`, { ...closed, progress }]),
        ['completed', { progress: 1, settle: 1, resultOpacity: 1, reducedMotion: false }],
        ['reduced-completed', { progress: 0, settle: 0, resultOpacity: 1, reducedMotion: true }],
      ];
      const fixedAppearance = inspected => [inspected.hitRect, inspected.subdivisions, inspected.thickness,
        inspected.interiorLiner, inspected.paperVisible, inspected.lightLeak];
      try {
        for (const dimensions of [[390, 500, 2], [320, 420, 1]]) {
          scenes.forEach(scene => { scene.resize(...dimensions); scene.render(closed); });
          const initial = canvases.map(pixels), hit = scenes[0].getHitRect();
          const allowed = await acceptedShellMask(canvases[0], hit, dimensions[2], front);
          const allowedPixels = allowed.reduce((sum, value) => sum + value, 0);
          const centerIndex = Math.floor((1 - hit.y - hit.height / 2) * canvases[0].height) * canvases[0].width
            + Math.floor((hit.x + hit.width / 2) * canvases[0].width);
          for (const [name, state] of cases) {
            scenes.forEach(scene => scene.render(state));
            const [before, after] = canvases.map(pixels), inspected = scenes.map(scene => scene.inspect());
            const sample = { dimensions, name, ...difference(before, after, allowed, canvases[0].width, canvases[0].height),
              allowedPixels, totalPixels: allowed.length, centerProtected: allowed[centerIndex] === 0,
              originalAppearanceStateExact: JSON.stringify(fixedAppearance(inspected[0])) === JSON.stringify(fixedAppearance(inspected[1])),
              shell: inspected[1].stationaryNativeDetails };
            if (dimensions[0] === 390 && ['closed', 'peel-0.65', 'completed'].includes(name)) {
              captures[`kuji-shell-${name}`] = canvases[1].toDataURL('image/png');
            }
            // Every case returns to the same accepted closed state, including
            // a completed Reduced Motion result; no backing/liner can linger.
            scenes.forEach(scene => scene.render(closed));
            sample.resetChangedPixels = canvases.map((canvas, index) => difference(initial[index], pixels(canvas)).changedPixels);
            observations.push(sample);
          }
        }
        return { observations, captures };
      } finally { scenes.forEach(scene => scene.dispose()); }
    });
    const { captures, ...report } = result;
    report.baselineSha256 = createHash('sha256').update(baseline).digest('hex');
    report.scope = 'Local headless Chromium software GPU; frozen v4 comparison, original-source silhouette exterior + 2 CSS px AA only; not native/device QA';
    await mkdir(proof, { recursive: true });
    await writeFile(new URL('kuji-shell-report.json', proof), JSON.stringify(report, null, 2));
    for (const [name, data] of Object.entries(captures)) await writeFile(new URL(`${name}.png`, proof), Buffer.from(data.split(',')[1], 'base64'));
    assert.deepEqual(errors, []); assert.deepEqual(prohibited, []);
    assert.equal(report.observations.length, 12);
    for (const sample of report.observations) {
      const label = `${sample.name} ${sample.dimensions}`;
      assert.ok(sample.allowedPixels > 0 && sample.allowedPixels < sample.totalPixels * .12, `${label}: only a narrow ring may change`);
      assert.ok(sample.centerProtected, `${label}: cavity center must never belong to the shell mask`);
      assert.ok(sample.changedPixels > 0 && sample.newlyFilledRingPixels > 0, `${label}: the former empty shell gap is actually filled`);
      assert.equal(sample.protectedPixelsChanged, 0, `${label}: original print, transparent cavity, ivory liner and moving leaf must remain exact outside the shell/AA boundary`);
      assert.ok(sample.originalAppearanceStateExact, `${label}: camera, geometry, liner, paper and light state stay identical`);
      assert.deepEqual(sample.resetChangedPixels, [0, 0], `${label}: both prior and new scenes must reset to exact closed pixels`);
      assert.deepEqual(sample.shell, { borderWidth: 1, borderColor: '#CE4B19', borderRadius: 12, tearTeeth: 10,
        fillColor: '#F25B1E', backing: 'perimeter-only', lowerEdgeShade: .18 });
    }
  } finally { await browser.close(); }
});
