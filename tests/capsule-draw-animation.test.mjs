import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prototypeSource = readFileSync(path.join(root, "src/Prototype.tsx"), "utf8");
const prototypeStyles = readFileSync(path.join(root, "src/prototype.css"), "utf8");

test("gacha alone mounts the capsule draw sequence", () => {
  assert.match(prototypeSource, /function CapsuleDrawAnimation\(/);
  assert.match(
    prototypeSource,
    /product\.categoryId === "gacha" \? \([\s\S]*?<CapsuleDrawAnimation state=\{drawState\} controlProgress=\{drawControlProgress\} \/>[\s\S]*?\) : \([\s\S]*?arcade-cabinet/,
  );
  assert.match(prototypeSource, /product\.categoryId === "gacha"[\s\S]*?reducedMotion \? 420 : 3_350/);
  assert.match(prototypeSource, /:\s*1_250/);
  assert.match(prototypeSource, /src="\/assets\/dabboba\/capsule-machine-front-pixel\.png"/);
  assert.match(prototypeSource, /src="\/assets\/dabboba\/capsule-crank-plate-pixel\.png"/);
  assert.match(prototypeSource, /src="\/assets\/dabboba\/capsule-crank-pixel\.png"/);
  assert.match(prototypeSource, /src="\/assets\/dabboba\/video\/dabboba-capsule-lower-chute\.mp4"/);
});

test("capsule choreography is deterministic and finite", () => {
  assert.match(prototypeSource, /const CAPSULE_CINEMATIC_SCRUB_END = 0\.7/);
  const animationSource = prototypeSource.slice(
    prototypeSource.indexOf("function CapsuleDrawAnimation"),
    prototypeSource.indexOf("function DrawPage"),
  );
  assert.doesNotMatch(animationSource, /Math\.random\(\)/);
  assert.match(animationSource, /const crankAngle = controlProgress \* 360/);
  assert.match(animationSource, /"--crank-drag-angle": `\$\{crankAngle\}deg`/);
  assert.match(animationSource, /if \(reducedMotion\)[\s\S]*?video\.pause\(\)/);
  assert.match(animationSource, /video\.currentTime = CAPSULE_CINEMATIC_SCRUB_END/);
  assert.match(prototypeStyles, /\.capsule-ready-machine > \.capsule-ready-crank-plate \{[\s\S]*?transform: translate\(-50%, -50%\);/);
  assert.match(prototypeStyles, /\.capsule-ready-machine > \.capsule-ready-crank-handle \{[\s\S]*?rotate\(var\(--crank-drag-angle\)\)/);
  assert.match(prototypeStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(animationSource, /Date\.now/);
});
