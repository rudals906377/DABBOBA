import { builtinModules, createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_ESBUILD_VERSION = "0.28.2";
const MAX_EDGE_ARTIFACT_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_BUNDLE_FRAGMENTS = [
  "@google-cloud/storage",
  "google-auth-library",
  "gcp-metadata",
  "gaxios",
  "ioredis",
  "sharp",
  "worker_threads",
  "node:vm",
];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputPath = join(repositoryRoot, "supabase/functions/dabboba-api/api.generated.js");
const integrationOutputPath = join(repositoryRoot, "supabase/functions/dabboba-api/api.smoke.generated.js");

function resolveEsbuildEntry() {
  const apiRequire = createRequire(join(repositoryRoot, "apps/api/package.json"));
  return apiRequire.resolve("esbuild");
}

async function loadPinnedEsbuild() {
  const esbuild = await import(pathToFileURL(resolveEsbuildEntry()).href);
  if (esbuild.version !== EXPECTED_ESBUILD_VERSION) {
    throw new Error(`Supabase API build requires esbuild ${EXPECTED_ESBUILD_VERSION}`);
  }
  return esbuild;
}

function normalizedBuiltin(path) {
  const candidate = path.startsWith("node:") ? path.slice(5) : path;
  const topLevel = candidate.split("/")[0];
  return topLevel && builtinModules.includes(topLevel) ? `node:${candidate}` : null;
}

function edgeResolutionPlugin(nativeStubPath) {
  const aliases = new Map([
    ["@dabboba/config", "packages/config/src/index.ts"],
    ["@dabboba/contracts", "packages/contracts/src/index.ts"],
    ["@dabboba/db", "packages/db/src/index.ts"],
    ["@dabboba/domain", "packages/domain/src/index.ts"],
    ["@dabboba/media-storage", "packages/media-storage/src/index.ts"],
  ]);
  return {
    name: "dabboba-api-edge-resolution",
    setup(build) {
      for (const [specifier, path] of aliases) {
        build.onResolve({ filter: new RegExp(`^${specifier.replace("/", "\\/")}$`) }, () => ({
          path: join(repositoryRoot, path),
        }));
      }
      build.onResolve({ filter: /^pg-native$/ }, () => ({ path: nativeStubPath }));
      build.onResolve({ filter: /^pino$/ }, () => ({
        path: join(repositoryRoot, "apps/api/src/lib/pino-edge-adapter.cjs"),
      }));
      build.onResolve({ filter: /^(?:node:)?[A-Za-z0-9_/-]+$/ }, (args) => {
        const builtin = normalizedBuiltin(args.path);
        return builtin ? { path: builtin, external: true } : null;
      });
    },
  };
}

function inspectBundle(metafile, code, mode) {
  const inputNames = Object.keys(metafile.inputs).map((name) => name.toLowerCase());
  if (mode === "production" && inputNames.some((name) => name.endsWith("apps/api/src/edge-smoke-entry.ts"))) {
    throw new Error("Supabase API production bundle contains the integration-only entry");
  }
  const externalImports = Object.values(metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((entry) => entry.external)
    .map((entry) => entry.path);
  for (const fragment of FORBIDDEN_BUNDLE_FRAGMENTS) {
    const inputMatch = inputNames.find((name) => name.includes(fragment));
    const externalMatch = externalImports.find((name) => name.toLowerCase() === fragment);
    if (inputMatch || externalMatch) {
      const evidence = inputMatch ? `input ${inputMatch}` : `external import ${externalMatch}`;
      throw new Error(`Supabase API bundle contains forbidden dependency: ${fragment} (${evidence})`);
    }
  }
  if (externalImports.some((path) => !path.startsWith("node:"))) {
    throw new Error("Supabase API bundle contains an unpinned external package import");
  }
  return [...new Set(externalImports)].sort();
}

export async function buildSupabaseApi(outputPath = defaultOutputPath, options = {}) {
  const mode = options.mode ?? "production";
  if (mode !== "production" && mode !== "integration") throw new Error("Unknown Supabase API build mode");
  const esbuild = await loadPinnedEsbuild();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "dabboba-api-edge-build-"));
  const temporaryOutput = join(temporaryDirectory, "api.generated.js");
  const globalsShim = join(temporaryDirectory, "node-globals.ts");
  const nativeStub = join(temporaryDirectory, "pg-native.ts");
  try {
    await writeFile(globalsShim, [
      'import { Buffer } from "node:buffer";',
      'import process from "node:process";',
      "const global = globalThis;",
      "const setImmediate = (callback, ...args) => setTimeout(callback, 0, ...args);",
      "const clearImmediate = (handle) => clearTimeout(handle);",
      "export { Buffer, clearImmediate, global, process, setImmediate };",
      "",
    ].join("\n"));
    await writeFile(nativeStub, [
      'throw new Error("Native PostgreSQL bindings are unavailable in Supabase Edge Functions");',
      "export default null;",
      "",
    ].join("\n"));

    const result = await esbuild.build({
      absWorkingDir: repositoryRoot,
      entryPoints: [join(repositoryRoot, mode === "production"
        ? "apps/api/src/edge-handler.ts"
        : "apps/api/src/edge-smoke-entry.ts")],
      outfile: temporaryOutput,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "es2022",
      minify: true,
      treeShaking: true,
      sourcemap: false,
      legalComments: "none",
      charset: "utf8",
      metafile: true,
      inject: [globalsShim],
      plugins: [edgeResolutionPlugin(nativeStub)],
      banner: { js: [
        "// Generated by scripts/build-supabase-api.mjs; do not edit.",
        'import { createRequire as __dabbobaCreateRequire } from "node:module";',
        "const require = __dabbobaCreateRequire(import.meta.url);",
      ].join("\n") },
    });

    const code = await readFile(temporaryOutput, "utf8");
    const bytes = Buffer.byteLength(code, "utf8");
    if (bytes > MAX_EDGE_ARTIFACT_BYTES) throw new Error("Supabase API bundle exceeds the hosted deployment size limit");
    const externalImports = inspectBundle(result.metafile, code, mode);
    await mkdir(dirname(outputPath), { recursive: true });
    const stagedOutput = `${outputPath}.tmp`;
    await writeFile(stagedOutput, code, { mode: 0o644 });
    await rename(stagedOutput, outputPath);
    return { bytes, outputPath, externalImports, inputCount: Object.keys(result.metafile.inputs).length };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const integration = process.argv.slice(2).includes("--integration-smoke");
  buildSupabaseApi(integration ? integrationOutputPath : defaultOutputPath, {
    mode: integration ? "integration" : "production",
  }).then((result) => {
    process.stdout.write(`${JSON.stringify({
      artifact: relative(repositoryRoot, result.outputPath),
      bytes: result.bytes,
      externalImports: result.externalImports,
      inputCount: result.inputCount,
    })}\n`);
  }).catch(() => {
    process.stderr.write("Supabase API artifact build failed.\n");
    process.exitCode = 1;
  });
}
