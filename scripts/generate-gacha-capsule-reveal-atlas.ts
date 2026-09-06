import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  CAPSULE_3D_FRAGMENT_SHADER,
  CAPSULE_3D_VERTEX_SHADER,
} from "../apps/mobile/src/features/draw/gacha-capsule-3d-shaders.ts";
import { sampleGachaRevealLighting, sampleGachaRevealRattle } from "../apps/mobile/src/features/draw/gacha-reveal-timeline.ts";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORDMARK_PATH = resolve(REPOSITORY_ROOT, "apps/mobile/assets/dabboba-wordmark.png");
const REVEAL_TIMELINE_PATH = resolve(
  REPOSITORY_ROOT,
  "apps/mobile/src/features/draw/gacha-reveal-timeline.ts",
);
const ATLAS_PATH = resolve(
  REPOSITORY_ROOT,
  "apps/mobile/assets/gacha-capsule-reveal-atlas-v1.png",
);
const MANIFEST_PATH = resolve(
  REPOSITORY_ROOT,
  "apps/mobile/assets/gacha-capsule-reveal-atlas-v1.json",
);

const FRAME_WIDTH = 192;
// Opening separates the analytical hemispheres beyond the closed sphere's
// diameter. Keep the native projection at 130px wide, but give those shells
// symmetric vertical room so their geometry never gets cropped by a tile.
const FRAME_HEIGHT = 256;
const COLUMNS = 8;
// Eighty poses keep the three-second reveal below 36ms between frames while
// preserving the approved shell resolution and a 15MiB decoded texture.
const ROWS = 10;
const FRAME_COUNT = COLUMNS * ROWS;
const REVEAL_PROGRESS_MIN = 0;
const REVEAL_PROGRESS_MAX = 0.92;
const CAPSULE_DIAMETER = 130;
const MAX_TEXTURE_DIMENSION = 4096;
const MAX_DECODED_BYTES = 16 * 1024 * 1024;

type RenderedAtlas = {
  pngDataUrl: string;
  visiblePixelCounts: number[];
};

function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function rounded(value: number): number {
  return Number(value.toFixed(8));
}

async function writeIfChanged(path: string, contents: Uint8Array | string): Promise<void> {
  const next = typeof contents === "string" ? Buffer.from(contents) : Buffer.from(contents);
  const current = await readFile(path).catch(() => null);
  if (current?.equals(next)) return;
  await writeFile(path, next);
}

const frameProgress = Array.from({ length: FRAME_COUNT }, (_, index) => rounded(
  REVEAL_PROGRESS_MIN
    + (REVEAL_PROGRESS_MAX - REVEAL_PROGRESS_MIN) * index / (FRAME_COUNT - 1),
));
const frameLighting = frameProgress.map((progress) => sampleGachaRevealLighting(progress, false));
const atlasWidth = FRAME_WIDTH * COLUMNS;
const atlasHeight = FRAME_HEIGHT * ROWS;
const decodedBytes = atlasWidth * atlasHeight * 4;

if (atlasWidth > MAX_TEXTURE_DIMENSION || atlasHeight > MAX_TEXTURE_DIMENSION) {
  throw new Error(`Atlas exceeds ${MAX_TEXTURE_DIMENSION}px texture limit`);
}
if (decodedBytes > MAX_DECODED_BYTES) {
  throw new Error(`Atlas exceeds ${MAX_DECODED_BYTES} decoded-byte budget`);
}

const [wordmark, revealTimelineSource] = await Promise.all([
  readFile(WORDMARK_PATH),
  readFile(REVEAL_TIMELINE_PATH, "utf8"),
]);
const wordmarkDataUri = `data:image/png;base64,${wordmark.toString("base64")}`;

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--enable-webgl",
    "--host-resolver-rules=MAP * 0.0.0.0",
    "--ignore-gpu-blocklist",
    "--metrics-recording-only",
    "--no-first-run",
    "--use-angle=swiftshader",
    "--use-gl=angle",
  ],
});

