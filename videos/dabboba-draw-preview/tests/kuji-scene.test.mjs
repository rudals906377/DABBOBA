import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { KUJI_SCENE_DETAIL_REVISION } from '../scenes/kuji.mjs';

const source = await readFile(new URL('../scenes/kuji.mjs', import.meta.url), 'utf8');
const sha256 = text => createHash('sha256').update(text).digest('hex');

function block(anchor, after = '') {
  const searchStart = after ? source.indexOf(after) : 0;
  assert.ok(searchStart >= 0, `Missing preceding source boundary: ${after}`);
  const start = source.indexOf(anchor, searchStart);
  assert.ok(start >= 0, `Missing source boundary: ${anchor}`);
  const opening = source.indexOf('{', start);
  let depth = 1;
  let end = opening + 1;
  while (end < source.length && depth > 0) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}') depth -= 1;
    end += 1;
  }
  assert.equal(depth, 0, `Unbalanced source boundary: ${anchor}`);
  return source.slice(start, end);
}

const frontLighting = () => block('if (gl_FrontFacing) {', 'vec3 paperNormal = normalize(vPaperNormal);');
const attachedFront = () => block('if (gl_FrontFacing && diffuseColor.a > 0.0) {', ".replace('#include <map_fragment>'");

// These fingerprints come from the accepted version before the backside-only
// material refinement. They protect the requested visual/interaction boundary,
// not the new implementation's particular grain or shading coefficients.
test('accepted Kuji curl, sizing and front-face shader remain byte-identical', () => {
  const accepted = new Map([
    ['function deform(', '67d6941db703230a254561443b28dbd06c2550de1ac12279f6ba02091ef07231'],
    ['function resize(', 'fd9e0c7ecd2d5a560b33d51a15ea9f187003f7ed6730accc0b4771c4f77211f8'],
  ]);
  for (const [anchor, digest] of accepted) assert.equal(sha256(block(anchor)), digest, anchor);
  assert.equal(sha256(frontLighting()), 'd3e87984efc743931522a560f8d90825cb473db08168bd11b00be829b586eac1', 'accepted front-face lighting');
  assert.match(source, /const COLUMNS = 192;/);
  assert.match(source, /const ROWS = 20;/);
  assert.match(source, /camera\.position\.set\(0, 0\.55, 10\);/);
  assert.match(source, /camera\.lookAt\(0, 0, 0\);/);
});

