import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createCloudflareAccessGate,
  createCloudflareAccessVerifier,
  readCloudflareAccessConfig,
} from "../lib/cloudflare-access.ts";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEAM = "dabboba.cloudflareaccess.com";
const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
const ENV = { ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEAM, ADMIN_CLOUDFLARE_ACCESS_AUD: AUD };
const NOW_MS = Date.UTC(2026, 9, 6, 12, 0, 0);
const NOW = Math.floor(NOW_MS / 1_000);

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function signingKey(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kid, kty: "RSA", alg: "RS256", use: "sig", n: jwk.n, e: jwk.e } };
}

async function token(key, claims = {}, header = {}) {
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT", ...header }));
  const encodedPayload = base64Url(JSON.stringify({
    aud: [AUD],
    email: "operator@dabboba.net",
    sub: "7335d417-61da-459d-899c-0a01c76a2f94",
    iss: `https://${TEAM}`,
    type: "app",
    iat: NOW - 60,
    nbf: NOW - 60,
    exp: NOW + 3_600,
    ...claims,
  }));
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key.privateKey,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  return `${encodedHeader}.${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
}

function keyServer(...keys) {
  const server = { calls: 0, keys, fail: false };
  server.fetchKeys = async (url) => {
    server.calls += 1;
    assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
    if (server.fail) throw new Error("network down");
    return { keys: server.keys.map((key) => key.jwk) };
  };
  return server;
}

test("Access configuration is all-or-nothing and only accepts a team domain and audience tag", () => {
  assert.equal(readCloudflareAccessConfig({}), null);
  assert.equal(readCloudflareAccessConfig({ ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN: " ", ADMIN_CLOUDFLARE_ACCESS_AUD: "" }), null);
  assert.deepEqual(readCloudflareAccessConfig({
    ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN: " DabBoba.CloudflareAccess.com ",
    ADMIN_CLOUDFLARE_ACCESS_AUD: AUD.toUpperCase(),
  }), {
    teamDomain: TEAM,
    audience: AUD,
    issuer: `https://${TEAM}`,
    certsUrl: `https://${TEAM}/cdn-cgi/access/certs`,
  });
  assert.throws(() => readCloudflareAccessConfig({ ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEAM }), /configured together/);
  assert.throws(() => readCloudflareAccessConfig({ ADMIN_CLOUDFLARE_ACCESS_AUD: AUD }), /configured together/);
  for (const teamDomain of ["admin.dabboba.net", "https://dabboba.cloudflareaccess.com", "dabboba.cloudflareaccess.com.evil.test"]) {
    assert.throws(() => readCloudflareAccessConfig({ ...ENV, ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN: teamDomain }), /cloudflareaccess\.com/);
  }
  assert.throws(() => readCloudflareAccessConfig({ ...ENV, ADMIN_CLOUDFLARE_ACCESS_AUD: "abc" }), /audience tag/);
});

test("a token signed by the Access application key for this audience is accepted", async () => {
  const key = await signingKey("key-1");
  const server = keyServer(key);
  const verify = createCloudflareAccessVerifier(readCloudflareAccessConfig(ENV), { fetchKeys: server.fetchKeys, now: () => NOW_MS });
  assert.deepEqual(await verify(await token(key)), {
    email: "operator@dabboba.net",
    subject: "7335d417-61da-459d-899c-0a01c76a2f94",
  });
  assert.deepEqual(await verify(await token(key, { aud: AUD, email: undefined })), {
    email: null,
    subject: "7335d417-61da-459d-899c-0a01c76a2f94",
  });
  // The key set is cached; a second token does not download it again.
  assert.equal(server.calls, 1);
});

test("tokens with the wrong issuer, audience, time, type, algorithm or signature are rejected", async () => {
  const key = await signingKey("key-1");
  const stranger = await signingKey("key-1");
  const verify = createCloudflareAccessVerifier(readCloudflareAccessConfig(ENV), { fetchKeys: keyServer(key).fetchKeys, now: () => NOW_MS });
  const rejected = [
    await token(key, { iss: "https://other.cloudflareaccess.com" }),
    await token(key, { aud: ["0".repeat(64)] }),
    await token(key, { aud: undefined }),
    await token(key, { exp: NOW - 31 }),
    await token(key, { exp: undefined }),
    await token(key, { nbf: NOW + 120 }),
    await token(key, { iat: NOW + 120 }),
    await token(key, { type: "org" }),
    await token(key, {}, { alg: "HS256" }),
    await token(key, {}, { alg: "none" }),
    await token(key, {}, { kid: undefined }),
    await token(stranger),
  ];
  for (const candidate of rejected) assert.equal(await verify(candidate), null, candidate.split(".")[1]);

  const valid = await token(key);
  const [header, payload, signature] = valid.split(".");
  const forged = base64Url(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), email: "attacker@example.test" }));
  for (const candidate of [
    undefined, null, "", "abc", `${header}.${payload}`, `${header}.${forged}.${signature}`,
    `${header}.${payload}.${signature}=`, `${header}.${payload}.${signature}.x`, "a".repeat(9_000),
  ]) {
    assert.equal(await verify(candidate), null, String(candidate).slice(0, 40));
  }
});

