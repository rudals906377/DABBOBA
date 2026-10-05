import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prototype = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/prototype.css", import.meta.url), "utf8");

test("web Product Detail prize list classes are styled so server images stay inside the phone", () => {
  for (const name of ["detail-prize-heading", "detail-prize-grid", "detail-prize-card", "detail-probability-example"]) {
    assert.match(prototype, new RegExp(`className="${name}"`), `${name} is rendered`);
    assert.match(styles, new RegExp(`\\.${name}\\s*\\{`), `${name} has a style rule`);
  }
  // Remote prize images have arbitrary natural sizes; the card bounds them.
  assert.match(styles, /\.detail-prize-card img \{[^}]*max-width: 100%;[^}]*object-fit: contain;/);
  assert.match(styles, /\.detail-prize-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});
