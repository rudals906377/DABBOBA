import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectories = new Set([".next", ".turbo", "dist", "node_modules", "tests"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !generatedDirectories.has(entry.name)) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("admin source has no browser token storage or database imports", async () => {
  const files = await sourceFiles(adminRoot);
  const combined = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(combined, /localStorage|sessionStorage|@dabboba\/db|from ["'][^"']*(?:prisma|postgres)/i);
});

test("admin image policy permits only local blob previews without broadening form or script origins", async () => {
  const config = await readFile(join(adminRoot, "next.config.ts"), "utf8");
  assert.match(config, /img-src 'self' data: blob: https:/);
  assert.match(config, /form-action 'self'/);
  assert.match(config, /script-src 'self'/);
  assert.doesNotMatch(config, /connect-src[^;]*blob:/);
});

test("admin session cookie is hardened and opaque token is not returned", async () => {
  const login = await readFile(join(adminRoot, "app/api/auth/login/route.ts"), "utf8");
  assert.match(login, /httpOnly:\s*true/);
  assert.match(login, /secure:\s*true/);
  assert.match(login, /sameSite:\s*["']strict["']/);
  assert.match(login, /path:\s*["']\/["']/);
  assert.doesNotMatch(login, /NextResponse\.json\(session/);
});

test("active admin sessions renew a persistent cookie without exposing the token", async () => {
  const route = await readFile(join(adminRoot, "app/api/auth/keepalive/route.ts"), "utf8");
  const client = await readFile(join(adminRoot, "components/admin-session-keepalive.tsx"), "utf8");
  assert.match(route, /isSameOriginRequest\(request\)/);
  assert.match(route, /\/v1\/admin\/auth\/keepalive/);
  assert.match(route, /httpOnly:\s*true/);
  assert.match(route, /secure:\s*true/);
  assert.match(route, /sameSite:\s*["']strict["']/);
  assert.match(route, /error\.status === 401 \|\| error\.status === 403/);
  assert.match(route, /response\(503\)/);
  assert.doesNotMatch(route, /NextResponse\.json\([^)]*token/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /KEEPALIVE_INTERVAL_MS = 5 \* 60 \* 1_000/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
});

test("auth redirects stay relative to the browser-visible host", async () => {
  const login = await readFile(join(adminRoot, "app/api/auth/login/route.ts"), "utf8");
  const logout = await readFile(join(adminRoot, "app/api/auth/logout/route.ts"), "utf8");
  const security = await readFile(join(adminRoot, "lib/request-security.ts"), "utf8");
  assert.match(login, /internalRedirect/);
  assert.match(logout, /internalRedirect/);
  assert.match(security, /headers:\s*\{\s*location:\s*safeInternalPath\(path\)/);
  assert.doesNotMatch(`${login}\n${logout}`, /new URL\([^\n]*request\.url/);
});

test("admin login signs only the configured edge client identity before calling the API", async () => {
  const login = await readFile(join(adminRoot, "app/api/auth/login/route.ts"), "utf8");
  const security = await readFile(join(adminRoot, "lib/request-security.ts"), "utf8");
  assert.match(login, /signedAdminLoginClientHeaders\(request, config\)/);
  assert.match(login, /headers:\s*clientIdentityHeaders/);
  assert.match(security, /request\.headers\.get\(config\.adminEdgeClientIpHeader\)/);
  assert.match(security, /signAdminProxyIdentity/);
  assert.doesNotMatch(security, /headers\.get\(["']x-forwarded-for["']\)/i);
});

test("DAL is limited to admin API paths and mutation gate requires a reason", async () => {
  const api = await readFile(join(adminRoot, "lib/api.ts"), "utf8");
  const actions = await readFile(join(adminRoot, "lib/actions.ts"), "utf8");
  assert.match(api, /startsWith\(["']\/v1\/admin\/["']\)/);
  assert.match(actions, /const operationReason = reason\(form\)/);
  assert.match(actions, /requireCapability\(capability\)/);
});

test("inquiry replies do not expose a nonfunctional raw media UUID input", async () => {
  const actions = await readFile(join(adminRoot, "lib/actions.ts"), "utf8");
  const page = await readFile(join(adminRoot, "app/(admin)/inquiries/[inquiryId]/page.tsx"), "utf8");
  assert.doesNotMatch(page, /name=["']mediaIds["']/);
  assert.match(page, /운영자 답변 첨부 업로드는 아직 제공되지 않습니다/);
  assert.match(actions, /isInternal:[\s\S]{0,120}mediaIds: \[\]/);
});

test("all requested MVP navigation destinations are present", async () => {
  const navigation = await readFile(join(adminRoot, "lib/navigation.ts"), "utf8");
  for (const path of ["/users", "/administrators", "/notices", "/inquiries", "/posts", "/comments", "/reports", "/exchanges", "/commerce/orders", "/commerce/payments", "/commerce/refunds", "/commerce/inventory", "/commerce/shipping", "/catalog/ips", "/catalog/characters", "/catalog/products", "/catalog/requests", "/audit-logs"]) {
    assert.ok(navigation.includes(`href: "${path}"`), `missing navigation path ${path}`);
  }
});