let rendered: RenderedAtlas;
let browserVersion: string;
try {
  browserVersion = browser.version();
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    offline: true,
    serviceWorkers: "block",
    viewport: { width: atlasWidth, height: atlasHeight },
  });
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}canvas{display:block}
  </style><canvas id="frame"></canvas><canvas id="atlas"></canvas>`);
  // tsx preserves function names through this helper. Playwright serializes the
  // callback without the module wrapper, so provide the identity helper inside
  // the isolated offline page before evaluating the renderer.
  await page.evaluate("globalThis.__name = (target) => target");

  rendered = await page.evaluate(async (input): Promise<RenderedAtlas> => {
    const frameCanvas = document.querySelector<HTMLCanvasElement>("#frame");
    const atlasCanvas = document.querySelector<HTMLCanvasElement>("#atlas");
    if (!frameCanvas || !atlasCanvas) throw new Error("Atlas canvases are unavailable");
    // Bake smooth edges offline without increasing the native texture budget.
    frameCanvas.width = input.frameWidth * input.supersample;
    frameCanvas.height = input.frameHeight * input.supersample;
    atlasCanvas.width = input.atlasWidth;
    atlasCanvas.height = input.atlasHeight;
    frameCanvas.style.display = "none";

    const gl = frameCanvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      stencil: false,
    });
    const atlas = atlasCanvas.getContext("2d", { alpha: true });
    if (!gl || !atlas) throw new Error("Offline WebGL atlas renderer is unavailable");
    const webgl = gl;
    atlas.imageSmoothingEnabled = true;
    atlas.imageSmoothingQuality = "high";
    atlas.clearRect(0, 0, input.atlasWidth, input.atlasHeight);

    function compileShader(kind: number, source: string): WebGLShader {
      const shader = webgl.createShader(kind);
      if (!shader) throw new Error("Shader allocation failed");
      webgl.shaderSource(shader, source);
      webgl.compileShader(shader);
      if (!webgl.getShaderParameter(shader, webgl.COMPILE_STATUS)) {
        const message = webgl.getShaderInfoLog(shader) ?? "Shader compilation failed";
        webgl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    }

    const vertexShader = compileShader(gl.VERTEX_SHADER, input.vertexShader);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, input.fragmentShader);
    const program = gl.createProgram();
    if (!program) throw new Error("Program allocation failed");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Program link failed");
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    const vertexBuffer = gl.createBuffer();
    const wordmarkTexture = gl.createTexture();
    if (!vertexBuffer || !wordmarkTexture) throw new Error("Render resource allocation failed");
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const wordmark = new Image();
    wordmark.src = input.wordmarkDataUri;
    await wordmark.decode();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, wordmarkTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, wordmark);

    const position = gl.getAttribLocation(program, "aPosition");
    const uniforms = {
      resolution: gl.getUniformLocation(program, "uResolution"),
      projection: gl.getUniformLocation(program, "uProjection"),
      viewWidth: gl.getUniformLocation(program, "uViewWidth"),
      progress: gl.getUniformLocation(program, "uProgress"),
      ivory: gl.getUniformLocation(program, "uIvory"),
      wordmark: gl.getUniformLocation(program, "uWordmark"),
      reveal: gl.getUniformLocation(program, "uReveal"),
      rattle: gl.getUniformLocation(program, "uRattle"),
      opacity: gl.getUniformLocation(program, "uOpacity"),
      clip: gl.getUniformLocation(program, "uClip"),
    };
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.viewport(0, 0, frameCanvas.width, frameCanvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uniforms.resolution, frameCanvas.width, frameCanvas.height);
    gl.uniform3f(
      uniforms.projection,
      input.projection.centerX,
      input.projection.centerY,
      input.projection.diameter,
    );
    gl.uniform1f(uniforms.viewWidth, input.projection.viewWidth);
    gl.uniform1f(uniforms.ivory, 0);
    gl.uniform4f(uniforms.clip, 0, 0, 1, 1);
    gl.uniform1i(uniforms.wordmark, 0);

    const rgba = new Uint8Array(frameCanvas.width * frameCanvas.height * 4);
    const visiblePixelCounts: number[] = [];
    for (let index = 0; index < input.frames.length; index += 1) {
      const frame = input.frames[index]!;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uniforms.progress, frame.progress);
      gl.uniform3f(uniforms.reveal, frame.seal, frame.opening, frame.innerLight);
      gl.uniform1f(uniforms.rattle, frame.rattle);
      gl.uniform1f(uniforms.opacity, frame.shellOpacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.finish();
      gl.readPixels(0, 0, frameCanvas.width, frameCanvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      let visible = 0;
      for (let offset = 3; offset < rgba.length; offset += 4) {
        if (rgba[offset]! > 0) visible += 1;
      }
      visiblePixelCounts.push(visible);
      atlas.drawImage(
        frameCanvas,
        (index % input.columns) * input.frameWidth,
        Math.floor(index / input.columns) * input.frameHeight,
        input.frameWidth,
        input.frameHeight,
      );
    }

    gl.deleteBuffer(vertexBuffer);
    gl.deleteTexture(wordmarkTexture);
    gl.deleteProgram(program);
    return {
      pngDataUrl: atlasCanvas.toDataURL("image/png"),
      visiblePixelCounts,
    };
  }, {
    atlasHeight,
    atlasWidth,
    columns: COLUMNS,
    fragmentShader: CAPSULE_3D_FRAGMENT_SHADER,
    frameHeight: FRAME_HEIGHT,
    frameWidth: FRAME_WIDTH,
    supersample: 2,
    frames: frameProgress.map((progress, index) => ({
      progress,
      seal: frameLighting[index]!.seal,
      opening: frameLighting[index]!.opening,
      innerLight: frameLighting[index]!.innerLight,
      rattle: sampleGachaRevealRattle(progress),
      shellOpacity: frameLighting[index]!.shellOpacity,
    })),
    projection: {
      centerX: 0.5,
      centerY: 0.5,
      diameter: CAPSULE_DIAMETER,
      viewWidth: FRAME_WIDTH,
    },
    vertexShader: CAPSULE_3D_VERTEX_SHADER,
    wordmarkDataUri,
  });
  await context.close();
} finally {
  await browser.close();
}

const pngPrefix = "data:image/png;base64,";
if (!rendered.pngDataUrl.startsWith(pngPrefix)) {
  throw new Error("Offline renderer did not return a PNG atlas");
}
if (rendered.visiblePixelCounts.length !== FRAME_COUNT) {
  throw new Error("Offline renderer returned an incomplete frame set");
}
if (rendered.visiblePixelCounts[0] === 0) {
  throw new Error("Closed capsule frame is empty");
}
if (rendered.visiblePixelCounts.at(-1) !== 0) {
  throw new Error("Final shell frame must be transparent before the native prize settles");
}

const atlas = Buffer.from(rendered.pngDataUrl.slice(pngPrefix.length), "base64");
const require = createRequire(import.meta.url);
const playwrightVersion = (require("playwright/package.json") as { version: string }).version;
const manifest = {
  schemaVersion: 1,
  kind: "analytical-capsule-reveal",
  tone: "lime",
  assetFile: "gacha-capsule-reveal-atlas-v1.png",
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  columns: COLUMNS,
  rows: ROWS,
  frameCount: FRAME_COUNT,
  closedFrameIndex: 0,
  revealProgressMin: REVEAL_PROGRESS_MIN,
  revealProgressMax: REVEAL_PROGRESS_MAX,
  frameProgress,
  projection: {
    centerX: 0.5,
    centerY: 0.5,
    diameter: CAPSULE_DIAMETER,
    viewWidth: FRAME_WIDTH,
  },
  atlasWidth,
  atlasHeight,
  decodedBytes,
  generator: {
    supersample: 2,
    playwrightVersion,
    browserVersion,
    webgl: "WebGL 1 / ANGLE SwiftShader",
  },
  hashes: {
    atlasSha256: sha256(atlas),
    wordmarkSha256: sha256(wordmark),
    vertexShaderSha256: sha256(CAPSULE_3D_VERTEX_SHADER),
    fragmentShaderSha256: sha256(CAPSULE_3D_FRAGMENT_SHADER),
    revealTimelineSha256: sha256(revealTimelineSource),
  },
} as const;

await Promise.all([
  writeIfChanged(ATLAS_PATH, atlas),
  writeIfChanged(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`),
]);

console.log(JSON.stringify({
  atlas: "apps/mobile/assets/gacha-capsule-reveal-atlas-v1.png",
  manifest: "apps/mobile/assets/gacha-capsule-reveal-atlas-v1.json",
  frameCount: FRAME_COUNT,
  atlasWidth,
  atlasHeight,
  decodedBytes,
  atlasSha256: manifest.hashes.atlasSha256,
}, null, 2));
