import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";
import { certificate as api, certificateRequire, cliRequire, signingPackages, verifyForgeRemoval } from "../scripts/check-forge-security.mjs";

const a = certificateRequire("asn1js");
const s = certificateRequire("@peculiar/asn1-schema");
const x = certificateRequire("@peculiar/asn1-x509");
const c = certificateRequire("@peculiar/asn1-csr");
const encode = value => Buffer.from(s.AsnSerializer.serialize(value));
const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 3 });
const other = api.generateKeyPair();
const dates = { validityNotBefore: new Date(Date.now() - 60_000), validityNotAfter: new Date(Date.now() + 3_600_000) };
const cert = api.generateSelfSignedCodeSigningCertificate({ keyPair: pair, ...dates, commonName: "Synthetic issuer" });
const certPEM = api.convertCertificateToCertificatePEM(cert);
const csr = api.generateCSR(pair, "Synthetic subject");
const csrPEM = api.convertCSRToCSRPEM(csr);
const sha256RSA = "1.2.840.113549.1.1.11";
const sign = bytes => crypto.sign("sha256", bytes, { key: pair.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING });
const pem = (der, label) => "-----BEGIN " + label + "-----\n" + der.toString("base64").match(/.{1,64}/g).join("\n") + "\n-----END " + label + "-----\n";
const derFromPEM = value => Buffer.from(value.split(/-----[^-]+-----/)[1].replace(/\s/g, ""), "base64");
function certModel() { return s.AsnParser.parse(derFromPEM(certPEM), x.Certificate); }
function csrModel() { return s.AsnParser.parse(derFromPEM(csrPEM), c.CertificationRequest); }
function fromCertificateModel(model, resign = true) {
  if (resign) model.signatureValue = sign(encode(model.tbsCertificate));
  return api.convertCertificatePEMToCertificate(pem(encode(model), "CERTIFICATE"));
}
function fromRequestModel(model, resign = true) {
  if (resign) model.signature = sign(encode(model.certificationRequestInfo));
  return api.convertCSRPEMToCSR(pem(encode(model), "CERTIFICATE REQUEST"));
}
function name(attributes) {
  return new x.Name(attributes.map(([type, value]) => new x.RelativeDistinguishedName([
    new x.AttributeTypeAndValue({ type, value: new x.AttributeValue({ utf8String: value }) }),
  ])));
}

test("both pinned Expo callers genuinely remove Forge from the entire graph", () => {
  assert.equal(verifyForgeRemoval().callerCount, 2);
  assert.equal(Object.keys(api).length, 15);
});

test("all fourteen operations stay synchronous and preserve native RSA/PEM formats", () => {
  const generated = api.generateKeyPair();
  assert.equal(generated.publicKey.asymmetricKeyDetails.modulusLength, 2048);
  assert.equal(generated.publicKey.asymmetricKeyDetails.publicExponent, 65537n);
  const keyPEM = api.convertKeyPairToPEM(generated);
  assert.match(keyPEM.privateKeyPEM, /^-----BEGIN RSA PRIVATE KEY-----/);
  assert.match(keyPEM.publicKeyPEM, /^-----BEGIN PUBLIC KEY-----/);
  const imported = api.convertKeyPairPEMToKeyPair(keyPEM);
  assert.equal(imported.privateKey.type, "private");
  assert.equal(imported.publicKey.type, "public");
  for (const [key, type, method] of [[generated.privateKey, "pkcs8", "convertPrivateKeyPEMToPrivateKey"],
    [generated.publicKey, "pkcs1", "convertPublicKeyPEMToPublicKey"]]) {
    assert.equal(api[method](key.export({ type, format: "pem" })).asymmetricKeyType, "rsa");
  }
  assert.equal(api.convertCertificateToCertificatePEM(api.convertCertificatePEMToCertificate(certPEM)), certPEM);
  assert.equal(api.convertCSRToCSRPEM(api.convertCSRPEMToCSR(csrPEM)), csrPEM);
  assert.equal(cert.verify(cert), true);
  assert.equal(csr.verify(), true);
  assert.equal(api.validateSelfSignedCertificate(cert, pair), undefined);
  assert.equal(typeof api.signBufferRSASHA256AndVerify(pair.privateKey, cert, Buffer.from("manifest")), "string");
  const issued = api.generateDevelopmentCertificateFromCSR(pair.privateKey, cert, csr, "synthetic", "scope");
  assert.equal(cert.verify(issued), true);
  assert.deepEqual(issued.subject.attributes, csr.subject.attributes);
  assert.deepEqual(issued.issuer.attributes, cert.subject.attributes);
  assert.equal(issued.getExtension(api.expoProjectInformationOID).value, "synthetic,scope");
});

