import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const coveredRoutes = [
  ["admin.ts", "post", "/v1/admin/users/:userId/status"],
  ["admin.ts", "post", "/v1/admin/administrators"],
  ["admin.ts", "patch", "/v1/admin/administrators/:userId"],
  ["catalog.ts", "post", "/v1/admin/ips"],
  ["catalog.ts", "patch", "/v1/admin/ips/:ipId"],
  ["catalog.ts", "post", "/v1/admin/characters"],
  ["catalog.ts", "patch", "/v1/admin/characters/:characterId"],
  ["catalog.ts", "post", "/v1/admin/products"],
  ["catalog.ts", "patch", "/v1/admin/products/:productId"],
  ["catalog.ts", "post", "/v1/admin/catalog-requests/:requestId/decision"],
  ["commerce.ts", "post", "/v1/admin/products/:productId/draw-versions"],
  ["commerce.ts", "post", "/v1/admin/products/:productId/draw-versions/:versionId/publish"],
  ["community.ts", "post", "/v1/admin/notices"],
  ["community.ts", "patch", "/v1/admin/notices/:noticeId"],
  ["community.ts", "post", "/v1/admin/notices/:noticeId/visibility"],
  ["community.ts", "delete", "/v1/admin/notices/:noticeId"],
  ["community.ts", "post", "/v1/admin/notices/:noticeId/restore"],
  ["community.ts", "post", "/v1/admin/posts/:postId/status"],
  ["community.ts", "post", "/v1/admin/comments/:commentId/status"],
  ["community.ts", "post", "/v1/admin/reports/:reportId/review"],
  ["community.ts", "post", "/v1/admin/reports/:reportId/resolution"],
] as const;

test("admin mutation fingerprint binds method, path, target, body, and audit reason", async () => {
  const source = await readFile(new URL("../../src/lib/admin-idempotency.ts", import.meta.url), "utf8");
  assert.match(source, /scope: "ADMIN_MUTATION"/);
  for (const field of ["method", "path", "target", "body", "reason"]) {
    assert.match(source, new RegExp(`\\b${field}[,:]`), `missing fingerprint field ${field}`);
  }
  assert.match(source, /beginIdempotency/);
  assert.match(source, /completeIdempotency/);
  assert.match(source, /x-idempotent-replay/);
  assert.match(source, /statusCode === 204/);
});

test("every audited legacy admin mutation is wrapped by the durable ledger", async () => {
  const files = new Map<string, string>();
  for (const [file] of coveredRoutes) {
    if (!files.has(file)) {
      files.set(file, await readFile(new URL(`../../src/modules/${file}`, import.meta.url), "utf8"));
    }
  }

  for (const [file, method, path] of coveredRoutes) {
    const source = files.get(file)!;
    const marker = `app.${method}("${path}"`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `missing route ${method.toUpperCase()} ${path}`);
    const next = source.indexOf("\n  app.", start + marker.length);
    const block = source.slice(start, next === -1 ? source.length : next);
    assert.match(block, /adminIdempotentMutation\(/, `missing ledger wrapper for ${method.toUpperCase()} ${path}`);
    assert.match(block, /sendAdminMutation\(/, `missing replay sender for ${method.toUpperCase()} ${path}`);
  }
});
