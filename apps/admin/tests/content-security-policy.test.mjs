import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { adminContentSecurityPolicy, createCspNonce } from "../lib/content-security-policy.ts";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("console scripts are allowed by a per-request nonce, never 'unsafe-inline'", () => {
  const nonce = createCspNonce();
  assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
  assert.notEqual(createCspNonce(), nonce);
  const policy = adminContentSecurityPolicy(nonce, false);
  const scriptSrc = policy.split("; ").find((directive) => directive.startsWith("script-src "));
  assert.equal(scriptSrc, `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(adminContentSecurityPolicy(nonce, true), /'unsafe-eval'/);
});

test("proxy issues the nonce CSP on pages but skips hashed static assets", async () => {
  const proxy = await readFile(join(adminRoot, "proxy.ts"), "utf8");
  assert.match(proxy, /export async function proxy\(/);
  assert.match(proxy, /requestHeaders\.set\("content-security-policy", policy\)/);
  assert.match(proxy, /response\.headers\.set\("content-security-policy", policy\)/);
  assert.match(proxy, /_next\/static/);
  const layout = await readFile(join(adminRoot, "app/layout.tsx"), "utf8");
  assert.match(layout, /await connection\(\)/);
});

test("static assets keep immutable caching while every other response is no-store and HSTS-protected", async () => {
  const config = await readFile(join(adminRoot, "next.config.ts"), "utf8");
  assert.doesNotMatch(config, /key: "Content-Security-Policy"|script-src [^\n]*'unsafe-inline'/);
  assert.match(config, /Strict-Transport-Security", value: "max-age=63072000; includeSubDomains"/);
  assert.match(config, /source: "\/\(\(\?!_next\/static\/\)\.\*\)", headers: \[noStore\]/);
});

test("the deployed admin worker uses a __Host- session cookie", async () => {
  const wrangler = await readFile(join(adminRoot, "wrangler.jsonc"), "utf8");
  assert.match(wrangler, /"ADMIN_SESSION_COOKIE_NAME": "__Host-dabboba_admin_session"/);
});
