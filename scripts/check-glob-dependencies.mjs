import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const watcherPackages = Object.freeze([
  { name: "@expo/metro-file-map", version: "57.0.3", relativeFile: "build/watchers/common.js",
    patchFile: "@expo__metro-file-map@57.0.3.patch",
    patchSha256: "9bd9bf7c25c8c01c37abe38098815cac14b2b7a4e5a90a9437ee8121d444fb38",
    sourceSha256: "31f7463908e9c918ea47aa51a1a6c4464aabbebeaaf53931f0aaed877a3fa679" },
  { name: "metro-file-map", version: "0.84.5", relativeFile: "src/watchers/common.js",
    patchFile: "metro-file-map@0.84.5.patch",
    patchSha256: "a0c48d06f5d42d6416befd6c125586fba83857a01934950cdfe6ef0dcc071735",
    sourceSha256: "bc77f9d1e0a802eb2f5764a3fabd4f9dcf0ed0e5f1dcd69a673eae5925337ed5",
    flowSourceSha256: "f4ef6c32a2e0a383ecd25b4c60a0535f70007a9a4fcc4535f2ba5982ca673f8a" },
  { name: "metro-file-map", version: "0.84.6", relativeFile: "src/watchers/common.js",
    patchFile: "metro-file-map@0.84.6.patch",
    patchSha256: "a0c48d06f5d42d6416befd6c125586fba83857a01934950cdfe6ef0dcc071735",
    sourceSha256: "bc77f9d1e0a802eb2f5764a3fabd4f9dcf0ed0e5f1dcd69a673eae5925337ed5",
    flowSourceSha256: "f4ef6c32a2e0a383ecd25b4c60a0535f70007a9a4fcc4535f2ba5982ca673f8a" },
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// These are genuine, installed source patches, not advisory exemptions. Every
// caller previously used only micromatch.some, which itself calls Picomatch.
// Keep that exact matcher version and fail if another dependency reintroduces
// Micromatch/Braces or an unreviewed watcher version enters the graph.
export function loadWatcherModules(rootDir = repositoryRoot) {
  const appRequire = createRequire(path.join(rootDir, "apps/mobile/package.json"));
  const expoRequire = createRequire(appRequire.resolve("expo/package.json"));
  const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
  const expoConfigRequire = createRequire(expoRequire.resolve("@expo/metro-config/package.json"));
  const expoMetroRequire = createRequire(expoConfigRequire.resolve("@expo/metro/package.json"));
  const nativeRequire = createRequire(appRequire.resolve("react-native/package.json"));
  const nativeConfigRequire = createRequire(nativeRequire.resolve("@react-native/metro-config/package.json"));
  const metroConfigRequire = createRequire(nativeConfigRequire.resolve("metro-config/package.json"));
  const nativeMetroRequire = createRequire(metroConfigRequire.resolve("metro/package.json"));
  const parents = [cliRequire, expoMetroRequire, nativeMetroRequire];
  return watcherPackages.map((spec, index) => {
    const manifest = parents[index].resolve(`${spec.name}/package.json`);
    assert.equal(parents[index](`${spec.name}/package.json`).version, spec.version);
    const packageRoot = path.dirname(realpathSync(manifest));
    const entry = realpathSync(path.join(packageRoot, spec.relativeFile));
    const callerRequire = createRequire(entry);
    return { ...spec, packageRoot, entry, callerRequire, common: callerRequire(entry) };
  });
}

export function verifyGlobDependencies(rootDir = repositoryRoot) {
  const lock = readFileSync(path.join(rootDir, "pnpm-lock.yaml"), "utf8");
  assert.equal(/^\s*(?:['"]?(?:braces|micromatch)@|(?:braces|micromatch):)/m.test(lock), false,
    "Braces and Micromatch must be absent from the entire resolved graph");
  const snapshots = lock.slice(lock.indexOf("\nsnapshots:\n"));
  assert.equal([...snapshots.matchAll(/^  ['"]?(?:@expo\/metro-file-map|metro-file-map)@[^\n]+:$/gm)].length,
    watcherPackages.length, "Review every watcher version in the entire resolved graph");
  const modules = loadWatcherModules(rootDir);
  for (const { name, version, entry, callerRequire, patchFile, patchSha256, sourceSha256, flowSourceSha256 } of modules) {
    const source = readFileSync(entry, "utf8");
    assert.equal(sha256(source), sourceSha256, "Installed watcher must match the reviewed source patch");
    assert.equal(sha256(readFileSync(path.join(rootDir, "patches", patchFile))), patchSha256);
    assert.ok(lock.includes(`${name}@${version}(patch_hash=${patchSha256})`));
    assert.match(source, /require\("picomatch"\)/);
    assert.doesNotMatch(source, /require\(["'](?:micromatch|braces)["']\)/);
    assert.equal(callerRequire("picomatch/package.json").version, "2.3.2",
      "Preserve the exact matcher version previously used by micromatch.some");
    for (const removed of ["micromatch", "braces"]) {
      assert.throws(() => callerRequire.resolve(removed), { code: "MODULE_NOT_FOUND" },
        `${name}@${version} must not resolve the removed dependency`);
    }
    if (name === "metro-file-map") {
      const flow = readFileSync(`${entry}.flow`, "utf8");
      assert.equal(sha256(flow), flowSourceSha256,
        "Installed Flow source must match the reviewed source patch");
      assert.match(flow, /import picomatch from 'picomatch'/);
      assert.doesNotMatch(flow, /import micromatch from 'micromatch'/);
    }
  }
  return { watcherCount: modules.length, picomatchVersion: "2.3.2", removedDependencies: ["micromatch", "braces"],
    officialAuditWaived: false, callers: modules.map(({ name, version, entry }) => ({ name, version,
      sourceSha256: createHash("sha256").update(readFileSync(entry)).digest("hex") })) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  console.log(JSON.stringify(verifyGlobDependencies()));
}