test("generated certificate and CSR interoperate with independent OpenSSL commands", () => {
  const certificateResult = spawnSync("openssl", ["x509", "-noout", "-subject"], { input: certPEM, encoding: "utf8" });
  assert.equal(certificateResult.status, 0, certificateResult.stderr);
  assert.match(certificateResult.stdout, /Synthetic issuer/);
  const csrResult = spawnSync("openssl", ["req", "-noout", "-verify"], { input: csrPEM, encoding: "utf8" });
  assert.equal(csrResult.status, 0, csrResult.stderr);
  assert.match(csrResult.stderr + csrResult.stdout, /verify OK|verify ok|self-signature.*OK/i);
});

for (const [label, payload] of [["empty", Buffer.alloc(0)], ["ASCII", Buffer.from("manifest")],
  ["Unicode", Buffer.from("다뽀바 öäå")], ["binary", Buffer.from([0, 255, 128, 1])],
  ["all bytes", Buffer.from(Array.from({ length: 256 }, (_, i) => i))]]) {
  test("manifest signing preserves exact bytes: " + label, () => {
    const signature = Buffer.from(api.signBufferRSASHA256AndVerify(pair.privateKey, cert, payload), "base64");
    assert.deepEqual(signature, sign(payload));
    assert.equal(crypto.verify("sha256", payload, pair.publicKey, signature), true);
    assert.equal(crypto.verify("sha256", Buffer.concat([payload, Buffer.from([1])]), pair.publicKey, signature), false);
  });
}

test("critical signing usages remain unchanged, without adding CA permission", () => {
  assert.equal(cert.getExtension("keyUsage").digitalSignature, true);
  assert.equal(cert.getExtension("keyUsage").critical, true);
  assert.equal(cert.getExtension("keyUsage").keyCertSign, false);
  assert.equal(cert.getExtension("extKeyUsage").codeSigning, true);
  assert.equal(cert.getExtension("extKeyUsage").critical, true);
  assert.equal(cert.getExtension("2.5.29.19"), null);
  assert.equal(new crypto.X509Certificate(certPEM).ca, false);
});

test("native immutable representations cannot be used to mutate signed metadata", () => {
  assert.throws(() => { cert.subject.attributes[0].value = "Changed"; }, TypeError);
  assert.throws(() => { cert.publicKey = other.publicKey; }, TypeError);
  cert.validity.notAfter.setTime(0);
  assert.ok(cert.validity.notAfter > new Date());
  api.validateSelfSignedCertificate(cert, pair);
  assert.throws(() => api.convertCertificateToCertificatePEM({ publicKey: pair.publicKey }), /Expected Expo native/);
});

for (const [label, offset] of [["expired", -120_000], ["future", 120_000]]) {
  test("validation rejects " + label + " certificates", () => {
    const notBefore = new Date(Date.now() + offset);
    const notAfter = new Date(notBefore.getTime() + 60_000);
    const invalid = api.generateSelfSignedCodeSigningCertificate({ keyPair: pair, validityNotBefore: notBefore, validityNotAfter: notAfter, commonName: "Invalid dates" });
    assert.throws(() => api.validateSelfSignedCertificate(invalid, pair), /validity expired/);
  });
}
test("invalid ordering and key mismatches fail closed", () => {
  assert.throws(() => api.generateSelfSignedCodeSigningCertificate({ keyPair: pair, validityNotBefore: dates.validityNotAfter,
    validityNotAfter: dates.validityNotBefore, commonName: "Invalid" }), /must be later/);
  assert.throws(() => api.validateSelfSignedCertificate(cert, other), /does not match/);
  assert.throws(() => api.validateSelfSignedCertificate(cert, { publicKey: pair.publicKey, privateKey: other.privateKey }), /keyPair key mismatch/);
  assert.throws(() => api.signBufferRSASHA256AndVerify(other.privateKey, cert, Buffer.from("manifest")), /not valid for certificate/);
  assert.throws(() => api.convertPrivateKeyPEMToPrivateKey("not a key"), /Invalid PEM/);
  const ec = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  assert.throws(() => api.convertPublicKeyPEMToPublicKey(ec.publicKey.export({ type: "spki", format: "pem" })), /Expected native RSA/);
});