test('paper detail is backside-only, UV-fixed and filtered at small pixel footprints', () => {
  const front = frontLighting();
  const backStart = source.indexOf('        } else {', source.indexOf(front));
  const backEnd = source.indexOf('        #include <opaque_fragment>', backStart);
  const back = source.slice(backStart, backEnd);
  assert.doesNotMatch(front, /paperGrain|stockVariation|fiberUv|softbox/);
  assert.match(back, /fiberUv = vPaperUv \*/);
  assert.match(back, /fwidth\(fiberUv\.x\)/);
  assert.match(back, /fwidth\(fiberUv\.y\)/);
  assert.match(back, /grainWeight = 1\.0 - smoothstep/);
  assert.match(back, /paperGrain \* grainWeight/);
  assert.doesNotMatch(source, /Math\.random\(|Date\.now\(|performance\.now\(|requestAnimationFrame\(/);
});

test('attached artwork is assembled at source resolution before filtering and refreshed without texture leaks', () => {
  const assembly = block('function refreshAttachedFace(');
  assert.match(assembly, /if \(!outerMaterial\.map\?\.image \|\| !paperMaterial\.map\?\.image\) return;/);
  assert.match(assembly, /surface\.width = ART_WIDTH;/);
  assert.match(assembly, /surface\.height = ART_HEIGHT;/);
  const outerDraw = assembly.indexOf('context.drawImage(outerMaterial.map.image, 0, 0, ART_WIDTH, ART_HEIGHT);');
  const leafDraw = assembly.indexOf('context.drawImage(paperMaterial.map.image, 0, 0, ART_WIDTH, ART_HEIGHT);');
  assert.ok(outerDraw >= 0 && leafDraw > outerDraw, 'stationary native face must be composed before the original leaf/logo');
  assert.doesNotMatch(assembly, /fillRect|stroke|filter\s*=|scale\(|translate\(|globalCompositeOperation/);
  assert.match(assembly, /prepareTexture\(new THREE\.CanvasTexture\(surface\)\)/);
  assert.match(assembly, /ownedTextures\.add\(texture\)/);
  assert.match(assembly, /uniforms\.attachedFace\.value = texture/);
  assert.match(assembly, /ownedTextures\.delete\(previous\); previous\.dispose\(\);/);
  assert.match(block('function applyFrontTexture('), /refreshAttachedFace\(\)/);
  assert.match(source, /if \(!frontWasReplaced\) applyFrontTexture\(frontTexture\);\s*else refreshAttachedFace\(\);/);
});

test('only attached front fragments replace original leaf alpha; curl, back, light and shadows retain their mask', () => {
  const front = attachedFront();
  assert.match(source, /shader\.uniforms\.uPaperProgress = uniforms\.progress;/);
  assert.match(source, /shader\.uniforms\.uAttachedFace = uniforms\.attachedFace;/);
  assert.match(source, /uniforms\.progress\.value = p;/);
  assert.match(front, /float attached = p <= 0\.0 \? 1\.0 : smoothstep\(-aa, aa, flatDistance\);/);
  assert.match(front, /float aa = max\(fwidth\(flatDistance\), 0\.00001\);/);
  assert.match(front, /vec4 assembled = texture2D\(uAttachedFace, vPaperUv\);/);
  assert.match(front, /float cutCoverage = smoothstep\(0\.0, 0\.15, diffuseColor\.a \/ max\(opacity, 0\.00001\)\);/);
  assert.match(front, /diffuseColor = mix\(diffuseColor, vec4\(diffuse \* assembled\.rgb, opacity \* assembled\.a\), attached \* cutCoverage\);/);
  assert.doesNotMatch(front, /\belse\b|discard|outgoingLight/);
  const mapped = source.slice(source.indexOf(".replace('#include <map_fragment>'"), source.indexOf(".replace('#include <opaque_fragment>'"));
  assert.ok(mapped.indexOf('#include <map_fragment>') < mapped.indexOf('if (gl_FrontFacing && diffuseColor.a > 0.0)'), 'sample original leaf first, including its alpha');
  assert.equal((mapped.match(/diffuseColor =/g) || []).length, 1, 'only the guarded attached override may replace sampled leaf');
  const apply = block('function applyFrontTexture(');
  assert.match(apply, /leakUniforms\.uMask\.value = texture;/);
  assert.match(apply, /paperMaterial\.map = texture;/);
  assert.match(apply, /edgeMaterial\.map = texture;/);
  assert.match(apply, /shadow\.material\.map = texture;/);
});

test('stationary transparent margins cannot acquire assembled coverage and the original cut feathers continuously', () => {
  const front = attachedFront();
  const guard = front.match(/^if \(([^\n]+)\) \{/);
  const coverage = front.match(/float cutCoverage = ([^;]+);/);
  assert.ok(guard && coverage, 'coverage correction needs both its face/alpha guard and original-cut feather');
  const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const correction = new Function('gl_FrontFacing', 'diffuseColor', 'opacity', 'attached', 'smoothstep', 'max', `
    if (!(${guard[1]})) return 0;
    return attached * (${coverage[1]});
  `);
  const weight = (alpha, opacity = 1, attached = 1, isFront = true) =>
    correction(isFront, { a: alpha * opacity }, opacity, attached, smoothstep, Math.max);
  for (const opacity of [0, .000001, .02, .5, 1]) {
    for (const attached of [0, .5, 1]) {
      assert.equal(weight(0, opacity, attached), 0, 'transparent margin cannot be painted even while fully attached');
      assert.equal(weight(1, opacity, attached, false), 0, 'paper backside cannot receive assembled front artwork');
    }
    for (const alpha of [0, .01, .075, .15, .5, 1]) {
      assert.equal(weight(alpha, opacity, 0), 0, 'curled leaf preserves its original sampled alpha');
      const correctedAlpha = alpha * opacity + (opacity - alpha * opacity) * weight(alpha, opacity);
      assert.ok(Number.isFinite(correctedAlpha) && correctedAlpha >= 0 && correctedAlpha <= opacity + 1e-12);
    }
  }
  assert.ok(weight(.000001) < 1e-8, 'near-zero coverage must approach zero without a hard outline');
  for (const opacity of [.02, .5, 1]) {
    assert.equal(weight(.15, opacity), 1, 'fully attached cut interior receives continuous assembled print');
    assert.ok(Math.abs(weight(.075, opacity) - .5) < 1e-12, 'feather midpoint is independent of paper fade opacity');
    let previous = 0;
    for (let step = 0; step <= 150; step++) {
      const current = weight(step / 1000, opacity);
      assert.ok(current >= previous, 'cut feather cannot ring or reverse');
      previous = current;
    }
  }
});

test('attached-mask scalar shader keeps closed coverage and a monotonic AA hinge boundary', () => {
  // Evaluate only the actual scalar GLSL expression on the CPU. The browser
  // tests own real shader compilation/pixels; this unit checks boundary math.
  const front = attachedFront();
  const scalar = front.slice(front.indexOf('float p ='), front.indexOf('vec4 assembled ='))
    .replaceAll('${WIDTH.toFixed(1)}', '3.0')
    .replaceAll('${PULL_EDGE.toFixed(10)}', (3 * 39 / 1517).toFixed(10))
    .replace(/\bfloat /g, 'let ');
  const weight = new Function('uPaperProgress', 'vPaperUv', 'footprint', `
    const min = Math.min, max = Math.max, sin = Math.sin;
    const fwidth = () => footprint;
    const smoothstep = (a, b, x) => { const t = min(1, max(0, (x-a)/(b-a))); return t*t*(3-2*t); };
    ${scalar}
    return attached;
  `);
  for (const y of [0, .05, .5, .95, 1]) {
    for (const x of [0, .05, .5, .95, 1]) {
      assert.equal(weight(0, { x, y }, .002), 1, 'the closed front is a single assembled face');
      assert.equal(weight(1, { x, y }, .002), 0, 'fully peeled front must use original leaf alpha');
    }
  }
  for (const p of [.0001, .01, .2, .34, .65]) {
    for (const y of [.05, .5, .95]) {
      const ramp = Math.min(1, p / .2);
      const radius = 3 * (.022 + .036 * ramp * ramp * (3 - 2 * ramp));
      const pullEdge = 3 * 39 / 1517;
      const hinge = pullEdge + p * (3 + Math.PI * radius - pullEdge) + 3 * .016 * Math.sin(p * Math.PI) * (y - .5);
      for (const footprint of [.0001, .002, .01]) {
        const values = [-2, -.5, 0, .5, 2].map(offset => weight(p, { x: (hinge + offset * footprint) / 3, y }, footprint));
        assert.equal(values[0], 0, 'curled side outside AA footprint keeps original leaf coverage');
        assert.equal(values.at(-1), 1, 'attached side outside AA footprint uses assembled coverage');
        assert.ok(Math.abs(values[2] - .5) < .000001, 'AA transition is centered on the unchanged hinge');
        for (let index = 1; index < values.length; index++) assert.ok(values[index] >= values[index - 1], 'AA transition cannot ring or reverse');
      }
    }
  }
});

test('the light stays below original paper and has no uniform whole-ticket residual', () => {
  assert.match(source, /const PAPER_Z = 0\.012;/);
  assert.match(source, /seamLeak\.position\.z = 0\.005;/);
  assert.match(source, /seamLeak\.renderOrder = 3;/);
  assert.match(source, /paper\.renderOrder = 4;/);
  assert.match(source, /float mask = texture2D\(uMask, vLeakUv\)\.a;/);
  assert.match(source, /mask \* verticalFeather \* centerWeight \* uFade/);
  assert.match(source, /float residual =[^;]*distanceFromFold[^;]*;/);
  assert.match(source, /seamLeak\.visible = loaded && !reducedMotion && progress > 0 && leakFade > 0;/);
});

test('Reduced Motion clears the paper when the result appears and inspection names the revision', () => {
  assert.match(source, /const opacity = reducedMotion \? 1 - state\.resultOpacity : 1 - s;/);
  assert.match(source, /paper\.visible = loaded && opacity > 0\.001;/);
  assert.equal(KUJI_SCENE_DETAIL_REVISION, 'paper-unified-orange-shell-v5');
  assert.match(source, /detailRevision: KUJI_SCENE_DETAIL_REVISION/);
});

test('ivory interior follows original cavity alpha and uses only the canonical local wordmark stamp', () => {
  const interior = block('function printedInterior(');
  assert.match(interior, /surface\.width = ART_WIDTH;/);
  assert.match(interior, /surface\.height = ART_HEIGHT;/);
  assert.match(interior, /context\.drawImage\(sourceImage, 0, 0, ART_WIDTH, ART_HEIGHT\);/);
  assert.match(interior, /cavity\.data\[i \+ 3\] = 255 - cavity\.data\[i \+ 3\];/);
  assert.match(interior, /context\.globalCompositeOperation = 'source-atop';/);
  assert.match(interior, /context\.drawImage\(wordmark,/);
  assert.doesNotMatch(interior, /fillText|strokeText|Math\.random\(|Date\.now\(/, 'no fake text, grade or changing serial on the liner');
  assert.match(source, /loader\.loadAsync\(new URL\('\.\.\/assets\/brand\/dabboba-wordmark\.png', import\.meta\.url\)\.href\)/);
  assert.match(source, /linerMaterial\.map = printedInterior\(outerTexture\.image, stampTexture\.image\);/);
  assert.match(interior, /ownedTextures\.add\(texture\)/, 'the new composed texture follows scene disposal');
});

test('liner stays below paper, shadows and light, is exposure-clipped, and supports reduced-motion result/reset', () => {
  assert.match(source, /liner\.position\.z = 0\.001;/);
  assert.match(source, /liner\.renderOrder = 1\.5;/);
  assert.match(source, /a\[i \+ 2\] = 0\.002;/);
  assert.match(source, /mesh\.renderOrder = 2;/);
  assert.match(source, /seamLeak\.position\.z = 0\.005;/);
  assert.match(source, /seamLeak\.renderOrder = 3;/);
  assert.match(source, /paper\.renderOrder = 4;/);
  assert.match(source, /float exposed = smoothstep\(0\.004, 0\.020, hinge - radius - vMapUv\.x \*/);
  assert.match(source, /diffuseColor\.a \*= max\(exposed, uLinerRevealed\);/);
  assert.match(source, /linerUniforms\.uProgress\.value = progress;/);
  assert.match(source, /linerUniforms\.uRevealed\.value = reducedMotion \? state\.resultOpacity : 0;/);
  assert.match(source, /liner\.visible = loaded && \(progress > 0 \|\| state\.resultOpacity > 0\);/);
  assert.match(source, /interiorLiner: \{\s*visible: liner\.visible,\s*material: 'ivory printed stock',\s*source: 'inverse original stationary cavity alpha',\s*frontOccluded: true,/);
});

test('orange shell is a shallow perimeter ring with the original artwork-sized cavity completely cut out', () => {
  const shellStart = source.indexOf('const shellScale = ART_WIDTH / NATIVE_INNER_WIDTH;');
  const shellEnd = source.indexOf('const outerMaterial =', shellStart);
  const shell = source.slice(shellStart, shellEnd);
  assert.match(shell, /shellContext\.fillStyle = '#F25B1E';/);
  assert.match(shell, /shellContext\.lineWidth = shellScale;/);
  assert.match(shell, /shellContext\.strokeStyle = '#CE4B19';/);
  assert.match(shell, /shellCanvas\.height - 2\.5 \* shellScale/);
  assert.match(shell, /rgba\(108, 39, 12, 0\.18\)/);
  const cutStart = shell.indexOf("shellContext.globalCompositeOperation = 'destination-out';");
  const cutEnd = shell.indexOf("shellContext.globalCompositeOperation = 'source-over';", cutStart);
  assert.ok(cutStart > 0 && cutEnd > cutStart, 'the filled ring must cut the cavity before creating its texture');
  const cut = shell.slice(cutStart, cutEnd);
  assert.match(cut, /ART_WIDTH - 4 \* shellScale, ART_HEIGHT - 4 \* shellScale/);
  assert.match(cut, /6 \* shellScale/);
  assert.match(cut, /shellContext\.fill\(\);/);
  assert.match(shell, /shell\.position\.z = -0\.006;/);
  assert.match(shell, /shell\.renderOrder = 0;/);
  assert.ok(shell.indexOf('const shellTexture =') > cutEnd, 'cutout must be part of the final uploaded texture');
});
