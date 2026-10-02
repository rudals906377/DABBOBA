import assert from "node:assert/strict";
import test from "node:test";
import { certificate, digestInfoSignature, forge, verifyForgePatch } from "../scripts/check-forge-security.mjs";

const keyPair = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 3 });

test("Expo's two forge callers use the exact backport without changing the npm version", () => {
  assert.equal(verifyForgePatch().callerCount, 2);
});

for (const includeNull of [true, false]) {
  test(`valid SHA256 DigestInfo accepts optional NULL=${includeNull}`, () => {
    const { digest, signature } = digestInfoSignature(forge, keyPair, { includeNull });
    assert.equal(keyPair.publicKey.verify(digest, signature), true);
    assert.equal(keyPair.publicKey.verify("wrong digest", signature), false);
  });
  test(`extra nested DigestAlgorithm child is rejected, NULL=${includeNull}`, () => {
    const { digest, signature } = digestInfoSignature(forge, keyPair, { includeNull, nestedGarbage: true });
    assert.throws(() => keyPair.publicKey.verify(digest, signature), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
  });
}

for (const option of ["outerGarbage", "trailingGarbage"]) {
  test(`${option} stays rejected`, () => {
    const { digest, signature } = digestInfoSignature(forge, keyPair, { [option]: true });
    assert.throws(() => keyPair.publicKey.verify(digest, signature));
  });
}

for (const length of [1, 32, 100]) {
  test(`malformed ASN.1 NULL with ${length} content bytes is rejected`, () => {
    const { digest, signature } = digestInfoSignature(forge, keyPair, { nullContents: "x".repeat(length) });
    assert.throws(() => keyPair.publicKey.verify(digest, signature), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
  });
}

test("ordinary RSA signing and tamper rejection are preserved", () => {
  const digest = forge.md.sha256.create().update("synthetic manifest");
  const signature = keyPair.privateKey.sign(digest);
  assert.equal(keyPair.publicKey.verify(digest.digest().getBytes(), signature), true);
  assert.equal(keyPair.publicKey.verify("different", signature), false);
  const altered = signature.slice(0, -1) + String.fromCharCode(signature.charCodeAt(signature.length - 1) ^ 1);
  let accepted = false;
  try { accepted = keyPair.publicKey.verify(digest.digest().getBytes(), altered); } catch { /* Rejection may throw on invalid padding. */ }
  assert.equal(accepted, false);
});

for (const algorithm of ["sha384", "sha512", "md5"]) {
  test(`valid ${algorithm} signature remains accepted`, () => {
    const digest = forge.md[algorithm].create().update("synthetic compatibility input");
    assert.equal(keyPair.publicKey.verify(digest.digest().getBytes(), keyPair.privateKey.sign(digest)), true);
  });
}

test("Expo certificate PEM roundtrip, validation and manifest signing stay functional", () => {
  const pair = certificate.convertKeyPairPEMToKeyPair(certificate.convertKeyPairToPEM(keyPair));
  const cert = certificate.generateSelfSignedCodeSigningCertificate({
    keyPair: pair,
    validityNotBefore: new Date(Date.now() - 60_000),
    validityNotAfter: new Date(Date.now() + 3_600_000),
    commonName: "DABBOBA synthetic test only",
  });
  const roundtrip = certificate.convertCertificatePEMToCertificate(certificate.convertCertificateToCertificatePEM(cert));
  certificate.validateSelfSignedCertificate(roundtrip, pair);
  const payload = Buffer.from('{"synthetic":true}');
  const signed = certificate.signBufferRSASHA256AndVerify(pair.privateKey, roundtrip, payload);
  const md = forge.md.sha256.create().update(payload.toString("binary"));
  assert.equal(roundtrip.publicKey.verify(md.digest().getBytes(), forge.util.decode64(signed)), true);
  const unrelated = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  assert.throws(() => certificate.validateSelfSignedCertificate(roundtrip, unrelated), /does not match/);
  roundtrip.validity.notAfter = new Date(Date.now() - 1000);
  assert.throws(() => certificate.validateSelfSignedCertificate(roundtrip, pair), /expired/);
});

test("Expo CSR verification and development-certificate issuance remain functional", () => {
  const cert = certificate.generateSelfSignedCodeSigningCertificate({
    keyPair, validityNotBefore: new Date(Date.now() - 60_000),
    validityNotAfter: new Date(Date.now() + 3_600_000), commonName: "Synthetic issuer",
  });
  const csr = certificate.convertCSRPEMToCSR(certificate.convertCSRToCSRPEM(certificate.generateCSR(keyPair, "Synthetic subject")));
  assert.equal(csr.verify(), true);
  const issued = certificate.generateDevelopmentCertificateFromCSR(keyPair.privateKey, cert, csr,
    "00000000-0000-4000-8000-000000000001", "@synthetic/test");
  assert.equal(cert.verify(issued), true);
  csr.signature = "invalid signature";
  assert.throws(() => certificate.generateDevelopmentCertificateFromCSR(keyPair.privateKey, cert, csr,
    "00000000-0000-4000-8000-000000000001", "@synthetic/test"));
});