for (const [oid, message] of [["2.5.29.15", /Digital Signature/], ["2.5.29.37", /Code Signing/]]) {
  test("validation rejects absent required extension " + oid, () => {
    const model = certModel();
    model.tbsCertificate.extensions = new x.Extensions(model.tbsCertificate.extensions.filter(ext => ext.extnID !== oid));
    assert.throws(() => api.validateSelfSignedCertificate(fromCertificateModel(model), pair), message);
  });
}
test("self-signed validation and parent verification reject issuer mismatch", () => {
  const model = certModel(); model.tbsCertificate.issuer = name([["2.5.4.3", "Different issuer"]]);
  const invalid = fromCertificateModel(model);
  assert.throws(() => api.validateSelfSignedCertificate(invalid, pair), /issuer hash/);
  assert.equal(cert.verify(invalid), false);
});
test("duplicate extensions and mismatched inner/outer algorithms are rejected", () => {
  const duplicate = certModel(); duplicate.tbsCertificate.extensions.push(duplicate.tbsCertificate.extensions[0]);
  assert.throws(() => fromCertificateModel(duplicate), /Duplicate/);
  const mismatch = certModel(); mismatch.signatureAlgorithm = new x.AlgorithmIdentifier({ algorithm: "1.2.840.113549.1.1.12", parameters: null });
  assert.throws(() => fromCertificateModel(mismatch), /algorithm mismatch/);
});
test("certificate and CSR tampering fail verification and issuance", () => {
  const certificateModel = certModel(); const signature = Buffer.from(certificateModel.signatureValue); signature[0] ^= 1; certificateModel.signatureValue = signature;
  const invalid = fromCertificateModel(certificateModel, false);
  assert.equal(invalid.verify(invalid), false);
  assert.throws(() => api.validateSelfSignedCertificate(invalid, pair), /signature not valid/);
  const requestModel = csrModel(); requestModel.certificationRequestInfo.subject = name([["2.5.4.3", "Tampered"]]);
  const invalidCSR = fromRequestModel(requestModel, false);
  assert.equal(invalidCSR.verify(), false);
  assert.throws(() => api.generateDevelopmentCertificateFromCSR(pair.privateKey, cert, invalidCSR, "test", "scope"), /CSR not self-signed/);
});

