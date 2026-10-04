import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadWatcherModules, verifyGlobDependencies } from "../scripts/check-glob-dependencies.mjs";

const watchers = loadWatcherModules();

// Exact upstream micromatch@4.0.8 .some loop; it uses Picomatch, not Braces.
// Retaining the old control without importing the removed package allows a
// fresh install to verify the real patched callers, not a test-only matcher.
function originalSome(picomatch, list, patterns, options) {
  let items = [].concat(list);
  for (let pattern of [].concat(patterns)) {
    let isMatch = picomatch(String(pattern), options);
    if (items.some(item => isMatch(item))) return true;
  }
  return false;
}

function originalIncludedByGlob(picomatch, type, globs, dot, relativePath) {
  if (globs.length === 0 || type !== "f") {
    return dot || originalSome(picomatch, relativePath, "**/*");
  }
  return originalSome(picomatch, relativePath, globs, { dot });
}

test("resolved graph and actual watcher imports remove Braces without waiving audit", () => {
  assert.equal(verifyGlobDependencies().watcherCount, 3);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(manifest.scripts["audit:prod"], "corepack pnpm audit --prod --audit-level high");
});

const filenames = ["index.js", "src/app.tsx", "package.json", "src/thing.test.js", ".hidden.js",
  "src/.hidden.js", ".git/config", "src/assets/icon.png", "src/화면.tsx", "a/b/c.js",
  "a/1.js", "a/3.js", "README.md", "src/a+b.js", "src/[id].tsx", "folder"];
const patterns = [[], ["**/*.js"], ["**/*.{js,jsx,ts,tsx}"], ["**/*.js", "package.json"],
  ["**/!(*.test).js"], ["src/@(app|화면).tsx"], ["!**/*.test.js"], ["no-match", "**/*.tsx"],
  ["a/{1..3}.js"], ["src/**", "!src/assets/**"], ["**/.*"], ["**/\\[id\\].tsx"],
  ["**/*", "package.json"], ["src/?pp.tsx"], ["src/[a-z]*.tsx"]];

for (const watcher of watchers) {
  const label = `${watcher.name}@${watcher.version}`;
  test(`${label} retains upstream results for every file kind, glob and dot option`, () => {
    const picomatch = watcher.callerRequire("picomatch");
    let compared = 0;
    for (const type of ["f", "d", "l", null]) {
      for (const dot of [false, true, undefined]) {
        for (const globs of patterns) {
          for (const relativePath of filenames) {
            assert.equal(watcher.common.includedByGlob(type, globs, dot, relativePath),
              originalIncludedByGlob(picomatch, type, globs, dot, relativePath),
              JSON.stringify({ type, dot, globs, relativePath }));
            compared++;
          }
        }
      }
    }
    assert.equal(compared, 2880);
  });
  test(`${label} matches and excludes explicit legitimate controls`, () => {
    const included = watcher.common.includedByGlob;
    assert.equal(included("f", ["**/*.{js,tsx}"], false, "src/화면.tsx"), true);
    assert.equal(included("f", ["**/*.js"], false, "src/icon.png"), false);
    assert.equal(included("f", [], false, ".env"), false);
    assert.equal(included("f", [], true, ".env"), true);
    assert.equal(included("d", ["never"], false, "src"), true);
    assert.equal(included("l", ["never"], false, ".hidden"), false);
    assert.equal(included("f", ["**/*.js", "package.json"], false, "package.json"), true);
    assert.equal(included("f", ["**/!(*.test).js"], false, "src/thing.test.js"), false);
  });
  test(`${label} preserves short-circuiting and upstream error behavior`, () => {
    const included = watcher.common.includedByGlob;
    assert.equal(included("f", ["**/*", ""], false, "index.js"), true);
    assert.throws(() => included("f", [""], false, "index.js"), TypeError);
    assert.throws(() => included("f", ["**/*"], false, 1), TypeError);
    assert.equal(included("f", ["**/*.js"], false, ["a.png", "b.js"]), true);
  });
  test(`${label} preserves stat classification and path matching exports`, () => {
    for (const [kind, expected] of [["link", "l"], ["directory", "d"], ["file", "f"], ["other", null]]) {
      assert.equal(watcher.common.typeFromStat({ isSymbolicLink: () => kind === "link",
        isDirectory: () => kind === "directory", isFile: () => kind === "file" }), expected);
    }
    assert.equal(watcher.common.posixPathMatchesPattern(/src\/app\.tsx$/, "src/app.tsx"), true);
    assert.equal(watcher.common.posixPathMatchesPattern(/src\/app\.tsx$/, "src/app.js"), false);
    assert.equal(watcher.common.DELETE_EVENT, "delete");
    assert.equal(watcher.common.TOUCH_EVENT, "touch");
    assert.equal(watcher.common.RECRAWL_EVENT, "recrawl");
    assert.equal(watcher.common.ALL_EVENT, "all");
  });
}
