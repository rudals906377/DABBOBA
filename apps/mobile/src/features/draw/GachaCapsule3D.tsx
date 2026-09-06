import { useCallback, useEffect, useRef } from "react";
import { AppState, PixelRatio, StyleSheet, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { Asset } from "expo-asset";
import { useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { GACHA_PICKUP_GEOMETRY, sampleGachaCameraMotion, sampleGachaPickupMotion } from "@/features/draw/gacha-camera-motion";
import { sampleGachaRevealLighting, sampleGachaRevealRattle } from "@/features/draw/gacha-reveal-timeline";
import {
  CAPSULE_3D_FRAGMENT_SHADER,
  CAPSULE_3D_VERTEX_SHADER,
} from "@/features/draw/gacha-capsule-3d-shaders";

type GachaCapsule3DProps = {
  progress: SharedValue<number>;
  dispenseProgress: SharedValue<number>;
  /** Last submitted GL projection; -1 asks the parent to use its native clock. */
  cameraProgress?: SharedValue<number>;
  viewportSize: { width: number; height: number };
  active: SharedValue<number>;
  reduceMotion: boolean;
  tone: "lime" | "ivory";
  onReady?: () => void;
  onUnavailable?: (reason?: string) => void;
};

type CapsuleFrame = {
  progress: number;
  dispenseProgress: number;
  ivory: number;
  viewWidth: number;
  viewHeight: number;
};

type CapsuleGLResources = {
  gl: ExpoWebGLRenderingContext;
  sceneProgram: WebGLProgram;
  vertexBuffer: WebGLBuffer;
  wordmarkTexture: WebGLTexture;
  scenePosition: number;
  resolutionUniform: WebGLUniformLocation | null;
  projectionUniform: WebGLUniformLocation | null;
  viewWidthUniform: WebGLUniformLocation | null;
  progressUniform: WebGLUniformLocation | null;
  ivoryUniform: WebGLUniformLocation | null;
  revealUniform: WebGLUniformLocation | null;
  rattleUniform: WebGLUniformLocation | null;
  opacityUniform: WebGLUniformLocation | null;
  clipUniform: WebGLUniformLocation | null;
  wordmarkUniform: WebGLUniformLocation | null;
  pixelWidth: number;
  pixelHeight: number;
  drawingWidth: number;
  drawingHeight: number;
};

const PIXEL_RENDER_WIDTH = 176;
const FRAME_INTERVAL_MS = 1000 / 30;
const WORDMARK_ASSET = require("../../../assets/dabboba-wordmark.png");

function compileShader(gl: ExpoWebGLRenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (!shader) throw new Error("Capsule shader allocation failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Capsule shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: ExpoWebGLRenderingContext, fragment: string): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, CAPSULE_3D_VERTEX_SHADER);
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram();
    if (!program) throw new Error("Capsule program allocation failed");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Capsule program link failed");
    }
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }
}

function createRenderer(gl: ExpoWebGLRenderingContext, wordmarkLocalUri: string): CapsuleGLResources {
  const sceneProgram = createProgram(gl, CAPSULE_3D_FRAGMENT_SHADER);
  let vertexBuffer: WebGLBuffer | null = null;
  let wordmarkTexture: WebGLTexture | null = null;
  try {
    vertexBuffer = gl.createBuffer();
    wordmarkTexture = gl.createTexture();
    if (!vertexBuffer || !wordmarkTexture) throw new Error("Capsule render-target allocation failed");
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pixelHeight = Math.max(1, Math.round(PIXEL_RENDER_WIDTH * gl.drawingBufferHeight / Math.max(gl.drawingBufferWidth, 1)));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Consume the canonical transparent PNG unchanged. Expo GL accepts a local
    // file image source in this standard texImage2D overload on native devices.
    gl.bindTexture(gl.TEXTURE_2D, wordmarkTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
      { localUri: wordmarkLocalUri } as unknown as TexImageSource);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    return {
      gl,
      sceneProgram,
      vertexBuffer,
      wordmarkTexture,
      scenePosition: gl.getAttribLocation(sceneProgram, "aPosition"),
      resolutionUniform: gl.getUniformLocation(sceneProgram, "uResolution"),
      projectionUniform: gl.getUniformLocation(sceneProgram, "uProjection"),
      viewWidthUniform: gl.getUniformLocation(sceneProgram, "uViewWidth"),
      progressUniform: gl.getUniformLocation(sceneProgram, "uProgress"),
      ivoryUniform: gl.getUniformLocation(sceneProgram, "uIvory"),
      revealUniform: gl.getUniformLocation(sceneProgram, "uReveal"),
      rattleUniform: gl.getUniformLocation(sceneProgram, "uRattle"),
      opacityUniform: gl.getUniformLocation(sceneProgram, "uOpacity"),
      clipUniform: gl.getUniformLocation(sceneProgram, "uClip"),
      wordmarkUniform: gl.getUniformLocation(sceneProgram, "uWordmark"),
      pixelWidth: PIXEL_RENDER_WIDTH,
      pixelHeight,
      drawingWidth: gl.drawingBufferWidth,
      drawingHeight: gl.drawingBufferHeight,
    };
  } catch (error) {
    gl.deleteProgram(sceneProgram);
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
    if (wordmarkTexture) gl.deleteTexture(wordmarkTexture);
    throw error;
  }
}

function drawFrame(renderer: CapsuleGLResources, frame: CapsuleFrame): void {
  const { gl } = renderer;
  const camera = sampleGachaCameraMotion(frame.progress, frame.viewWidth, frame.viewHeight, false);
  const pickup = sampleGachaPickupMotion(frame.dispenseProgress, false);
  const light = sampleGachaRevealLighting(frame.progress, false);
  const pickupScale = camera.presentationScale * camera.scale;
  if (renderer.drawingWidth !== gl.drawingBufferWidth || renderer.drawingHeight !== gl.drawingBufferHeight) {
    renderer.drawingWidth = gl.drawingBufferWidth;
    renderer.drawingHeight = gl.drawingBufferHeight;
    renderer.pixelHeight = Math.max(1, Math.round(renderer.pixelWidth * renderer.drawingHeight / Math.max(renderer.drawingWidth, 1)));
  }
  // The GLView itself has only 176 physical columns. Render directly into its
  // native target, with no offscreen texture pass or full-screen raytracing.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.wordmarkTexture);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(renderer.sceneProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.vertexBuffer);
  gl.enableVertexAttribArray(renderer.scenePosition);
  gl.vertexAttribPointer(renderer.scenePosition, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(renderer.resolutionUniform, renderer.pixelWidth, renderer.pixelHeight);
  gl.uniform3f(
    renderer.projectionUniform,
    (camera.capsuleX + pickup.x * pickupScale) / frame.viewWidth,
    (camera.capsuleY + pickup.y * pickupScale) / frame.viewHeight,
    camera.capsuleDiameter,
  );
  gl.uniform1f(renderer.viewWidthUniform, frame.viewWidth);
  gl.uniform1f(renderer.progressUniform, frame.progress);
  gl.uniform1f(renderer.ivoryUniform, frame.ivory);
  gl.uniform3f(renderer.revealUniform, light.seal, light.opening, light.innerLight);
  gl.uniform1f(renderer.rattleUniform, sampleGachaRevealRattle(frame.progress) - pickup.rotation * Math.PI / 180);
  gl.uniform1f(renderer.opacityUniform, pickup.opacity * light.shellOpacity);
  if (frame.dispenseProgress < 1) {
    const box = GACHA_PICKUP_GEOMETRY;
    const left = frame.viewWidth / 2 + (box.left - box.machineWidth / 2) * pickupScale + camera.translateX;
    const top = frame.viewHeight / 2 + (box.top - box.machineHeight / 2) * pickupScale + camera.translateY;
    gl.uniform4f(renderer.clipUniform, left / frame.viewWidth, top / frame.viewHeight,
      (left + box.width * pickupScale) / frame.viewWidth, (top + box.height * pickupScale) / frame.viewHeight);
  } else {
    gl.uniform4f(renderer.clipUniform, 0, 0, 1, 1);
  }
  gl.uniform1i(renderer.wordmarkUniform, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.flush();
  gl.endFrameEXP();
}

function disposeRenderer(renderer: CapsuleGLResources | null): void {
  if (!renderer) return;
  try {
    renderer.gl.deleteBuffer(renderer.vertexBuffer);
    renderer.gl.deleteTexture(renderer.wordmarkTexture);
    renderer.gl.deleteProgram(renderer.sceneProgram);
  } catch {
    // GLView also owns native context disposal when its surface is removed.
  }
}

/**
 * Full-stage transparent 3D overlay, drawn on a 176-physical-pixel native surface
 * and statically enlarged. Expo's original JS GL context runs at most 30fps;
 * native shared progress still owns the crank and immutable result gate. The
 * shell samples the machine camera and pickup motion, never a separate flight.
 * No RAF runs while ready, backgrounded, reduced-motion, completed or unmounted.
 */
export function GachaCapsule3D({
  progress,
  dispenseProgress,
  cameraProgress,
  viewportSize,
  active,
  reduceMotion,
  tone,
  onReady,
  onUnavailable,
}: GachaCapsule3DProps) {
  const mounted = useRef(true);
  const rendererRef = useRef<CapsuleGLResources | null>(null);
  const frameHandle = useRef<number | null>(null);
  const generation = useRef(0);
  const contextGeneration = useRef(0);
  const lastFrameTime = useRef(-1);
  const foreground = useRef(AppState.currentState === "active");
  const options = useRef({ cameraProgress, viewportSize, reduceMotion, tone, onReady, onUnavailable });
  options.current = { cameraProgress, viewportSize, reduceMotion, tone, onReady, onUnavailable };
  const logicalWidth = PIXEL_RENDER_WIDTH / PixelRatio.get();
  const logicalHeight = Math.round(PIXEL_RENDER_WIDTH * viewportSize.height / Math.max(1, viewportSize.width)) / PixelRatio.get();

  const publishCameraProgress = useCallback((submittedProgress: number) => {
    const output = options.current.cameraProgress;
    if (output) output.value = submittedProgress;
  }, []);

  const stopRendering = useCallback(() => {
    generation.current += 1;
    if (frameHandle.current !== null) cancelAnimationFrame(frameHandle.current);
    frameHandle.current = null;
    lastFrameTime.current = -1;
  }, []);

  const setRenderingActive = useCallback((enabled: boolean) => {
    stopRendering();
    if (!enabled || !mounted.current || !rendererRef.current || !foreground.current || options.current.reduceMotion) return;
    const run = generation.current;
    const render = (timestamp: number) => {
      if (run !== generation.current || !mounted.current) return;
      const renderer = rendererRef.current;
      if (!renderer || !foreground.current || options.current.reduceMotion || active.value <= 0) {
        stopRendering();
        return;
      }
      if (lastFrameTime.current >= 0 && timestamp - lastFrameTime.current < FRAME_INTERVAL_MS - 1) {
        frameHandle.current = requestAnimationFrame(render);
        return;
      }
      lastFrameTime.current = timestamp;
      // Read native progress exactly once for the entire rendered frame.
      const currentProgress = Math.max(0, Math.min(1, progress.value));
      const currentDispense = Math.max(0, Math.min(1, dispenseProgress.value));
      try {
        drawFrame(renderer, {
          progress: currentProgress,
          dispenseProgress: currentDispense,
          ivory: options.current.tone === "ivory" ? 1 : 0,
          viewWidth: options.current.viewportSize.width,
          viewHeight: options.current.viewportSize.height,
        });
        // Match the native machine/sprite to this submitted projection, not to
        // a newer UI-clock sample between our bounded GL frames.
        publishCameraProgress(currentProgress);
      } catch (error) {
        stopRendering();
        publishCameraProgress(-1);
        disposeRenderer(renderer);
        rendererRef.current = null;
        options.current.onUnavailable?.(String(error));
        return;
      }
      if (currentProgress >= 1) {
        stopRendering();
        return;
      }
      frameHandle.current = requestAnimationFrame(render);
    };
    frameHandle.current = requestAnimationFrame(render);
  }, [active, dispenseProgress, progress, publishCameraProgress, stopRendering]);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      setRenderingActive(foreground.current && active.value > 0 && progress.value < 1);
    });
    return () => {
      mounted.current = false;
      contextGeneration.current += 1;
      subscription.remove();
      stopRendering();
      publishCameraProgress(-1);
      disposeRenderer(rendererRef.current);
      rendererRef.current = null;
    };
  }, [active, progress, publishCameraProgress, setRenderingActive, stopRendering]);

  useEffect(() => {
    if (reduceMotion) {
      stopRendering();
      publishCameraProgress(-1);
    }
  }, [publishCameraProgress, reduceMotion, stopRendering]);

  useAnimatedReaction(
    () => active.value > 0,
    (isActive, wasActive) => {
      if (isActive !== wasActive) scheduleOnRN(setRenderingActive, isActive);
    },
    [setRenderingActive],
  );

  const handleContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    if (!mounted.current) return;
    const contextRun = ++contextGeneration.current;
    stopRendering();
    publishCameraProgress(-1);
    disposeRenderer(rendererRef.current);
    rendererRef.current = null;
    try {
      const wordmark = await Asset.fromModule(WORDMARK_ASSET).downloadAsync();
      if (!mounted.current || contextGeneration.current !== contextRun) return;
      if (!wordmark.localUri) throw new Error("Capsule wordmark file unavailable");
      const renderer = createRenderer(gl, wordmark.localUri);
      rendererRef.current = renderer;
      const initialProgress = Math.max(0, Math.min(1, progress.value));
      drawFrame(renderer, {
        progress: initialProgress,
        dispenseProgress: Math.max(0, Math.min(1, dispenseProgress.value)),
        ivory: options.current.tone === "ivory" ? 1 : 0,
        viewWidth: options.current.viewportSize.width,
        viewHeight: options.current.viewportSize.height,
      });
      publishCameraProgress(options.current.reduceMotion ? -1 : initialProgress);
      options.current.onReady?.();
      if (active.value > 0) setRenderingActive(true);
    } catch (error) {
      if (!mounted.current || contextGeneration.current !== contextRun) return;
      publishCameraProgress(-1);
      disposeRenderer(rendererRef.current);
      rendererRef.current = null;
      options.current.onUnavailable?.(String(error));
    }
  }, [active, dispenseProgress, progress, publishCameraProgress, setRenderingActive, stopRendering]);

  return (
    <View pointerEvents="none" collapsable={false} style={StyleSheet.absoluteFill}>
      <GLView
        testID="gacha-capsule-3d"
        collapsable={false}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        msaaSamples={0}
        onContextCreate={handleContextCreate}
        style={{
          position: "absolute", left: "50%", top: "50%",
          width: logicalWidth, height: logicalHeight,
          marginLeft: -logicalWidth / 2, marginTop: -logicalHeight / 2,
          transform: [{ scale: Math.max(1, viewportSize.width) / logicalWidth }],
        }}
      />
    </View>
  );
}