test("a rotated key is fetched once, and repeated unknown keys do not hammer the key endpoint", async () => {
  let now = NOW_MS;
  const oldKey = await signingKey("old");
  const newKey = await signingKey("new");
  const server = keyServer(oldKey);
  const verify = createCloudflareAccessVerifier(readCloudflareAccessConfig(ENV), { fetchKeys: server.fetchKeys, now: () => now });
  assert.ok(await verify(await token(oldKey)));
  assert.equal(server.calls, 1);

  // Within 30 seconds of the last download an unknown key is simply rejected.
  server.keys = [oldKey, newKey];
  now += 10_000;
  assert.equal(await verify(await token(newKey)), null);
  assert.equal(server.calls, 1);

  // Later, an unknown key triggers one refresh, and the rotated key verifies.
  now += 30_000;
  assert.ok(await verify(await token(newKey)));
  assert.equal(server.calls, 2);

  // After an hour the key set is refreshed even for a known key.
  now += 60 * 60 * 1_000;
  const later = Math.floor(now / 1_000);
  assert.ok(await verify(await token(newKey, { iat: later, nbf: later, exp: later + 600 })));
  assert.equal(server.calls, 3);
});

test("a failed key refresh keeps the last verified keys, but no keys at all fails closed", async () => {
  let now = NOW_MS;
  const key = await signingKey("key-1");
  const server = keyServer(key);
  const verify = createCloudflareAccessVerifier(readCloudflareAccessConfig(ENV), { fetchKeys: server.fetchKeys, now: () => now });
  assert.ok(await verify(await token(key)));
  server.fail = true;
  now += 2 * 60 * 60 * 1_000;
  assert.ok(await verify(await token(key, { iat: Math.floor(now / 1_000), nbf: undefined, exp: Math.floor(now / 1_000) + 60 })));

  const empty = keyServer(key);
  empty.fail = true;
  const closed = createCloudflareAccessVerifier(readCloudflareAccessConfig(ENV), { fetchKeys: empty.fetchKeys, now: () => NOW_MS });
  await assert.rejects(closed(await token(key)), /network down/);
  const noUsableKey = createCloudflareAccessVerifier(readCloudflareAccessConfig(ENV), {
    fetchKeys: async () => ({ keys: [{ kid: "x", kty: "EC", crv: "P-256" }] }),
    now: () => NOW_MS,
  });
  await assert.rejects(noUsableKey(await token(key)), /no usable RS256 key/);
});

test("the console gate is open without Access settings and otherwise needs a valid Access token", async () => {
  const key = await signingKey("key-1");
  const server = keyServer(key);
  const check = createCloudflareAccessGate({ fetchKeys: server.fetchKeys, now: () => NOW_MS });
  const headers = (value) => new Headers(value ? { "cf-access-jwt-assertion": value } : {});

  assert.deepEqual(await check(headers(), {}), { allowed: true, identity: null });
  assert.deepEqual(await check(headers(), ENV), { allowed: false, status: 403 });
  assert.deepEqual(await check(headers("not-a-token"), ENV), { allowed: false, status: 403 });
  assert.deepEqual(await check(headers(await token(key)), ENV), {
    allowed: true,
    identity: { email: "operator@dabboba.net", subject: "7335d417-61da-459d-899c-0a01c76a2f94" },
  });
  // Half or invalid settings close the console rather than opening it.
  assert.deepEqual(await check(headers(await token(key)), { ADMIN_CLOUDFLARE_ACCESS_AUD: AUD }), { allowed: false, status: 503 });
  assert.deepEqual(await check(headers(await token(key)), { ...ENV, ADMIN_CLOUDFLARE_ACCESS_AUD: "x" }), { allowed: false, status: 503 });

  const down = keyServer(key);
  down.fail = true;
  const closed = createCloudflareAccessGate({ fetchKeys: down.fetchKeys, now: () => NOW_MS });
  assert.deepEqual(await closed(headers(await token(key)), ENV), { allowed: false, status: 503 });
});

test("the proxy checks Access before any console response and the Worker has no bypass hostname", async () => {
  const proxy = await readFile(join(adminRoot, "proxy.ts"), "utf8");
  const gate = proxy.indexOf("await cloudflareAccess(request.headers, process.env)");
  assert.ok(gate > 0);
  assert.ok(gate < proxy.indexOf("NextResponse.next("));
  assert.match(proxy, /if \(!access\.allowed\) return accessDenied\(access\.status\)/);

  const wrangler = JSON.parse(await readFile(join(adminRoot, "wrangler.jsonc"), "utf8"));
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.deepEqual(wrangler.routes, [{ pattern: "admin.dabboba.net", custom_domain: true }]);
  // An empty placeholder would be deployed as "" and switch the gate off.
  for (const key of ["ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN", "ADMIN_CLOUDFLARE_ACCESS_AUD"]) {
    if (key in wrangler.vars) assert.ok(wrangler.vars[key].trim(), key);
  }
});