// Synthetic signatures made with our ephemeral private key characterize parser
// rejection. They are not attacker forgeries and contain no real credentials.
function malformedSignature(payload, option) {
  let oid = Buffer.from("608648016503040201", "hex");
  if (option === "unfinishedOID") oid = Buffer.concat([oid, Buffer.from([128])]);
  if (option === "nonminimalOID") oid = Buffer.concat([oid.subarray(0, 1), Buffer.from([128]), oid.subarray(1)]);
  const algorithm = [new a.Primitive({ idBlock: { tagClass: 1, tagNumber: 6 }, valueHex: oid })];
  if (option !== "absentNULL") algorithm.push(option === "nonemptyNULL"
    ? new a.Primitive({ idBlock: { tagClass: 1, tagNumber: 5 }, valueHex: Buffer.from([1]) }) : new a.Null());
  if (option === "nestedGarbage") algorithm.push(new a.OctetString({ valueHex: Buffer.from("nested") }));
  const values = [new a.Sequence({ value: algorithm }), new a.OctetString({ valueHex: crypto.createHash("sha256").update(payload).digest() })];
  if (option === "outerGarbage") values.push(new a.Null());
  let encoded = Buffer.from(new a.Sequence({ value: values }).toBER(false));
  if (option === "trailingGarbage") encoded = Buffer.concat([encoded, Buffer.from([5, 0])]);
  return crypto.privateEncrypt({ key: pair.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, encoded);
}
for (const option of ["canonical", "absentNULL", "nestedGarbage", "outerGarbage", "trailingGarbage", "nonemptyNULL", "unfinishedOID", "nonminimalOID"]) {
  for (const representation of ["certificate", "CSR"]) {
    test("native " + representation + " verifier rejects malformed DigestInfo: " + option, () => {
      const model = representation === "certificate" ? certModel() : csrModel();
      const body = representation === "certificate" ? encode(model.tbsCertificate) : Buffer.from(model.certificationRequestInfoRaw);
      if (representation === "certificate") model.signatureValue = malformedSignature(body, option);
      else model.signature = malformedSignature(body, option);
      const value = representation === "certificate" ? fromCertificateModel(model, false) : fromRequestModel(model, false);
      assert.equal(representation === "certificate" ? value.verify(value) : value.verify(), option === "canonical");
      if (representation === "CSR" && option !== "canonical") assert.throws(
        () => api.generateDevelopmentCertificateFromCSR(pair.privateKey, cert, value, "test", "scope"), /CSR not self-signed/);
    });
  }
}
// RFC 8017 A.2.4 requires NULL in EMSA-PKCS1-v1_5 DigestInfo. Native rejection
// of Forge's permissive NULL-omitted variant is intentional, not an audit bypass.

for (const representation of ["certificate", "CSR"]) {
  test(representation + " parser rejects trailing bytes, extra fields and signature unused bits", () => {
    const original = derFromPEM(representation === "certificate" ? certPEM : csrPEM);
    const label = representation === "certificate" ? "CERTIFICATE" : "CERTIFICATE REQUEST";
    const parse = representation === "certificate" ? api.convertCertificatePEMToCertificate : api.convertCSRPEMToCSR;
    assert.throws(() => parse(pem(Buffer.concat([original, Buffer.from([5, 0])]), label)), /trailing DER/);
    const root = a.fromBER(original).result;
    root.valueBlock.value.push(new a.Null());
    assert.throws(() => parse(pem(Buffer.from(root.toBER(false)), label)), /signed DER/);
    const bits = a.fromBER(original).result;
    bits.valueBlock.value[2].valueBlock.unusedBits = 1;
    assert.throws(() => parse(pem(Buffer.from(bits.toBER(false)), label)), /unused bits|signed DER/);
  });
}
test("CSR verifies original signed bytes rather than normalizing unconsumed fields", () => {
  const root = a.fromBER(derFromPEM(csrPEM)).result;
  root.valueBlock.value[0].valueBlock.value.push(new a.Null());
  assert.throws(() => api.convertCSRPEMToCSR(pem(Buffer.from(root.toBER(false)), "CERTIFICATE REQUEST")), /schema|unconsumed/i);
});

function loadModule(file, mocks) {
  const exports = {};
  const module = { exports };
  const actualRequire = createRequire(file);
  vm.runInNewContext(readFileSync(file, "utf8"), { exports, module, Buffer, process, Date,
    require: id => Object.hasOwn(mocks, id) ? mocks[id] : actualRequire(id) }, { filename: file });
  return module.exports;
}

for (const [input, expected] of [
  ["001122334455667788", "1122334455667788"],
  ["008122334455667788", "008122334455667788"],
  ["011122334455667788", "011122334455667788"],
  ["000000000000000001", "01"],
  ["000000000000000000", "01"],
  ["ff1122334455667788", "7f1122334455667788"],
]) {
  test("both certificate generators use canonical positive serials: " + input, () => {
    const native = loadModule(cliRequire.resolve("@expo/code-signing-certificates"), {
      "node:crypto": { ...crypto, randomBytes: length => { assert.equal(length, 9); return Buffer.from(input, "hex"); } },
    });
    const issuer = native.generateSelfSignedCodeSigningCertificate({ keyPair: pair, ...dates, commonName: "Serial control" });
    const request = native.generateCSR(pair, "Serial subject");
    const development = native.generateDevelopmentCertificateFromCSR(pair.privateKey, issuer, request, "test", "scope");
    for (const value of [issuer, development]) {
      assert.equal(value.serialNumber, expected);
      assert.equal(new crypto.X509Certificate(native.convertCertificateToCertificatePEM(value)).verify(pair.publicKey), true);
    }
  });
}
test("actual Expo iOS caller preserves CN/O/first OU and security command arguments", async () => {
  const model = certModel();
  model.tbsCertificate.subject = name([["2.5.4.3", "Apple Distribution: Synthetic (TEAM)"], ["2.5.4.10", "Company, Inc + Team"],
    ["2.5.4.11", "FIRST"], ["2.5.4.11", "SECOND"]]);
  model.tbsCertificate.issuer = model.tbsCertificate.subject;
  const syntheticPEM = api.convertCertificateToCertificatePEM(fromCertificateModel(model));
  const calls = [];
  const file = cliRequire.resolve("./" + signingPackages[0].file);
  const security = loadModule(file, { "@expo/spawn-async": async (...args) => { calls.push(args); return { stdout: syntheticPEM }; } });
  const result = await security.resolveCertificateSigningInfoAsync("SYNTHETIC");
  assert.equal(result.signingCertificateId, "SYNTHETIC");
  assert.equal(result.codeSigningInfo, "Apple Distribution: Synthetic (TEAM)");
  assert.equal(result.appleTeamName, "Company, Inc + Team");
  assert.equal(result.appleTeamId, "FIRST");
  assert.deepEqual(Array.from(calls[0][1]), ["find-certificate", "-c", "SYNTHETIC", "-p"]);
});

function signingCLI(offline) {
  const cache = new Map(), files = new Map(), requests = [];
  class JsonFile {
    constructor(path) { this.path = path; }
    async readAsync() { if (!cache.has(this.path)) throw new Error("missing"); return cache.get(this.path); }
    async writeAsync(value) { cache.set(this.path, value); return value; }
    async mergeAsync(value) { return this.writeAsync({ ...await this.readAsync(), ...value }); }
  }
  const state = { env: { EXPO_OFFLINE: offline } };
  const mocks = {
    "@expo/json-file": JsonFile,
    fs: { promises: { readFile: async (path, encoding) => { assert.ok(files.has(path), "No real credential reads"); return encoding ? files.get(path) : Buffer.from(files.get(path)); } } },
    "./env": state,
    "../api/user/UserSettings": { getExpoHomeDirectory: () => "/ephemeral-expo" },
    "../api/user/actions": { tryGetUserAsync: async () => ({ __typename: "User", id: "actor", primaryAccount: { id: "owner" }, accounts: [] }) },
    "../api/graphql/queries/AppQuery": { AppQuery: { byIdAsync: async () => ({ ownerAccount: { id: "owner" }, scopeKey: "@synthetic/test" }) } },
    "../api/getProjectDevelopmentCertificate": { getProjectDevelopmentCertificateAsync: async (id, requestPEM) => {
      const request = api.convertCSRPEMToCSR(requestPEM); assert.equal(request.verify(), true); requests.push(id);
      return api.convertCertificateToCertificatePEM(api.generateDevelopmentCertificateFromCSR(pair.privateKey, cert, request, id, "@synthetic/test"));
    } },
    "../api/getExpoGoIntermediateCertificate": { getExpoGoIntermediateCertificateAsync: async () => certPEM },
    "../log": { warn: () => {} },
  };
  return { api: loadModule(cliRequire.resolve("./build/src/utils/codesigning.js"), mocks), files, cache, requests, state };
}
test("actual Expo project-certificate path validates and signs a UTF-8 manifest", async () => {
  const cli = signingCLI(true);
  cli.files.set("/certificate", certPEM); cli.files.set("/private-key", api.convertKeyPairToPEM(pair).privateKeyPEM);
  const info = await cli.api.getCodeSigningInfoAsync({ updates: { codeSigningCertificate: "/certificate",
    codeSigningMetadata: { keyid: "synthetic", alg: "rsa-v1_5-sha256" } } }, 'keyid="synthetic", alg="rsa-v1_5-sha256"', "/private-key");
  const payload = '{"message":"다뽀바"}';
  assert.equal(crypto.verify("sha256", Buffer.from(payload), pair.publicKey, Buffer.from(cli.api.signManifestString(payload, info), "base64")), true);
  await assert.rejects(() => cli.api.getCodeSigningInfoAsync({ updates: { codeSigningCertificate: "/certificate",
    codeSigningMetadata: { keyid: "different", alg: "rsa-v1_5-sha256" } } }, 'keyid="synthetic"', "/private-key"), /keyid mismatch/);
  assert.equal(cli.requests.length, 0);
});
test("actual Expo authenticated development CSR flow and offline cache remain compatible", async () => {
  const cli = signingCLI(false), exp = { extra: { eas: { projectId: "synthetic-project" } } };
  const online = await cli.api.getCodeSigningInfoAsync(exp, 'keyid="expo-root"');
  assert.equal(online.keyId, "expo-go"); assert.equal(online.scopeKey, "@synthetic/test");
  assert.equal(cli.requests.length, 1);
  const payload = "Synthetic development manifest";
  const key = api.convertCertificatePEMToCertificate(online.certificateForPrivateKey).publicKey;
  assert.equal(crypto.verify("sha256", Buffer.from(payload), key, Buffer.from(cli.api.signManifestString(payload, online), "base64")), true);
  cli.state.env.EXPO_OFFLINE = true;
  const offline = await cli.api.getCodeSigningInfoAsync(exp, 'keyid="expo-root"');
  assert.equal(offline.certificateForPrivateKey, online.certificateForPrivateKey); assert.equal(cli.requests.length, 1);
  assert.equal(await cli.api.getCodeSigningInfoAsync({ extra: { eas: { projectId: "other-project" } } }, 'keyid="expo-root"'), null);
});
