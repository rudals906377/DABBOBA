import * as THREE from '../assets/vendor/three.module.min.js';
import { CAPSULE_3D_VERTEX_SHADER } from './capsule-shader.mjs';
import { CAPSULE_PREVIEW_FRAGMENT_SHADER, CAPSULE_MATERIAL_REVISION, CAPSULE_OPEN_OFFSET } from './capsule-material.mjs';

// Current native pickup coordinates in its untouched 190 × 338 artwork.
const PICKUP = Object.freeze({ left: 109, top: 239, width: 24, height: 29, restX: 121, restY: 257, diameter: 18 });
const MACHINE = Object.freeze({ width: 190, height: 338 });
const FOREGROUND = Object.freeze({ left: 107, top: 267, width: 28, height: 11 });
const ATLAS_CAMERA = Object.freeze({ width: 192, height: 256, diameter: 130 });

const TEXTURE_VERTEX = `precision highp float;
attribute vec3 position; attribute vec2 uv;
uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
varying vec2 imageUv;
void main(){imageUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const TEXTURE_FRAGMENT = `precision highp float;
uniform sampler2D imageMap;uniform float imageOpacity;varying vec2 imageUv;
void main(){vec4 color=texture2D(imageMap,imageUv);gl_FragColor=vec4(color.rgb,color.a*imageOpacity);}`;
// Air scattering is separate from the capsule material. The original
// opaque shell is drawn over this light, so it cannot leak through the bowl.
const SPILL_FRAGMENT = `precision highp float;
uniform float energy;varying vec2 imageUv;
void main(){
  vec2 p=imageUv-vec2(.5,.18);
  float rise=max(p.y,0.);
  float width=.22+rise*.28;
  float air=exp(-pow(p.x/width,2.)*2.5-rise*3.8);
  air*=smoothstep(-.04,.025,p.y)*(1.-smoothstep(.62,.80,p.y));
  float mouth=exp(-pow(p.x/.25,2.)*2.-pow(p.y/.035,2.));
  float edge=1.-smoothstep(.38,.50,abs(p.x));
  gl_FragColor=vec4(vec3(1.,.98,.83),min(.65,(air*.30+mouth*.35)*energy)*edge);
}`;
const REVEAL_FRAGMENT = `precision highp float;
uniform float progress;varying vec2 imageUv;
void main(){
  float d=length((imageUv-vec2(.5,.47))*vec2(.78,1.));
  float radius=progress*1.25;
  float a=(1.-smoothstep(max(0.,radius-.28),max(.001,radius),d))*smoothstep(0.,.3,progress);
  gl_FragColor=vec4(1.,1.,1.,a);
}`;
const CONTACT_FRAGMENT = `precision highp float;
uniform float opacity;varying vec2 imageUv;
void main(){
  vec2 p=(imageUv-.5)*2.;
  float falloff=1.-smoothstep(.08,1.,length(p));
  gl_FragColor=vec4(.018,.024,.019,falloff*falloff*opacity);
}`;

/**
 * Native capsule geometry inside its original pixel pickup. The source shader
 * is preserved; a preview-only upper material removes its green cast. The lower
 * palette, normals, wordmark, internal light and camera remain intact.
 */
export function createGachaScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: false });
  renderer.setClearColor(0x101411, 1);
  renderer.autoClear = false;
  const camera = new THREE.OrthographicCamera(-195, 195, 240, -240, .1, 10);
  camera.position.z = 3;
  const scenery = new THREE.Scene();
  const capsuleScene = new THREE.Scene();
  const foregroundScene = new THREE.Scene();
  const lightScene = new THREE.Scene();
  const revealScene = new THREE.Scene();
  const heroScene = new THREE.Scene();
  const heroCamera = new THREE.Camera();
  const loader = new THREE.TextureLoader();
  const textures = [];
  const materials = [];
  const geometries = [];
  let loaded = false;
  let disposed = false;
  let dimensions = { width: 390, height: 480, pixelRatio: 1 };
  let lastState = { time: 0, dropHeight: 2.8, opening: 0, light: 0, resultOpacity: 0, reducedMotion: false };
  let lastProjection = null;
  let atlasState = null;
  let atlasRenderCount = 0;
  let lastPassCount = 0;
  let lastAtlasUpdated = false;

  const textureMaterial = imageMap => {
    const material = new THREE.RawShaderMaterial({
      uniforms: { imageMap: { value: imageMap }, imageOpacity: { value: 1 } },
      vertexShader: TEXTURE_VERTEX, fragmentShader: TEXTURE_FRAGMENT,
      transparent: true, depthTest: false, depthWrite: false,
    });
    materials.push(material);
    return material;
  };
  function plane(parent, name, material) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometries.push(geometry);
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    parent.add(object);
    return object;
  }
  function setRect(object, left, top, width, height) {
    object.position.set(left + width / 2 - dimensions.width / 2, dimensions.height / 2 - top - height / 2, 0);
    object.scale.set(width, height, 1);
  }

  const machineMaterial = textureMaterial(null);
  const machine = plane(scenery, 'original-app-pixel-machine', machineMaterial);
  const contactMaterial = new THREE.RawShaderMaterial({
    uniforms: { opacity: { value: 0 } }, vertexShader: TEXTURE_VERTEX,
    fragmentShader: CONTACT_FRAGMENT, transparent: true, depthTest: false, depthWrite: false,
  });
  materials.push(contactMaterial);
  const contact = plane(scenery, 'small-tray-contact-shadow', contactMaterial);
  machine.renderOrder = 0; contact.renderOrder = 1;
  const lipMaterial = textureMaterial(null);
  const frontLip = plane(foregroundScene, 'original-app-pickup-front-lip', lipMaterial);
  const spillMaterial = new THREE.RawShaderMaterial({
    uniforms: { energy: { value: 0 } },
    vertexShader: TEXTURE_VERTEX, fragmentShader: SPILL_FRAGMENT,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  materials.push(spillMaterial);
  const spill = plane(lightScene, 'soft-air-light-from-bowl-mouth', spillMaterial);
  const revealMaterial = new THREE.RawShaderMaterial({
    uniforms: { progress: { value: 0 } }, vertexShader: TEXTURE_VERTEX,
    fragmentShader: REVEAL_FRAGMENT, transparent: true, depthTest: false, depthWrite: false,
  });
  materials.push(revealMaterial);
  const reveal = plane(revealScene, 'light-expands-from-capsule-to-white-result', revealMaterial);

  // Exact native atlas camera (130 / 192); host aspect never changes perspective.
  const target = new THREE.WebGLRenderTarget(576, 768, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  const uniforms = {
    uResolution: { value: new THREE.Vector2(576, 768) },
    uProjection: { value: new THREE.Vector3(.5, .5, ATLAS_CAMERA.diameter) },
    uViewWidth: { value: ATLAS_CAMERA.width },
    uProgress: { value: 0 }, uIvory: { value: 0 },
    uWordmark: { value: null }, uReveal: { value: new THREE.Vector3() },
    uRattle: { value: 0 }, uOpacity: { value: 1 },
    uClip: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
  const heroMaterial = new THREE.RawShaderMaterial({
    uniforms, vertexShader: CAPSULE_3D_VERTEX_SHADER, fragmentShader: CAPSULE_PREVIEW_FRAGMENT_SHADER,
    transparent: false, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  materials.push(heroMaterial);
  const heroGeometry = new THREE.BufferGeometry();
  heroGeometry.setAttribute('aPosition', new THREE.Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1], 2));
  heroGeometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometries.push(heroGeometry);
  const hero = new THREE.Mesh(heroGeometry, heroMaterial);
  hero.frustumCulled = false;
  heroScene.add(hero);
  const capsuleMaterial = textureMaterial(target.texture);
  const capsule = plane(capsuleScene, 'native-capsule-with-neutral-upper-material', capsuleMaterial);
  const unit = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

  function render(state = lastState) {
    if (disposed) return;
    const reducedMotion = Boolean(state.reducedMotion);
    lastState = {
      time: Number.isFinite(state.time) ? state.time : 0,
      dropHeight: reducedMotion ? 0 : Math.max(0, Math.min(3.1, Number.isFinite(state.dropHeight) ? state.dropHeight : 0)),
      opening: reducedMotion ? 0 : unit(state.opening),
      seal: reducedMotion ? 0 : unit(state.seal),
      rattle: reducedMotion ? 0 : Math.max(-.035, Math.min(.035, Number(state.rattle) || 0)),
      focus: reducedMotion ? 0 : unit(state.focus),
      light: reducedMotion ? 0 : unit(state.light),
      whiteout: unit(state.whiteout),
      resultOpacity: unit(state.resultOpacity), reducedMotion,
    };
    if (!loaded) return;
    const { width, height } = dimensions;
    const focus = lastState.focus;
    const restingDiameter = Math.min(width * .40, height * .335);
    const closeupDiameter = Math.min(width * .64, height * .48);
    const diameter = restingDiameter + (closeupDiameter - restingDiameter) * focus;
    const scale = diameter / PICKUP.diameter;
    const centerX = width / 2;
    const restY = height * (.635 - .105 * focus);
    const machineLeft = centerX - PICKUP.restX * scale;
    const machineTop = restY - PICKUP.restY * scale;
    setRect(machine, machineLeft, machineTop, MACHINE.width * scale, MACHINE.height * scale);
    setRect(frontLip,
      machineLeft + FOREGROUND.left * scale, machineTop + FOREGROUND.top * scale,
      FOREGROUND.width * scale, FOREGROUND.height * scale,
    );
    // One continuous subject/camera move. Machine pixels grow with the capsule
    // and dissolve before the seal opens; there is no detached flying capsule.
    const machineOpacity = 1 - Math.min(1, focus / .92);
    machineMaterial.uniforms.imageOpacity.value = machineOpacity;
    lipMaterial.uniforms.imageOpacity.value = machineOpacity;
    const contactShadow = {
      left: centerX - diameter * .36, top: restY + diameter * .43,
      width: diameter * .72, height: diameter * .14,
      opacity: !reducedMotion && lastState.time >= .44
        ? .30 * Math.exp(-lastState.dropHeight * 9) * (1 - focus) : 0,
    };
    setRect(contact, contactShadow.left, contactShadow.top, contactShadow.width, contactShadow.height);
    contactMaterial.uniforms.opacity.value = contactShadow.opacity;
    const opening = lastState.opening;
    const crack = lastState.seal;
    // Original shader separates both halves. Compensate its lower-center
    // displacement in scene projection so that the lower bowl stays seated.
    // Use the same separation distance as the isolated preview shader.
    const fixedDistance = Math.sqrt((2.7 / (ATLAS_CAMERA.diameter / ATLAS_CAMERA.width)) ** 2 + 1);
    const pixelsPerRadius = (2.7 * ATLAS_CAMERA.width / 2 / fixedDistance) * diameter / ATLAS_CAMERA.diameter;
    const seatCompensation = (crack * .035 + opening * CAPSULE_OPEN_OFFSET) * pixelsPerRadius;
    const centerY = restY - lastState.dropHeight * diameter / 2 - seatCompensation;
    const spriteWidth = diameter * ATLAS_CAMERA.width / ATLAS_CAMERA.diameter;
    const spriteHeight = diameter * ATLAS_CAMERA.height / ATLAS_CAMERA.diameter;
    setRect(capsule, centerX - spriteWidth / 2, centerY - spriteHeight / 2, spriteWidth, spriteHeight);
    uniforms.uProgress.value = opening;
    uniforms.uReveal.value.set(crack, opening, lastState.light);
    uniforms.uRattle.value = lastState.rattle;
    uniforms.uOpacity.value = 1;
    setRect(spill, centerX - diameter * .7, restY - diameter * .91, diameter * 1.4, diameter * 1.1);
    spillMaterial.uniforms.energy.value = lastState.light * focus;
    setRect(reveal, 0, 0, width, height);
    revealMaterial.uniforms.progress.value = lastState.whiteout;
    capsuleMaterial.uniforms.imageOpacity.value = reducedMotion && lastState.resultOpacity >= .98 ? 0 : 1;
    // Only these values affect the native capsule texture. Position/zoom are
    // compositing transforms, so reusing the same atlas preserves every pixel.
    // This also avoids recomputing the closed shell throughout the push-in.
    lastPassCount = 0;
    lastAtlasUpdated = !atlasState || atlasState.opening !== opening
      || atlasState.crack !== crack || atlasState.light !== lastState.light
      || atlasState.rattle !== lastState.rattle;
    if (lastAtlasUpdated) {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(heroScene, heroCamera);
      atlasState = { opening, crack, light: lastState.light, rattle: lastState.rattle };
      atlasRenderCount++; lastPassCount++;
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x101411, 1);
    renderer.clear(true, true, true);
    // Zero-opacity passes cannot contribute to the frame. Do not draw the
    // enlarged cabinet behind the isolated capsule, or inactive light layers.
    if (machineOpacity > 0 || contactShadow.opacity > .0001) { renderer.render(scenery, camera); lastPassCount++; }
    if (spillMaterial.uniforms.energy.value > 0) { renderer.render(lightScene, camera); lastPassCount++; }
    const aperture = {
      left: machineLeft + PICKUP.left * scale,
      top: machineTop + PICKUP.top * scale,
      width: PICKUP.width * scale,
      height: PICKUP.height * scale,
    };
    renderer.setScissor(aperture.left, height - aperture.top - aperture.height, aperture.width, aperture.height);
    renderer.setScissorTest(focus < .001);
    renderer.render(capsuleScene, camera);
    lastPassCount++;
    renderer.setScissorTest(false);
    if (machineOpacity > 0) { renderer.render(foregroundScene, camera); lastPassCount++; }
    if (lastState.whiteout > 0) { renderer.render(revealScene, camera); lastPassCount++; }
    lastProjection = { centerX, centerY, restY, diameter, seatCompensation, aperture, focus, machineOpacity, contactShadow, spillEnergy: spillMaterial.uniforms.energy.value };
  }

  function resize(width, height, pixelRatio = 1) {
    if (disposed) return;
    dimensions = {
      width: Math.max(1, Math.round(Number(width) || 390)),
      height: Math.max(1, Math.round(Number(height) || 480)),
      pixelRatio: Math.min(3, Math.max(1, Number(pixelRatio) || 1)),
    };
    renderer.setPixelRatio(dimensions.pixelRatio);
    renderer.setSize(dimensions.width, dimensions.height, false);
    camera.left = -dimensions.width / 2;
    camera.right = dimensions.width / 2;
    camera.top = dimensions.height / 2;
    camera.bottom = -dimensions.height / 2;
    camera.updateProjectionMatrix();
    render(lastState);
  }

  function inspect() {
    return {
      kind: 'native-capsule-pickup-to-isolated-closeup', loaded, disposed,
      dimensions: { ...dimensions }, state: { ...lastState }, projection: lastProjection,
      rendering: { atlasRenderCount, lastPassCount, lastAtlasUpdated, atlasResolution: [576, 768] },
      sourceShaderCopyUnmodified: true, originalArtworkUnmodified: true,
      materialRevision: CAPSULE_MATERIAL_REVISION, upperMaterialModified: true, lowerMaterialUnmodified: true,
      nativeCamera: { ...ATLAS_CAMERA },
      assets: ['assets/brand/dabboba-wordmark.png', 'assets/gacha/capsule-machine-front-empty.png'],
    };
  }
  function restoreContext() {
    atlasState = null;
    render(lastState);
  }
  canvas.addEventListener('webglcontextrestored', restoreContext);
  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('webglcontextrestored', restoreContext);
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometries.forEach(geometry => geometry.dispose());
    target.dispose();
    renderer.dispose();
  }

  resize(390, 480, 1);
  const ready = Promise.all([
    loader.loadAsync(new URL('../assets/brand/dabboba-wordmark.png', import.meta.url).href),
    loader.loadAsync(new URL('../assets/gacha/capsule-machine-front-empty.png', import.meta.url).href),
  ]).then(([wordmark, artwork]) => {
    if (disposed) { wordmark.dispose(); artwork.dispose(); return; }
    textures.push(wordmark, artwork);
    wordmark.flipY = false; // Exact native UNPACK_FLIP_Y_WEBGL = 0 convention.
    wordmark.minFilter = THREE.LinearFilter;
    wordmark.magFilter = THREE.LinearFilter;
    wordmark.generateMipmaps = false;
    wordmark.needsUpdate = true;
    artwork.magFilter = THREE.NearestFilter;
    artwork.minFilter = THREE.NearestFilter;
    artwork.generateMipmaps = false;
    artwork.needsUpdate = true;
    // Reuse the original lip pixels at exact source UVs. No edited derivative.
    const lipUv = frontLip.geometry.getAttribute('uv');
    for (let index = 0; index < lipUv.count; index += 1) {
      lipUv.setXY(index,
        FOREGROUND.left / MACHINE.width + lipUv.getX(index) * FOREGROUND.width / MACHINE.width,
        1 - (FOREGROUND.top + FOREGROUND.height) / MACHINE.height + lipUv.getY(index) * FOREGROUND.height / MACHINE.height,
      );
    }
    lipUv.needsUpdate = true;
    uniforms.uWordmark.value = wordmark;
    machineMaterial.uniforms.imageMap.value = artwork;
    lipMaterial.uniforms.imageMap.value = artwork;
    loaded = true;
    render(lastState);
  });
  return { ready, render, resize, dispose, inspect };
}
