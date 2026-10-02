import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve("expo"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli"));
export const certificate = cliRequire("@expo/code-signing-certificates");
const certificateRequire = createRequire(cliRequire.resolve("@expo/code-signing-certificates"));
export const forge = cliRequire("node-forge");

// Upstream PR1152 commit ceba34402e329f0365134f23fe19898756527d65 backport
// plus local empty-NULL-content hardening. Not an official patched npm release.
const expectedRsaHash = "be6ff389fe96f09c2da9ed28c949990890a5b4db5f39d6b14c414d88f594d8a3";
const expectedPatchHash = "40ee2ae4402de9b3dcd64a51c315f59d4ced2a35f96f46ccba5e8719bf61ebfc";

export function verifyForgePatch() {
  const cliPath = realpathSync(cliRequire.resolve("node-forge"));
  assert.equal(realpathSync(certificateRequire.resolve("node-forge")), cliPath,
    "Expo CLI and its signing helper must resolve the same patched package");
  const forgeRequire = createRequire(cliPath);
  assert.equal(forgeRequire("node-forge/package.json").version, "1.4.0",
    "Never relabel the original npm version to evade advisory checks");
  const rsa = readFileSync(forgeRequire.resolve("node-forge/lib/rsa.js"));
  assert.equal(createHash("sha256").update(rsa).digest("hex"), expectedRsaHash);
  const patch = readFileSync(new URL("../patches/node-forge@1.4.0.patch", import.meta.url));
  assert.equal(createHash("sha256").update(patch).digest("hex"), expectedPatchHash);
  const lock = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  const references = [...lock.matchAll(/^\s+node-forge: (.+)$/gm)].map((match) => match[1]);
  assert.equal(references.length, 2, "Review new forge callers before updating this gate");
  for (const reference of references) {
    assert.equal(reference, `1.4.0(patch_hash=${expectedPatchHash})`);
  }
  return { packageVersion: "1.4.0", rsaSha256: expectedRsaHash, callerCount: references.length };
}

// Synthetic signed encodings exercise the parser, not a real credential or an
// end-to-end attacker forgery. Private keys are generated in memory only.
export function digestInfoSignature(implementation, keyPair, { includeNull = true, nullContents = "",
  nestedGarbage = false, outerGarbage = false, trailingGarbage = false } = {}) {
  const a = implementation.asn1;
  const node = (type, constructed, value) => a.create(a.Class.UNIVERSAL, type, constructed, value);
  const digest = implementation.md.sha256.create().update("DABBOBA synthetic security regression").digest().getBytes();
  const algorithm = [node(a.Type.OID, false, a.oidToDer(implementation.oids.sha256).getBytes())];
  if (includeNull) algorithm.push(node(a.Type.NULL, false, nullContents));
  if (nestedGarbage) algorithm.push(node(a.Type.OCTETSTRING, false, "unconsumed nested input"));
  const content = [node(a.Type.SEQUENCE, true, algorithm), node(a.Type.OCTETSTRING, false, digest)];
  if (outerGarbage) content.push(node(a.Type.OCTETSTRING, false, "unconsumed outer input"));
  let encoded = a.toDer(node(a.Type.SEQUENCE, true, content)).getBytes();
  if (trailingGarbage) encoded += "unconsumed trailing input";
  return { digest, signature: keyPair.privateKey.sign(encoded, "NONE") };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  console.log(JSON.stringify(verifyForgePatch()));
}
