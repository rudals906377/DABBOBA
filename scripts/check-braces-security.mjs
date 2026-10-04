import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// GHSA-vfj7-8cjw-p6xm has no official patched npm release. These local limits
// reject >64 combined brace/paren blocks and excessive or cyclic custom ASTs.
// Never change the package version or waive the version-based audit gate.
export const localDepthLimit = 64;
const expectedPatchHash = "8d7c743ad2ebbc9f600664cd8a84e92fc43e44dbae35409f1de3e77ea46e1690";
const expectedSourceHashes = {
  "index.js": "e6edd7a92e328d5b77a72c3f6f558ec701f84c67a92f2445459a8d4b325306aa",
  "lib/compile.js": "c102bcde1da6daab8626bb8e7ecaafdb5ab83b64da64e95868ba4b18afb4712c",
  "lib/constants.js": "1f4f238d13a940d51b03aa596efd18ef69b30e1bef2f1227d3122b25c9704919",
  "lib/expand.js": "06ba6a16c1ce5373dd6de3bd0ab3996ec1e532496d1ba3e19757416a52b9a0e2",
  "lib/parse.js": "1aaace3abd8a66247aef790606abf06772401ea326da132d38e76f692a2cef6b",
  "lib/stringify.js": "cdd378caf17ad84901275ac1cf32aac2b534d343107199c8820c58a924e781e8",
  "lib/utils.js": "e1c45f830f1623c3d6323c524b7f472736ebe74c2be0e32b23f26777329e1337",
};

// A supplied path is for owned disposable test copies only. The executable
// gate always resolves the actual installed micromatch caller below.
export function loadBracesModules(micromatchEntry = fileURLToPath(
  new URL("../node_modules/.pnpm/node_modules/micromatch/index.js", import.meta.url),
)) {
  // Resolve the package's real directory first: pnpm's aggregate symlink
  // directory is not the caller's actual dependency-resolution boundary.
  const callerRequire = createRequire(realpathSync(micromatchEntry));
  const bracesPath = realpathSync(callerRequire.resolve("braces"));
  return {
    braces: callerRequire("braces"),
    micromatch: callerRequire(micromatchEntry),
    bracesPath,
    bracesRequire: createRequire(bracesPath),
  };
}

export function verifyBracesPatch() {
  const { bracesPath, bracesRequire } = loadBracesModules();
  assert.equal(bracesRequire("./package.json").version, "3.0.3",
    "Never relabel the npm version to evade advisory checks");
  for (const [file, expected] of Object.entries(expectedSourceHashes)) {
    assert.equal(createHash("sha256").update(readFileSync(bracesRequire.resolve(`./${file}`))).digest("hex"),
      expected, `Installed braces ${file} must match the reviewed local mitigation`);
  }
  const patch = readFileSync(new URL("../patches/braces@3.0.3.patch", import.meta.url));
  assert.equal(createHash("sha256").update(patch).digest("hex"), expectedPatchHash);
  const lock = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  const references = [...lock.matchAll(/^\s+braces: (.+)$/gm)].map((match) => match[1]);
  assert.equal(references.length, 1, "Review new braces callers before updating this gate");
  for (const reference of references) assert.equal(reference, `3.0.3(patch_hash=${expectedPatchHash})`);

  const store = new URL("../node_modules/.pnpm/", import.meta.url);
  const callers = readdirSync(store).filter((name) => name.startsWith("micromatch@"));
  assert.equal(callers.length, 1, "Review new installed micromatch versions before updating this gate");
  for (const caller of callers) {
    const callerRequire = createRequire(new URL(`${caller}/node_modules/micromatch/index.js`, store));
    assert.equal(realpathSync(callerRequire.resolve("braces")), bracesPath);
  }
  return { packageVersion: "3.0.3", localDepthLimit, patchSha256: expectedPatchHash,
    sourceHashes: expectedSourceHashes, callerCount: callers.length, officialAuditWaived: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  console.log(JSON.stringify(verifyBracesPatch()));
}
