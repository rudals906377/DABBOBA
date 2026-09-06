import { access } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "apps/admin/package.json",
  "apps/api/package.json",
  "apps/mobile/package.json",
  "apps/worker/package.json",
  "packages/api-client/package.json",
  "packages/config/package.json",
  "packages/contracts/package.json",
  "packages/db/package.json",
  "packages/domain/package.json",
  "packages/media-storage/package.json",
  "packages/ui/package.json",
  "ops/local/compose.yaml",
  ".nvmrc",
  "pnpm-workspace.yaml",
  "turbo.json",
];

const forbiddenPackageManagerFiles = [
  "package-lock.json",
  "yarn.lock",
  "apps/mobile/package-lock.json",
  "apps/mobile/yarn.lock",
];

const missing = [];
for (const relativePath of required) {
  try {
    await access(resolve(root, relativePath));
  } catch {
    missing.push(relativePath);
  }
}

const conflictingPackageManagerFiles = [];
for (const relativePath of forbiddenPackageManagerFiles) {
  try {
    await access(resolve(root, relativePath));
    conflictingPackageManagerFiles.push(relativePath);
  } catch {
    // The workspace intentionally has a single root pnpm-lock.yaml.
  }
}

if (missing.length > 0 || conflictingPackageManagerFiles.length > 0) {
  if (missing.length > 0) {
    console.error(`Workspace is incomplete:\n${missing.map((value) => `- ${value}`).join("\n")}`);
  }
  if (conflictingPackageManagerFiles.length > 0) {
    console.error(`Workspace must use only the root pnpm-lock.yaml:\n${conflictingPackageManagerFiles.map((value) => `- ${value}`).join("\n")}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Workspace structure OK (${required.length} required paths).`);
}
