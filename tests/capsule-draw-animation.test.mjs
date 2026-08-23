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
    /product\.categoryId === "gacha" \? \([\s\S]*?<CapsuleDrawAnimation state=\{drawState\} \/>[\s\S]*?\) : \([\s\S]*?arcade-cabinet/,
  );
  assert.match(prototypeSource, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches \? 420 : 3_200/);
  assert.match(prototypeSource, /:\s*1_250/);
  assert.match(prototypeSource, /className="capsule-marquee"><span>DABBOBA<\/span>/);
  assert.match(prototypeSource, /className="capsule-crank"/);
  assert.match(prototypeSource, /className="capsule-outlet"/);
});

test("capsule choreography is deterministic and finite", () => {
  assert.match(prototypeSource, /const CAPSULE_LAYOUT = \[/);
  const animationSource = prototypeSource.slice(
    prototypeSource.indexOf("function CapsuleDrawAnimation"),
    prototypeSource.indexOf("function DrawPage"),
  );
  assert.doesNotMatch(animationSource, /Math\.random\(\)/);

  for (const keyframe of [
    "capsule-mix",
    "capsule-crank-turn",
    "capsule-select-drop",
    "capsule-open-left",
    "capsule-open-right",
    "capsule-card-reveal",
    "capsule-open-glow",
  ]) {
    assert.match(prototypeStyles, new RegExp(`@keyframes ${keyframe}`));
  }

  const capsuleStyles = prototypeStyles.slice(prototypeStyles.indexOf(".capsule-animation"));
  assert.doesNotMatch(capsuleStyles, /animation:[^;]*infinite/);
  assert.match(prototypeStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(prototypeStyles, /\.capsule-animation\[data-state="drawing"\][\s\S]*animation-duration: 1ms/);
  assert.doesNotMatch(capsuleStyles, /Math\.random|Date\.now/);
});
