import * as THREE from '../assets/vendor/three.module.min.js';

export const KUJI_SCENE_DETAIL_REVISION = 'paper-ivory-result-liner-v4';

const ART_WIDTH = 1517;
const ART_HEIGHT = 1037;
const WIDTH = 3;
const HEIGHT = WIDTH * ART_HEIGHT / ART_WIDTH;
const NATIVE_INNER_WIDTH = 300;
const NATIVE_PIXEL = WIDTH / NATIVE_INNER_WIDTH;
const SHELL_WIDTH = WIDTH + 16 * NATIVE_PIXEL;
const SHELL_HEIGHT = HEIGHT + 16 * NATIVE_PIXEL;
const COLUMNS = 192;
const ROWS = 20;
const PAPER_Z = 0.012;
const THICKNESS = 0.0032;
// The leftmost opaque pull-tab pixel lies at x=39 in the approved source.
// Start the bend at that edge so transparent PNG padding adds no dead travel.
const PULL_EDGE = WIDTH * 39 / ART_WIDTH;
const clamp = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smooth = (value) => value * value * (3 - 2 * value);

/** A seekable paper scene: the host alone owns input, timing and result content. */
export function createKujiScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2.5, -2.5, 0.1, 30);
  // A barely tilted orthographic view keeps the printed seal readily identifiable.
  camera.position.set(0, 0.55, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  let disposed = false;
  let loaded = false;
  let frontWasReplaced = false;
  let state = { progress: 0, settle: 0, resultOpacity: 0, reducedMotion: false };
  let dimensions = { width: 390, height: 500, pixelRatio: 1 };
  const ownedTextures = new Set();
  const geometries = new Set();
  const materials = new Set();
  const uniforms = {
    curvature: { value: 0 },
    backside: { value: new THREE.Color('#f6f2e9') },
    progress: { value: 0 },
    attachedFace: { value: null },
  };

  const keepGeometry = (geometry) => (geometries.add(geometry), geometry);
  const keepMaterial = (material) => (materials.add(material), material);
  const plane = () => keepGeometry(new THREE.PlaneGeometry(WIDTH, HEIGHT, COLUMNS, ROWS));

  // The native shell is separate from the PNG: four-pixel dark-orange stroke,
  // twelve-pixel corner radius and four pixels of inner-layer spacing.
  const shellScale = ART_WIDTH / NATIVE_INNER_WIDTH;
  const shellCanvas = document.createElement('canvas');
  shellCanvas.width = Math.round(316 * shellScale);
  shellCanvas.height = Math.round((ART_HEIGHT / shellScale + 16) * shellScale);
  const shellContext = shellCanvas.getContext('2d');
  shellContext.beginPath();
  shellContext.roundRect(
    2 * shellScale, 2 * shellScale,
    shellCanvas.width - 4 * shellScale, shellCanvas.height - 4 * shellScale,
    10 * shellScale,
  );
  shellContext.lineWidth = 4 * shellScale;
  shellContext.strokeStyle = '#A83C15';
  shellContext.stroke();
  const shellTexture = new THREE.CanvasTexture(shellCanvas);
  ownedTextures.add(shellTexture);
  shellTexture.colorSpace = THREE.SRGBColorSpace;
  const shellMaterial = keepMaterial(new THREE.MeshBasicMaterial({
    map: shellTexture, transparent: true, alphaTest: 0.01, depthWrite: true,
  }));
  const shell = new THREE.Mesh(
    keepGeometry(new THREE.PlaneGeometry(SHELL_WIDTH, SHELL_HEIGHT)), shellMaterial,
  );
  shell.position.z = -0.006;
  shell.renderOrder = 0;
  scene.add(shell);

  const outerMaterial = keepMaterial(new THREE.MeshBasicMaterial({
    transparent: true, alphaTest: 0.01, depthWrite: true, side: THREE.DoubleSide,
  }));
  const outer = new THREE.Mesh(keepGeometry(new THREE.PlaneGeometry(WIDTH, HEIGHT)), outerMaterial);
  outer.position.z = 0;
  outer.renderOrder = 1;
  scene.add(outer);

  // An actual stationary paper liner, fitted to the original cut rather than
  // another rounded card. It is occluded by the original leaf and never
  // contributes even a filtered edge pixel to the closed ticket.
  const linerUniforms = {
    uProgress: { value: 0 },
    uRevealed: { value: 0 },
  };
  const linerMaterial = keepMaterial(new THREE.MeshBasicMaterial({
    transparent: true, alphaTest: 0.01, depthWrite: true,
  }));
  linerMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uLinerProgress = linerUniforms.uProgress;
    shader.uniforms.uLinerRevealed = linerUniforms.uRevealed;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLinerProgress;\nuniform float uLinerRevealed;')
      .replace('#include <alphatest_fragment>', `
        float p = uLinerProgress;
        float ramp = min(1.0, p / 0.2);
        float radius = ${WIDTH.toFixed(1)} * (0.022 + 0.036 * ramp * ramp * (3.0 - 2.0 * ramp));
        float hinge = ${PULL_EDGE.toFixed(10)} + p * (${WIDTH.toFixed(1)} + 3.14159265359 * radius - ${PULL_EDGE.toFixed(10)});
        hinge += ${WIDTH.toFixed(1)} * 0.016 * sin(p * 3.14159265359) * (vMapUv.y - 0.5);
        // Stop below the curl's left tangent. No paper or ink bleeds through
        // the antialiased printed seam on the still-attached side.
        float exposed = smoothstep(0.004, 0.020, hinge - radius - vMapUv.x * ${WIDTH.toFixed(1)});
        diffuseColor.a *= max(exposed, uLinerRevealed);
        #include <alphatest_fragment>
      `);
  };
  linerMaterial.customProgramCacheKey = () => 'dabboba-kuji-ivory-liner-v1';
  const liner = new THREE.Mesh(keepGeometry(new THREE.PlaneGeometry(WIDTH, HEIGHT)), linerMaterial);
  liner.position.z = 0.001;
  liner.renderOrder = 1.5;
  liner.visible = false;
  scene.add(liner);

  // A recessed light face sits below the original paper, not above its art.
  // Its source follows the same cylindrical fold and is masked to the peel
  // opening; the opaque sheet then physically occludes the covered portion.
  const leakUniforms = {
    uMask: { value: null },
    uProgress: { value: 0 },
    uFade: { value: 0 },
    uSize: { value: new THREE.Vector2(WIDTH, HEIGHT) },
    uPullEdge: { value: PULL_EDGE },
    uCream: { value: new THREE.Color('#FFD9A3') },
  };
  const leakMaterial = keepMaterial(new THREE.ShaderMaterial({
    uniforms: leakUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: `
      varying vec2 vLeakUv;
      void main() {
        vLeakUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMask;
      uniform float uProgress;
      uniform float uFade;
      uniform vec2 uSize;
      uniform float uPullEdge;
      uniform vec3 uCream;
      varying vec2 vLeakUv;
      float calm(float value) { return value * value * (3.0 - 2.0 * value); }
      void main() {
        float mask = texture2D(uMask, vLeakUv).a;
        float p = uProgress;
        float radius = uSize.x * (0.022 + 0.036 * calm(min(1.0, p / 0.2)));
        float hinge = uPullEdge + p * (uSize.x + 3.14159265359 * radius - uPullEdge);
        hinge += uSize.x * 0.016 * sin(p * 3.14159265359) * (vLeakUv.y - 0.5);
        float foldLeft = hinge - radius;
        float distanceFromFold = foldLeft - vLeakUv.x * uSize.x;
        // The core and diffusion stop at the fold and stay inside the ticket.
        // They do not become a stage-sized halo as opening progresses.
        float exposed = smoothstep(-0.028, 0.018, distanceFromFold);
        float core = exp(-pow((distanceFromFold - 0.012) / 0.026, 2.0));
        float diffusion = exp(-pow(max(0.0, distanceFromFold) / (0.12 + 0.05 * p), 2.0));
        float verticalFeather = smoothstep(0.0, 0.16, vLeakUv.y)
          * smoothstep(0.0, 0.16, 1.0 - vLeakUv.y);
        float verticalCenter = 0.54 + 0.015 * sin(p * 3.14159265359);
        float centerWeight = 0.60 + 0.40 * exp(-pow((vLeakUv.y - verticalCenter) / 0.27, 2.0));
        float opening = 1.0 - exp(-18.0 * p);
        float strength = opening * (0.20 + 0.35 * calm(p));
        float residual = 0.012 * calm(p) * exposed
          * exp(-pow(max(0.0, distanceFromFold) / 0.36, 2.0));
        float alpha = mask * verticalFeather * centerWeight * uFade
          * ((0.55 * core + 0.40 * diffusion) * exposed * strength + residual);
        if (alpha < 0.0001) discard;
        gl_FragColor = vec4(uCream, alpha);
        #include <colorspace_fragment>
      }
    `,
  }));
  const seamLeak = new THREE.Mesh(
    keepGeometry(new THREE.PlaneGeometry(WIDTH, HEIGHT)), leakMaterial,
  );
  seamLeak.position.z = 0.005;
  seamLeak.renderOrder = 3;
  seamLeak.visible = false;
  scene.add(seamLeak);

  const paperGeometry = plane();
  paperGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const flatPositions = paperGeometry.attributes.position.array.slice();
  const paperMaterial = keepMaterial(new THREE.MeshBasicMaterial({
    transparent: true, alphaTest: 0.012, side: THREE.DoubleSide, depthWrite: true,
  }));
  // Preserve gl_FrontFacing: Three's two-pass transparent path flips the back
  // pass winding, making both faces look like a front to the paper shader.
  paperMaterial.forceSinglePass = true;
  // An unlit front preserves the approved source colors exactly at progress zero.
  // On the turned-over face, retain the same alpha silhouette but show paper stock.
  paperMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uPaperCurvature = uniforms.curvature;
    shader.uniforms.uPaperBack = uniforms.backside;
    shader.uniforms.uPaperProgress = uniforms.progress;
    shader.uniforms.uAttachedFace = uniforms.attachedFace;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaperNormal;\nvarying vec2 vPaperUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaperNormal = normalize(normalMatrix * normal);\nvPaperUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaperNormal;\nvarying vec2 vPaperUv;\nuniform float uPaperCurvature;\nuniform vec3 uPaperBack;\nuniform float uPaperProgress;\nuniform sampler2D uAttachedFace;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        // The complementary outer/leaf masks must be composited BEFORE
        // filtering while attached. Filtering two alpha layers separately
        // leaves up to 25% background coverage at their shared cut edge.
        // Use the exact assembled print only on the unmoved front surface;
        // the curled leaf keeps its original alpha, artwork and paper back.
        if (gl_FrontFacing && diffuseColor.a > 0.0) {
          float p = uPaperProgress;
          float ramp = min(1.0, p / 0.2);
          float radius = ${WIDTH.toFixed(1)} * (0.022 + 0.036 * ramp * ramp * (3.0 - 2.0 * ramp));
          float hinge = ${PULL_EDGE.toFixed(10)} + p * (${WIDTH.toFixed(1)} + 3.14159265359 * radius - ${PULL_EDGE.toFixed(10)});
          hinge += ${WIDTH.toFixed(1)} * 0.016 * sin(p * 3.14159265359) * (vPaperUv.y - 0.5);
          float flatDistance = vPaperUv.x * ${WIDTH.toFixed(1)} - hinge;
          float aa = max(fwidth(flatDistance), 0.00001);
          float attached = p <= 0.0 ? 1.0 : smoothstep(-aa, aa, flatDistance);
          vec4 assembled = texture2D(uAttachedFace, vPaperUv);
          // Never extend the moving sheet over stationary orange margins.
          // A subpixel feather ends coverage correction at the original cut.
          float cutCoverage = smoothstep(0.0, 0.15, diffuseColor.a / max(opacity, 0.00001));
          diffuseColor = mix(diffuseColor, vec4(diffuse * assembled.rgb, opacity * assembled.a), attached * cutCoverage);
        }
      `)
      .replace('#include <opaque_fragment>', `
        vec3 paperNormal = normalize(vPaperNormal);
        if (gl_FrontFacing) {
          float curveShade = 1.0 - uPaperCurvature * 0.22 * (1.0 - abs(paperNormal.z));
          outgoingLight *= curveShade;
        } else {
          vec3 litNormal = -paperNormal;
          float lambert = max(dot(litNormal, normalize(vec3(0.65, 0.25, 1.0))), 0.0);
          float broadFold = pow(max(0.0, 1.0 - abs(paperNormal.z)), 0.75);
          float softbox = pow(max(dot(litNormal, normalize(vec3(-0.40, 0.65, 1.0))), 0.0), 2.0);
          float stock = 0.67 + 0.26 * lambert + 0.025 * softbox - 0.06 * broadFold;
          // The stock pattern stays attached to paper UVs, never to time or
          // screen pixels. Derivative filtering removes subpixel grain on
          // small displays instead of introducing shimmer during the curl.
          vec2 fiberUv = vPaperUv * vec2(180.0, 260.0);
          float grainFootprint = max(fwidth(fiberUv.x), fwidth(fiberUv.y));
          float grainWeight = 1.0 - smoothstep(0.35, 1.2, grainFootprint);
          float paperGrain = sin(fiberUv.x * 6.2831853 + sin(fiberUv.y * 1.37))
            * sin(fiberUv.y * 6.2831853);
          float stockVariation = sin(vPaperUv.x * 31.0 + vPaperUv.y * 19.0) * 0.0015;
          outgoingLight = uPaperBack * (stock + stockVariation)
            + vec3(paperGrain * grainWeight * 0.0026);
        }
        #include <opaque_fragment>
      `);
  };
  paperMaterial.customProgramCacheKey = () => KUJI_SCENE_DETAIL_REVISION;
  const paper = new THREE.Mesh(paperGeometry, paperMaterial);
  paper.frustumCulled = false;
  paper.renderOrder = 4;
  scene.add(paper);

  // Multi-sample projected shadows follow the deformed sheet, rather than a
  // detached generic rectangle. The original alpha also masks every shadow.
  const shadowPasses = [-1, -0.5, 0, 0.5, 1].map((offset) => {
    const geometry = plane();
    geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const material = keepMaterial(new THREE.MeshBasicMaterial({
      color: '#25221c', transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.003,
    }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, geometry, material, offset };
  });

  // A thin ribbon closes the sheet's perimeter. Alpha sampled from the same art
  // prevents the ribbon from manufacturing an opaque rectangular paper border.
  const boundary = [];
  for (let x = 0; x <= COLUMNS; x += 1) boundary.push([x / COLUMNS, 1]);
  for (let y = 1; y <= ROWS; y += 1) boundary.push([1, 1 - y / ROWS]);
  for (let x = COLUMNS - 1; x >= 0; x -= 1) boundary.push([x / COLUMNS, 0]);
  for (let y = ROWS - 1; y >= 0; y -= 1) boundary.push([0, 1 - y / ROWS]);
  const edgePositions = new Float32Array(boundary.length * 6);
  const edgeUvs = new Float32Array(boundary.length * 4);
  const edgeIndices = [];
  boundary.forEach(([u, v], index) => {
    // Sampling half a source pixel inside avoids losing a legitimate edge to
    // texture filtering at the transparent outside of the original PNG.
    const innerU = Math.max(0.5 / ART_WIDTH, Math.min(1 - 0.5 / ART_WIDTH, u));
    const innerV = Math.max(0.5 / ART_HEIGHT, Math.min(1 - 0.5 / ART_HEIGHT, v));
    edgeUvs.set([innerU, innerV, innerU, innerV], index * 4);
    if (index < boundary.length - 1) {
      const a = index * 2;
      edgeIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const edgeGeometry = keepGeometry(new THREE.BufferGeometry());
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage));
  edgeGeometry.setAttribute('uv', new THREE.BufferAttribute(edgeUvs, 2));
  edgeGeometry.setIndex(edgeIndices);
  const edgeMaterial = keepMaterial(new THREE.MeshBasicMaterial({
    transparent: true, alphaTest: 0.01, side: THREE.DoubleSide, depthWrite: true,
  }));
  edgeMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'outgoingLight = vec3(0.79, 0.75, 0.66);\n#include <opaque_fragment>',
    );
  };
  edgeMaterial.customProgramCacheKey = () => 'dabboba-kuji-paper-edge-v1';
  const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
  edge.frustumCulled = false;
  edge.renderOrder = 5;
  scene.add(edge);

  function prepareTexture(texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
  }

  function applyFrontTexture(texture) {
    prepareTexture(texture);
    leakUniforms.uMask.value = texture;
    paperMaterial.map = texture;
    paperMaterial.needsUpdate = true;
    edgeMaterial.map = texture;
    edgeMaterial.needsUpdate = true;
    for (const shadow of shadowPasses) {
      shadow.material.map = texture;
      shadow.material.needsUpdate = true;
    }
    refreshAttachedFace();
  }

  function refreshAttachedFace() {
    if (!outerMaterial.map?.image || !paperMaterial.map?.image) return;
    const surface = document.createElement('canvas');
    surface.width = ART_WIDTH;
    surface.height = ART_HEIGHT;
    const context = surface.getContext('2d');
    // Same-resolution union: original orange, double printed rule, pull tab,
    // teeth, logo and serial. No new artwork, dilation or changed cut shape.
    context.drawImage(outerMaterial.map.image, 0, 0, ART_WIDTH, ART_HEIGHT);
    context.drawImage(paperMaterial.map.image, 0, 0, ART_WIDTH, ART_HEIGHT);
    const previous = uniforms.attachedFace.value;
    const texture = prepareTexture(new THREE.CanvasTexture(surface));
    ownedTextures.add(texture);
    uniforms.attachedFace.value = texture;
    if (previous) { ownedTextures.delete(previous); previous.dispose(); }
  }

  function nativeStationaryArtwork(sourceImage) {
    const surface = document.createElement('canvas');
    surface.width = ART_WIDTH;
    surface.height = ART_HEIGHT;
    const context = surface.getContext('2d');
    const scale = ART_WIDTH / NATIVE_INNER_WIDTH;
    context.beginPath();
    context.roundRect(0, 0, ART_WIDTH, ART_HEIGHT, 8 * scale);
    context.clip();
    context.drawImage(sourceImage, 0, 0, ART_WIDTH, ART_HEIGHT);
    // Exact native tearEdge/tearTooth layout, including clipping at the left
    // image boundary. These teeth belong to the stationary outer, not the leaf.
    const availableHeight = ART_HEIGHT - 20 * scale;
    context.fillStyle = '#FFF7E9';
    for (let index = 0; index < 10; index += 1) {
      context.save();
      context.translate(1.5 * scale, 10 * scale + availableHeight * (index + 0.5) / 10);
      context.rotate(Math.PI / 4);
      context.fillRect(-4.5 * scale, -4.5 * scale, 9 * scale, 9 * scale);
      context.restore();
    }
    const texture = new THREE.CanvasTexture(surface);
    ownedTextures.add(texture);
    return prepareTexture(texture);
  }

  function printedInterior(sourceImage, wordmark) {
    const surface = document.createElement('canvas');
    surface.width = ART_WIDTH;
    surface.height = ART_HEIGHT;
    const context = surface.getContext('2d');
    context.drawImage(sourceImage, 0, 0, ART_WIDTH, ART_HEIGHT);
    const cavity = context.getImageData(0, 0, ART_WIDTH, ART_HEIGHT);
    // The original outer alpha defines the angled inner cut, not a guessed
    // polygon. Retain source RGBs/assets untouched; this is a separate layer.
    for (let y = 0; y < ART_HEIGHT; y += 1) {
      for (let x = 0; x < ART_WIDTH; x += 1) {
        const i = (y * ART_WIDTH + x) * 4;
        const edge = Math.max(
          1 - Math.min(1, Math.max(0, x - 100) / 140),
          1 - Math.min(1, Math.max(0, ART_WIDTH - 90 - x) / 140),
          1 - Math.min(1, Math.max(0, y - 62) / 180),
          1 - Math.min(1, Math.max(0, ART_HEIGHT - 68 - y) / 130),
        );
        // White at the photography plane, gently ivory at the unprinted
        // perimeter: no tint, multiply blend or filter on the product itself.
        cavity.data[i] = 255 - Math.round(edge * 10);
        cavity.data[i + 1] = 255 - Math.round(edge * 13);
        cavity.data[i + 2] = 255 - Math.round(edge * 23);
        cavity.data[i + 3] = 255 - cavity.data[i + 3];
      }
    }
    context.putImageData(cavity, 0, 0);
    context.globalCompositeOperation = 'source-atop';
    // Restrained printed registration marks. No invented grade or serial.
    context.fillStyle = '#B8AC91';
    for (const [x, y] of [[178, 103], [192, 103], [178, 117]]) context.fillRect(x, y, 7, 7);
    context.fillStyle = '#DDD7C8';
    context.fillRect(226, 111, 685, 2);
    context.globalAlpha = 0.34;
    const stampWidth = 258;
    context.drawImage(wordmark, 1105, 93, stampWidth, stampWidth * wordmark.height / wordmark.width);
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(surface);
    ownedTextures.add(texture);
    return prepareTexture(texture);
  }

  /** Replace the face with an exact source-art + native wordmark composition. */
  function setFrontTexture(textureOrCanvas) {
    if (disposed) return;
    const texture = textureOrCanvas?.isTexture
      ? textureOrCanvas
      : new THREE.CanvasTexture(textureOrCanvas);
    if (!textureOrCanvas?.isTexture) ownedTextures.add(texture);
    frontWasReplaced = true;
    applyFrontTexture(texture);
    if (loaded) render(state);
  }

  const loader = new THREE.TextureLoader();
  const textureUrl = (name) => new URL(`../assets/kuji/${name}`, import.meta.url).href;
  const ready = Promise.all([
    loader.loadAsync(textureUrl('kuji-ticket-outer-layer.png')),
    loader.loadAsync(textureUrl('kuji-ticket-peel-layer.png')),
    loader.loadAsync(new URL('../assets/brand/dabboba-wordmark.png', import.meta.url).href),
  ]).then(([outerTexture, frontTexture, stampTexture]) => {
    if (disposed) {
      outerTexture.dispose();
      frontTexture.dispose();
      stampTexture.dispose();
      return;
    }
    ownedTextures.add(outerTexture);
    ownedTextures.add(frontTexture);
    ownedTextures.add(stampTexture);
    outerMaterial.map = nativeStationaryArtwork(outerTexture.image);
    outerMaterial.needsUpdate = true;
    linerMaterial.map = printedInterior(outerTexture.image, stampTexture.image);
    linerMaterial.needsUpdate = true;
    if (!frontWasReplaced) applyFrontTexture(frontTexture);
    else refreshAttachedFace();
    loaded = true;
    render(state);
  });

  /** Isometric cylindrical bend: the attached section never slides or scales. */
  function deform(x, y, progress, settle) {
    const s = x + WIDTH / 2;
    const radius = WIDTH * (0.022 + 0.036 * smooth(Math.min(1, progress / 0.2)));
    const advance = progress > 0
      ? PULL_EDGE + progress * (WIDTH + Math.PI * radius - PULL_EDGE)
      : 0;
    const bias = WIDTH * 0.016 * Math.sin(progress * Math.PI) * (y / HEIGHT);
    const hinge = advance + bias;
    const distance = hinge - s;
    let px = x;
    let pz = PAPER_Z;
    let nx = 0;
    let nz = 1;
    if (distance > 0) {
      const angle = Math.min(Math.PI, distance / radius);
      const tail = Math.max(0, distance - Math.PI * radius);
      px = hinge - radius * Math.sin(angle) + tail - WIDTH / 2;
      pz += radius * (1 - Math.cos(angle));
      nx = Math.sin(angle);
      nz = Math.cos(angle);
      // Very slight elasticity in the free tail, without wobble or any clock.
      pz += 0.012 * Math.sin(Math.min(1, tail / WIDTH) * Math.PI);
    }
    return {
      x: px + settle * WIDTH * 0.32,
      y: y + settle * HEIGHT * 0.12,
      z: pz + settle * 0.1,
      nx,
      nz,
    };
  }

  function render(nextState = {}) {
    if (disposed) return;
    state = {
      progress: clamp(nextState.progress),
      settle: clamp(nextState.settle),
      resultOpacity: clamp(nextState.resultOpacity),
      reducedMotion: Boolean(nextState.reducedMotion),
    };
    const { progress, settle, reducedMotion } = state;
    const p = reducedMotion ? 0 : progress;
    const s = reducedMotion ? 0 : smooth(settle);
    const opacity = reducedMotion ? 1 - state.resultOpacity : 1 - s;
    linerUniforms.uProgress.value = progress;
    linerUniforms.uRevealed.value = reducedMotion ? state.resultOpacity : 0;
    liner.visible = loaded && (progress > 0 || state.resultOpacity > 0);
    const leakFade = 1 - smooth(Math.max(settle, state.resultOpacity));
    leakUniforms.uProgress.value = progress;
    leakUniforms.uFade.value = reducedMotion ? 0 : leakFade;
    seamLeak.visible = loaded && !reducedMotion && progress > 0 && leakFade > 0;
    uniforms.curvature.value = reducedMotion ? 0 : Math.min(1, progress * 8);
    uniforms.progress.value = p;
    paperMaterial.opacity = opacity;
    edgeMaterial.opacity = opacity;
    paper.visible = loaded && opacity > 0.001;
    edge.visible = paper.visible && p > 0;
    outer.visible = loaded;
    shell.visible = loaded;

    const positions = paperGeometry.attributes.position.array;
    for (let i = 0; i < flatPositions.length; i += 3) {
      const point = deform(flatPositions[i], flatPositions[i + 1], p, s);
      positions[i] = point.x;
      positions[i + 1] = point.y;
      positions[i + 2] = point.z;
      for (const shadow of shadowPasses) {
        const a = shadow.geometry.attributes.position.array;
        const height = Math.max(0, point.z - PAPER_Z);
        const penumbra = (0.004 + height * 0.035) * shadow.offset;
        a[i] = point.x + height * 0.26 + penumbra;
        a[i + 1] = point.y - height * 0.22 + penumbra * 0.65;
        a[i + 2] = 0.002;
      }
    }
    paperGeometry.attributes.position.needsUpdate = true;
    paperGeometry.computeVertexNormals();
    boundary.forEach(([u, v], index) => {
      const point = deform((u - 0.5) * WIDTH, (v - 0.5) * HEIGHT, p, s);
      for (let side = 0; side < 2; side += 1) {
        const offset = (side - 0.5) * THICKNESS;
        const i = index * 6 + side * 3;
        edgePositions[i] = point.x + point.nx * offset;
        edgePositions[i + 1] = point.y;
        edgePositions[i + 2] = point.z + point.nz * offset;
      }
    });
    edgeGeometry.attributes.position.needsUpdate = true;
    for (const shadow of shadowPasses) {
      shadow.geometry.attributes.position.needsUpdate = true;
      shadow.material.opacity = opacity * Math.min(1, p * 24) * 0.048;
      shadow.mesh.visible = paper.visible && !reducedMotion && p > 0;
    }
    renderer.render(scene, camera);
  }

  function resize(width, height, pixelRatio = 1) {
    if (disposed) return;
    const w = Math.max(1, Number(width) || 390);
    const h = Math.max(1, Number(height) || 500);
    const ratio = Math.max(0.5, Math.min(3, Number(pixelRatio) || 1));
    dimensions = { width: w, height: h, pixelRatio: ratio };
    const ticketPixels = Math.min(w * 0.735, h * 0.7 * ART_WIDTH / ART_HEIGHT);
    const worldWidth = SHELL_WIDTH * w / ticketPixels;
    const worldHeight = worldWidth * h / w;
    camera.left = -worldWidth / 2;
    camera.right = worldWidth / 2;
    camera.top = worldHeight / 2;
    camera.bottom = -worldHeight / 2;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    render(state);
  }

  function getHitRect() {
    const topLeft = new THREE.Vector3(-SHELL_WIDTH / 2, SHELL_HEIGHT / 2, PAPER_Z).project(camera);
    const bottomRight = new THREE.Vector3(SHELL_WIDTH / 2, -SHELL_HEIGHT / 2, PAPER_Z).project(camera);
    return {
      x: (topLeft.x + 1) / 2,
      y: (1 - topLeft.y) / 2,
      width: (bottomRight.x - topLeft.x) / 2,
      height: (topLeft.y - bottomRight.y) / 2,
    };
  }

  function getResultRect() {
    // Only the DOM result area grows; the original ticket/camera stay unchanged.
    // UV .10–.90 / .12–.88 remains inside the cavity, clear of the pull-tab and
    // slanted edge (at least 37 source pixels of fully peeled padding).
    const topLeft = new THREE.Vector3(-0.40 * WIDTH, 0.38 * HEIGHT, PAPER_Z).project(camera);
    const bottomRight = new THREE.Vector3(0.40 * WIDTH, -0.38 * HEIGHT, PAPER_Z).project(camera);
    return {
      x: (topLeft.x + 1) / 2,
      y: (1 - topLeft.y) / 2,
      width: (bottomRight.x - topLeft.x) / 2,
      height: (topLeft.y - bottomRight.y) / 2,
    };
  }

  function inspect() {
    return {
      loaded, disposed, state: { ...state }, dimensions: { ...dimensions },
      sourceAspectRatio: ART_WIDTH / ART_HEIGHT,
      subdivisions: { columns: COLUMNS, rows: ROWS },
      geometry: 'cylindrical left-to-right peel with reflected free tail',
      detailRevision: KUJI_SCENE_DETAIL_REVISION,
      paperDetail: 'backside-only UV-fixed filtered grain and broad fold shading; original front unchanged',
      seamDetail: 'same-resolution assembled print within attached leaf coverage; stationary margins and curled-leaf alpha preserved',
      thickness: THICKNESS,
      hitRect: getHitRect(),
      resultRect: getResultRect(),
      customFrontTexture: frontWasReplaced,
      paperVisible: paper.visible,
      interiorLiner: {
        visible: liner.visible,
        material: 'ivory printed stock',
        source: 'inverse original stationary cavity alpha',
        frontOccluded: true,
      },
      stationaryNativeDetails: { borderWidth: 4, borderColor: '#A83C15', borderRadius: 12, tearTeeth: 10 },
      lightLeak: {
        visible: seamLeak.visible,
        source: 'recessed cream light beneath the moving paper fold',
        progress: leakUniforms.uProgress.value,
        fade: leakUniforms.uFade.value,
        confinedToTicket: true,
        verticalProfile: 'soft center-weighted feather; local spill only',
      },
      resultContent: 'host-owned DOM; never drawn into paper',
      calls: renderer.info.render.calls,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const texture of ownedTextures) texture.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    renderer.dispose();
  }

  resize(390, 500, 1);
  return { ready, render, resize, dispose, inspect, getHitRect, getResultRect, setFrontTexture };
}
