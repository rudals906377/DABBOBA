#!/usr/bin/env node
import { copyFileSync, cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storefrontSource = path.join(root, "apps", "storefront", "dist");
const legalSource = path.join(root, "public", "legal");
const workerSource = path.join(root, "worker", "index.js");
const output = path.join(root, "dist", "public-site");

for (const file of [
  path.join(storefrontSource, "index.html"),
  path.join(legalSource, "index.html"),
  workerSource,
]) {
  if (!existsSync(file)) throw new Error(`Missing public site build input: ${file}`);
}

rmSync(output, { recursive: true, force: true });
cpSync(storefrontSource, output, { recursive: true });
cpSync(legalSource, path.join(output, "legal"), { recursive: true });
copyFileSync(workerSource, path.join(output, "_worker.js"));

console.log("Prepared storefront and policy Pages build: dist/public-site");
