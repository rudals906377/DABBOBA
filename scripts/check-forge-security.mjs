import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const mobileRequire = createRequire(path.join(repositoryRoot, "apps/mobile/package.json"));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
export const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
export const certificate = cliRequire("@expo/code-signing-certificates");
export const certificateRequire = createRequire(cliRequire.resolve("@expo/code-signing-certificates"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export const signingPackages = Object.freeze([
  { name: "@expo/cli", version: "57.0.27", file: "build/src/run/ios/codeSigning/Security.js",
    patch: "@expo__cli@57.0.27.patch",
    patchSha256: "032beecfe97559f300201fa3b50b47e4daf0f4df7dcb00fdb4dab010d56510aa",
    sourceSha256: "cd289becbd5ca9473bfc8c41a0750ab530f9adc692365b2fcc629f5402d87203" },
  { name: "@expo/code-signing-certificates", version: "0.0.6", file: "build/main.js",
    patch: "@expo__code-signing-certificates@0.0.6.patch",
    patchSha256: "b760dd330cd643fe750c1228956cbdd7f8361e440e6e1363ca59207b08a88cef",
    sourceSha256: "b6651b4b5ec9d679e7fbdc88f5d3a229a78c306260b51e07d9a8d5e71c8c8855" },
]);

// Real graph removal: never rename Forge, waive the advisory, or accept a
// handwritten RSA verifier as an audit workaround. The audit gate is unchanged.
export function verifyForgeRemoval() {
  const lock = readFileSync(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8");
  assert.doesNotMatch(lock, /^\s*(?:['"]?node-forge@|node-forge:)/m,
    "Forge must be absent from the whole resolved graph, not just the prod filter");
  const snapshots = lock.slice(lock.indexOf("\nsnapshots:\n"));
  for (const spec of signingPackages) {
    const manifestPath = cliRequire.resolve(spec.name + "/package.json");
    const manifest = cliRequire(spec.name + "/package.json");
    assert.equal(manifest.version, spec.version);
    const source = readFileSync(path.join(path.dirname(realpathSync(manifestPath)), spec.file), "utf8");
    assert.equal(sha256(source), spec.sourceSha256, "Only the reviewed installed source is allowed");
    assert.equal(sha256(readFileSync(path.join(repositoryRoot, "patches", spec.patch))), spec.patchSha256);
    assert.ok(lock.includes(spec.name + "@" + spec.version + "(patch_hash=" + spec.patchSha256 + ")"));
    assert.equal([...snapshots.matchAll(new RegExp("^  ['\"]?" + spec.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "@[^\\n]+:$", "gm"))].length, 1);
    assert.doesNotMatch(source, /require\(["']node-forge["']\)/);
  }
  for (const caller of [mobileRequire, cliRequire, certificateRequire]) {
    assert.throws(() => caller.resolve("node-forge"), { code: "MODULE_NOT_FOUND" });
  }
  for (const dependency of ["@peculiar/asn1-schema", "@peculiar/asn1-x509", "@peculiar/asn1-csr"]) {
    assert.equal(certificateRequire(dependency + "/package.json").version, "2.10.0");
  }
  assert.equal(certificateRequire("asn1js/package.json").version, "3.0.10");
  const helperSource = readFileSync(cliRequire.resolve("@expo/code-signing-certificates"), "utf8");
  assert.match(helperSource, /require\("node:crypto"\)/);
  assert.match(helperSource, /crypto\.verify\(/);
  assert.match(helperSource, /native\.verify\(/);
  const securityRequire = createRequire(cliRequire.resolve("./build/src/run/ios/codeSigning/Security.js"));
  assert.equal(realpathSync(securityRequire.resolve("@expo/code-signing-certificates")),
    realpathSync(cliRequire.resolve("@expo/code-signing-certificates")));
  const types = readFileSync(cliRequire.resolve("@expo/code-signing-certificates").replace(/\.js$/, ".d.ts"), "utf8");
  assert.doesNotMatch(types, /(?:import|from).*["']node-forge["']/);
  return { callerCount: signingPackages.length, removedDependencies: ["node-forge"],
    verification: "Node/OpenSSL", officialAuditWaived: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  console.log(JSON.stringify(verifyForgeRemoval()));
}
