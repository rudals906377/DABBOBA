import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4195';
const proof = fileURLToPath(new URL('../proof/', import.meta.url));

test('same-GPU readback isolates upper material and checks the final recessed glow and smaller gap', { timeout: 120000 }, async t => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-renderer-backgrounding'],
  });
  const errors = [];
  const prohibited = [];
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== ORIGIN || !['GET', 'HEAD'].includes(request.method())) {
        prohibited.push({ url: request.url(), method: request.method() });
        return route.abort();
      }
      if (url.pathname === '/__capsule-material-test__') {
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas id="proof"></canvas>' });
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${ORIGIN}/__capsule-material-test__`);

    const result = await page.evaluate(async () => {
      const [THREE, native, preview] = await Promise.all([
        import('/assets/vendor/three.module.min.js'), import('/scenes/capsule-shader.mjs'),
        import('/scenes/capsule-material.mjs'),
      ]);
      const width = 576, height = 768;
      // Material readback is independent of editorial timing. Always compare
      // the same fully-open, peak-light pose when the opening is retimed.
      const state = { opening: 1, light: .78 };
      const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#proof'), alpha: true, premultipliedAlpha: false });
      renderer.setSize(width, height, false);
      renderer.setClearColor(0x000000, 0);
      const target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
      const wordmark = await new THREE.TextureLoader().loadAsync('/assets/brand/dabboba-wordmark.png');
      wordmark.flipY = false;
      wordmark.minFilter = THREE.LinearFilter;
      wordmark.magFilter = THREE.LinearFilter;
      wordmark.generateMipmaps = false;
      wordmark.needsUpdate = true;
      const uniforms = {
        uResolution: { value: new THREE.Vector2(width, height) },
        uProjection: { value: new THREE.Vector3(.5, .5, 130) }, uViewWidth: { value: 192 },
        uProgress: { value: state.opening }, uIvory: { value: 0 }, uWordmark: { value: wordmark },
        uReveal: { value: new THREE.Vector3(Math.min(1, state.opening * 3.8), state.opening, state.light) },
        uRattle: { value: 0 }, uOpacity: { value: 1 }, uClip: { value: new THREE.Vector4(0, 0, 1, 1) },
      };
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('aPosition', new THREE.Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1], 2));
      geometry.setIndex([0, 1, 2, 2, 1, 3]);
      const scene = new THREE.Scene();
      const camera = new THREE.Camera();
      const mesh = new THREE.Mesh(geometry);
      const initialMaterial = mesh.material;
      mesh.frustumCulled = false;
      scene.add(mesh);
      const materials = [];
      const captures = {};
      function render(fragmentShader, captureName) {
        const material = new THREE.RawShaderMaterial({
          uniforms, vertexShader: native.CAPSULE_3D_VERTEX_SHADER, fragmentShader,
          depthTest: false, depthWrite: false, blending: THREE.NoBlending,
        });
        materials.push(material);
        mesh.material = material;
        renderer.setRenderTarget(target);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        const pixels = new Uint8Array(width * height * 4);
        renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
        if (captureName) {
          renderer.setRenderTarget(null);
          renderer.clear(true, true, true);
          renderer.render(scene, camera);
          captures[captureName] = renderer.domElement.toDataURL('image/png');
        }
        return pixels;
      }
      try {
        const original = render(native.CAPSULE_3D_FRAGMENT_SHADER, 'native');
        const modified = render(preview.CAPSULE_MATERIAL_FRAGMENT_SHADER, 'material');
        const final = render(preview.CAPSULE_PREVIEW_FRAGMENT_SHADER, 'preview');
        // A test-only ID pass uses the native ray intersection, not a guessed
        // screen-space rectangle: red = upper shell, green = lower shell.
        const output = 'gl_FragColor = vec4(color, alpha * uOpacity);';
        if (native.CAPSULE_3D_FRAGMENT_SHADER.split(output).length !== 2) throw new Error('Native output anchor changed');
        const idOutput = 'gl_FragColor = hit.x < FAR - 1.0 ? (isUpper ? vec4(1.,0.,0.,1.) : vec4(0.,1.,0.,1.)) : vec4(0.);';
        const mask = render(native.CAPSULE_3D_FRAGMENT_SHADER.replace(output, idOutput));
        const finalMask = render(preview.CAPSULE_PREVIEW_FRAGMENT_SHADER.replace(output, idOutput));
        const coreMask = render(preview.CAPSULE_PREVIEW_FRAGMENT_SHADER.replace(output,
          'gl_FragColor = coreVisible ? vec4(length((lowerRo + lowerRd * coreHit).xz) / 0.84, 1., 0., 1.) : vec4(0.);'));
        const stats = {
          fixture: 'fully-open-peak-light', opening: state.opening, light: state.light,
          resolution: [width, height], renderer: 'same Chromium WebGL/SwiftShader context',
          upperPixels: 0, lowerPixels: 0, changedUpperPixels: 0, changedLowerPixels: 0,
          changedOutsideUpperPixels: 0, alphaDifferences: 0,
          originalUpperGreenSurplus: 0, modifiedUpperGreenSurplus: 0,
          materialComparison: 'material-only export versus native at identical geometry',
          finalOpeningOffset: preview.CAPSULE_OPEN_OFFSET,
          originalUpperY: 0, originalLowerY: 0,
          finalUpperPixels: 0, finalLowerPixels: 0, finalUpperY: 0, finalLowerY: 0,
          finalCoreCenterPixels: 0, finalCoreEdgePixels: 0,
          finalCoreCenterLuminance: 0, finalCoreEdgeLuminance: 0,
        };
        for (let offset = 0; offset < original.length; offset += 4) {
          const upper = mask[offset] === 255;
          const lower = mask[offset + 1] === 255;
          const changed = [0, 1, 2, 3].some(channel => original[offset + channel] !== modified[offset + channel]);
          if (original[offset + 3] !== modified[offset + 3]) stats.alphaDifferences += 1;
          if (upper) {
            stats.upperPixels += 1;
            stats.originalUpperY += Math.floor(offset / 4 / width);
            if (changed) stats.changedUpperPixels += 1;
            stats.originalUpperGreenSurplus += Math.max(0, original[offset + 1] - Math.max(original[offset], original[offset + 2]));
            stats.modifiedUpperGreenSurplus += Math.max(0, modified[offset + 1] - Math.max(modified[offset], modified[offset + 2]));
          } else if (changed) stats.changedOutsideUpperPixels += 1;
          if (lower) {
            stats.lowerPixels += 1;
            stats.originalLowerY += Math.floor(offset / 4 / width);
            if (changed) stats.changedLowerPixels += 1;
          }
          if (finalMask[offset] === 255) {
            stats.finalUpperPixels += 1;
            stats.finalUpperY += Math.floor(offset / 4 / width);
          }
          if (finalMask[offset + 1] === 255) {
            stats.finalLowerPixels += 1;
            stats.finalLowerY += Math.floor(offset / 4 / width);
          }
          if (coreMask[offset + 1] === 255) {
            const radial = coreMask[offset] / 255;
            const luminance = final[offset] * .2126 + final[offset + 1] * .7152 + final[offset + 2] * .0722;
            if (radial < .25) {
              stats.finalCoreCenterPixels += 1;
              stats.finalCoreCenterLuminance += luminance;
            } else if (radial >= .7 && radial < .9) {
              stats.finalCoreEdgePixels += 1;
              stats.finalCoreEdgeLuminance += luminance;
            }
          }
        }
        stats.originalUpperGreenSurplus /= stats.upperPixels;
        stats.modifiedUpperGreenSurplus /= stats.upperPixels;
        stats.originalUpperY /= stats.upperPixels;
        stats.originalLowerY /= stats.lowerPixels;
        stats.finalUpperY /= stats.finalUpperPixels;
        stats.finalLowerY /= stats.finalLowerPixels;
        stats.originalCentroidGap = stats.originalUpperY - stats.originalLowerY;
        stats.finalCentroidGap = stats.finalUpperY - stats.finalLowerY;
        stats.finalCoreCenterLuminance /= Math.max(1, stats.finalCoreCenterPixels);
        stats.finalCoreEdgeLuminance /= Math.max(1, stats.finalCoreEdgePixels);
        return { ...stats, captures };
      } finally {
        materials.forEach(material => material.dispose());
        initialMaterial.dispose();
        geometry.dispose(); wordmark.dispose(); target.dispose(); renderer.dispose();
      }
    });
    const { captures, ...metrics } = result;
    await mkdir(proof, { recursive: true });
    await Promise.all(Object.entries(captures).map(([name, png]) =>
      writeFile(`${proof}/capsule-material-${name}-fixture-open.png`, Buffer.from(png.split(',')[1], 'base64'))));
    await writeFile(`${proof}/capsule-material-browser-report.json`, JSON.stringify({
      environment: 'Local Chromium software GPU; not native/physical-device evidence', ...metrics,
    }, null, 2));
    t.diagnostic(JSON.stringify(metrics));
    assert.ok(result.upperPixels > 10000 && result.lowerPixels > 10000, 'Both physical hemispheres must be present');
    assert.ok(result.changedUpperPixels / result.upperPixels > .5, 'The material change must visibly affect the upper shell');
    assert.equal(result.changedLowerPixels, 0, 'Every lower-shell RGBA pixel must remain byte-identical');
    assert.equal(result.changedOutsideUpperPixels, 0, 'The material change must not alter the lower shell, emission gap, or background');
    assert.equal(result.alphaDifferences, 0, 'Geometry silhouette and opacity must stay identical');
    assert.ok(result.originalUpperGreenSurplus > 1, 'The original frame must actually contain the green cast being tested');
    assert.ok(result.modifiedUpperGreenSurplus <= result.originalUpperGreenSurplus * .25,
      'Mean upper-shell green surplus must fall by at least 75%');
    assert.equal(result.finalOpeningOffset, .32);
    assert.ok(result.finalUpperPixels > 10000 && result.finalLowerPixels > 10000);
    assert.ok(result.finalCentroidGap < result.originalCentroidGap,
      'The final upper/lower shell gap must be smaller than the native gap at the same opening');
    assert.ok(result.finalCoreCenterPixels > 20 && result.finalCoreEdgePixels > 20,
      'The actual depth-tested mouth must expose enough center and edge pixels to judge the gradient');
    assert.ok(result.finalCoreCenterLuminance > result.finalCoreEdgeLuminance + 3,
      'The recessed mouth must have a brighter center and a dimmer edge, not a flat white disk');
    assert.deepEqual(prohibited, [], 'Readback must not POST or use any external service');
    assert.deepEqual(errors, [], 'Native, isolated-material and final shaders must compile without browser errors');
  } finally {
    await browser.close();
  }
});
