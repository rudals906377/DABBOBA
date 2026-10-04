#!/usr/bin/env node

// Reads compiled string literals only. Their presence is a necessary build
// check, not proof of the active runtime configuration, signing, or login.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVED_PRODUCTION_API_HOSTS, REQUIRED_PUBLIC_BUILD_VARIABLES, isApprovedProductionApiUrl } from './check-mobile-release-config.mjs';
import { SUPABASE_INTEGRATION_PROJECT_REF } from './supabase-integration-profile.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const HERMES_MAGIC = Buffer.from('c61fbc03c103191f', 'hex');
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const nativePlatforms = new Set(['ios', 'android']);
const bundleExtensions = new Set(['.js', '.hbc', '.bundle', '.jsbundle']);
const liveVariables = ['EXPO_PUBLIC_PORTONE_STORE_ID', 'EXPO_PUBLIC_PORTONE_CHANNEL_KEY'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const issue = (code, variable) => ({ code, ...(variable ? { variable } : {}) });

function mobileDependencyRequire(rootDir) {
  const appRequire = createRequire(path.join(rootDir, 'apps/mobile/package.json'));
  const expoRequire = createRequire(appRequire.resolve('expo/package.json'));
  return createRequire(expoRequire.resolve('@expo/metro-config/package.json'));
}

export function resolveArtifactHermesCompiler(rootDir = repositoryRoot) {
  const compilerRoot = path.dirname(mobileDependencyRequire(rootDir).resolve('hermes-compiler/package.json'));
  const executable = { darwin: 'osx-bin/hermesc', linux: 'linux64-bin/hermesc', win32: 'win64-bin/hermesc.exe' }[process.platform];
  if (!executable) throw new Error('HERMES_HOST_UNSUPPORTED');
  const compiler = path.join(compilerRoot, 'hermesc', executable);
  if (!existsSync(compiler)) throw new Error('HERMES_COMPILER_MISSING');
  return compiler;
}

function validPublicKey(value) {
  if (value.startsWith('sb_publishable_')) return value.length >= 20 && !/placeholder|replace[_-]?me|your-/i.test(value);
  try {
    const segments = value.split('.');
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return segments.length === 3 && payload.role === 'anon';
  } catch {
    return false;
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && !/%2f|%5c/i.test(value);
  } catch {
    return false;
  }
}

function expectedConfig(environment) {
  const capability = environment.EXPO_PUBLIC_COMMERCE_CAPABILITY?.trim();
  const variables = [...REQUIRED_PUBLIC_BUILD_VARIABLES, ...(capability === 'LIVE' ? liveVariables : [])];
  const values = {};
  const errors = [];
  for (const variable of variables) {
    const value = typeof environment[variable] === 'string' ? environment[variable].trim() : '';
    if (!value) {
      errors.push(issue('EXPECTED_VARIABLE_MISSING', variable));
      continue;
    }
    values[variable] = value;
    if (variable.endsWith('_URL') && !safeHttpsUrl(value)) errors.push(issue('EXPECTED_URL_INVALID', variable));
  }
  if (!['PRELAUNCH', 'LIVE'].includes(capability)) errors.push(issue('EXPECTED_COMMERCE_CAPABILITY_INVALID'));
  if (values.EXPO_PUBLIC_DABBOBA_API_URL && !isApprovedProductionApiUrl(values.EXPO_PUBLIC_DABBOBA_API_URL)) {
    errors.push(issue('EXPECTED_API_HOST_NOT_APPROVED', 'EXPO_PUBLIC_DABBOBA_API_URL'));
  }
  if (values.EXPO_PUBLIC_SUPABASE_URL && values.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '') !== `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co`) {
    errors.push(issue('EXPECTED_SUPABASE_PROJECT_MISMATCH', 'EXPO_PUBLIC_SUPABASE_URL'));
  }
  if (values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY && !validPublicKey(values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    errors.push(issue('EXPECTED_PUBLIC_KEY_INVALID', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'));
  }
  return { values, errors };
}

/** Exact literal comparison; no evaluation or execution of the app bundle. */
export function inspectMobileArtifactStrings(strings, environment) {
  const { values, errors } = expectedConfig(environment);
  const literalSet = new Set(strings.filter((value) => typeof value === 'string'));
  const publicAuthKeyLiteralPresent = [...literalSet].some(validPublicKey);
  if (!publicAuthKeyLiteralPresent) errors.push(issue('PUBLIC_AUTH_KEY_LITERAL_MISSING'));
  const comparisons = Object.entries(values).map(([variable, expected]) => {
    const present = literalSet.has(expected);
    if (!present) errors.push(issue('COMPILED_VALUE_MISSING', variable));
    return { variable, expectedSha256: sha256(expected), exactLiteralPresent: present };
  });
  const expectedApi = values.EXPO_PUBLIC_DABBOBA_API_URL?.replace(/\/$/, '');
  for (const value of literalSet) {
    if (/TEST_PG|MOBILE_TEST_FIXTURE|mobile-test-account|\/v1\/demo\/(?:capabilities|session|payments)|\/draw\/preview(?:\/|$)/i.test(value)) {
      errors.push(issue('FORBIDDEN_RELEASE_MARKER'));
    }
    // The broker/SDK includes the bare prefix in its rejection logic. A
    // prefix by itself is not a bundled secret credential.
    if (value.startsWith('sb_secret_') && value.length >= 20) errors.push(issue('PRIVILEGED_KEY_LITERAL'));
    if (/^eyJ[^.]+\.[^.]+\.[^.]+$/.test(value)) {
      try {
        if (JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')).role === 'service_role') errors.push(issue('PRIVILEGED_KEY_LITERAL'));
      } catch { /* An unrelated string is not treated as a credential. */ }
    }
    if (!/^https?:\/\//i.test(value)) continue;
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      if (hostname.endsWith('.supabase.co') && hostname !== `${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co`) {
        errors.push(issue('FOREIGN_SUPABASE_PROJECT_LITERAL'));
      }
      const apiLiteral = /^api(?:-[^.]+)?\.dabboba\.net$/.test(hostname)
        || (APPROVED_PRODUCTION_API_HOSTS.includes(hostname) && url.pathname.startsWith('/functions/v1/dabboba-api'));
      if (apiLiteral && expectedApi && value.replace(/\/$/, '') !== expectedApi) errors.push(issue('STALE_OR_ALTERNATIVE_API_LITERAL'));
      // Expo libraries contain localhost defaults. Only a concrete customer
      // API route on a private host is actionable here.
      const privateHost = /^(?:localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|\[::1\])/.test(hostname)
        || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) || hostname.endsWith('.local');
      if (privateHost && /\/(?:v1|functions\/v1)\//.test(url.pathname)) errors.push(issue('LOCAL_CUSTOMER_API_LITERAL'));
    } catch { /* Source snippets and library templates are not URL literals. */ }
  }
  return { publicAuthKeyLiteralPresent, comparisons, errors: [...new Map(errors.map((item) => [`${item.code}:${item.variable ?? ''}`, item])).values()] };
}

function readBytes(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) throw new Error('BUNDLE_NOT_REGULAR_OR_TOO_LARGE');
  return readFileSync(file);
}

function readExportBundles(directory, platform) {
  const root = realpathSync(directory);
  const metadataFile = path.join(root, 'metadata.json');
  const metadataBytes = readBytes(metadataFile);
  let metadata;
  try { metadata = JSON.parse(metadataBytes.toString('utf8')); } catch { throw new Error('EXPORT_METADATA_INVALID'); }
  if (metadata.version !== 0 || metadata.bundler !== 'metro' || !metadata.fileMetadata) throw new Error('EXPORT_METADATA_UNSUPPORTED');
  const platforms = platform ? [platform] : Object.keys(metadata.fileMetadata);
  if (!platforms.length || platforms.some((value) => !nativePlatforms.has(value))) throw new Error('EXPORT_NATIVE_PLATFORM_MISSING');
  const allEntries = Object.values(metadata.fileMetadata).map((item) => item?.bundle);
  if (new Set(allEntries).size !== allEntries.length) throw new Error('EXPORT_AMBIGUOUS_NATIVE_BUNDLES');
  const bundles = platforms.map((value) => {
    const entry = metadata.fileMetadata[value]?.bundle;
    if (typeof entry !== 'string' || path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..') || !bundleExtensions.has(path.extname(entry))) {
      throw new Error('EXPORT_BUNDLE_ENTRY_INVALID');
    }
    const file = path.resolve(root, entry);
    if (!realpathSync(file).startsWith(`${root}${path.sep}`)) throw new Error('EXPORT_BUNDLE_OUTSIDE_DIRECTORY');
    return { entry, platform: value, bytes: readBytes(file) };
  });
  // Metadata must not conceal a second old native entry beside the selected
  // one. Ignore maps/assets, but fail closed on ambiguous executable bundles.
  const executableEntries = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (bundleExtensions.has(path.extname(entry.name))) executableEntries.push(path.relative(root, file));
    }
  }
  walk(root);
  const declared = new Set(Object.values(metadata.fileMetadata).map((item) => item?.bundle));
  if (executableEntries.some((entry) => !declared.has(entry))) throw new Error('EXPORT_AMBIGUOUS_NATIVE_BUNDLES');
  return { kind: 'expo-export', metadataSha256: sha256(metadataBytes), bundles };
}

function readArchiveBundles(file, platform) {
  const extension = path.extname(file).toLowerCase();
  const archivePlatform = extension === '.ipa' ? 'ios' : 'android';
  if (platform && platform !== archivePlatform) throw new Error('ARTIFACT_PLATFORM_MISMATCH');
  const listed = spawnSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
  if (listed.status !== 0) throw new Error('ARTIFACT_ARCHIVE_UNREADABLE');
  const entries = listed.stdout.split(/\r?\n/).filter(Boolean);
  const pattern = extension === '.ipa' ? /^Payload\/[^/]+\.app\/(?:.*\/)?[^/]+\.(?:jsbundle|hbc|bundle)$/
    : extension === '.aab' ? /^[^/]+\/assets\/(?:.*\/)?[^/]+\.(?:bundle|hbc|jsbundle)$/
      : /^assets\/(?:.*\/)?[^/]+\.(?:bundle|hbc|jsbundle)$/;
  const candidates = entries.filter((entry) => pattern.test(entry));
  const expectedEntry = extension === '.ipa' ? /^Payload\/[^/]+\.app\/main\.jsbundle$/
    : extension === '.aab' ? /^base\/assets\/index\.android\.bundle$/ : /^assets\/index\.android\.bundle$/;
  if (candidates.length !== 1 || !expectedEntry.test(candidates[0])) throw new Error('ARTIFACT_NATIVE_BUNDLE_MISSING_OR_AMBIGUOUS');
  const extracted = spawnSync('unzip', ['-p', file, candidates[0]], { maxBuffer: MAX_BUNDLE_BYTES, timeout: 30000 });
  if (extracted.status !== 0 || !extracted.stdout?.length) throw new Error('ARTIFACT_BUNDLE_UNREADABLE');
  return { kind: extension.slice(1), artifactSha256: sha256(readFileSync(file)), bundles: [{ entry: candidates[0], platform: archivePlatform, bytes: extracted.stdout }] };
}

function javascriptStrings(bytes, rootDir) {
  const parser = mobileDependencyRequire(rootDir)('@babel/parser');
  let ast;
  try { ast = parser.parse(bytes.toString('utf8'), { sourceType: 'unambiguous' }); } catch { throw new Error('JAVASCRIPT_BUNDLE_PARSE_FAILED'); }
  const strings = [];
  const stack = [ast.program];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'StringLiteral') strings.push(node.value);
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) strings.push(node.quasis[0].value.cooked);
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
      if (Array.isArray(value)) for (const item of value) stack.push(item);
      else if (value && typeof value === 'object') stack.push(value);
    }
  }
  return { strings, format: 'javascript-literals' };
}

async function hermesStrings(bytes, compiler) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'dabboba-artifact-hbc-'));
  try {
    const bundle = path.join(temporary, 'bundle.hbc');
    writeFileSync(bundle, bytes, { mode: 0o600 });
    const child = spawn(compiler, ['-dump-bytecode', bundle], { stdio: ['ignore', 'pipe', 'pipe'] });
    const strings = [];
    let pending = '', declaredCount = null, inTable = false, tableComplete = false, version = null, malformed = false;
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (tableComplete || malformed) return;
      pending += chunk;
      // Very large single string records are not needed for public config;
      // do not accept a truncated table as verification.
      if (pending.length > MAX_BUNDLE_BYTES) { malformed = true; child.kill(); return; }
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        const count = /^\s*String count: (\d+)$/.exec(line);
        if (count) declaredCount = Number(count[1]);
        const bytecodeVersion = /^\s*Bytecode version number: (\d+)$/.exec(line);
        if (bytecodeVersion) version = Number(bytecodeVersion[1]);
        if (line === 'Global String Table:') { inTable = true; continue; }
        if (!inTable) continue;
        const literal = /^[is]\d+\[(?:ASCII|UTF-16), [^\]]+\](?: #[\dA-Fa-f]+)?: (.*)$/.exec(line);
        if (literal) strings.push(literal[1].replace(/\\x([\dA-Fa-f]{2})|\\u([\dA-Fa-f]{4})/g, (_, byte, code) => String.fromCharCode(parseInt(byte ?? code, 16))));
        else if (strings.length && line === '') { tableComplete = true; pending = ''; break; }
        else if (line) malformed = true;
      }
    });
    // Drain diagnostic output without retaining it: it may contain literals.
    child.stderr.resume();
    const code = await new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error('HERMES_INSPECTOR_UNAVAILABLE')));
      child.once('close', resolve);
    }).finally(() => clearTimeout(timer));
    if (code !== 0 || malformed || !tableComplete || !version || strings.length !== declaredCount) throw new Error('HERMES_STRING_TABLE_UNVERIFIED');
    return { strings, format: 'hermes-string-table', bytecodeVersion: version };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function verifyMobileArtifactConfig({ artifactPath, environment = process.env, platform, rootDir = repositoryRoot, hermescPath } = {}) {
  if (typeof artifactPath !== 'string' || !artifactPath) throw new Error('ARTIFACT_PATH_REQUIRED');
  if (platform && !nativePlatforms.has(platform)) throw new Error('ARTIFACT_PLATFORM_INVALID');
  const file = path.resolve(artifactPath);
  const stat = lstatSync(file);
  let input;
  if (stat.isDirectory()) input = readExportBundles(file, platform);
  else if (stat.isFile() && ['.ipa', '.apk', '.aab'].includes(path.extname(file).toLowerCase())) input = readArchiveBundles(file, platform);
  else if (stat.isFile() && bundleExtensions.has(path.extname(file)) && platform) {
    const bytes = readBytes(file);
    input = { kind: 'native-bundle', artifactSha256: sha256(bytes), bundles: [{ entry: path.basename(file), platform, bytes }] };
  } else throw new Error('ARTIFACT_TYPE_OR_PLATFORM_UNSUPPORTED');
  const bundles = [];
  for (const bundle of input.bundles) {
    const isHermes = bundle.bytes.subarray(0, 8).equals(HERMES_MAGIC);
    if (path.extname(bundle.entry) === '.hbc' && !isHermes) throw new Error('HERMES_HEADER_INVALID');
    const parsed = isHermes
      ? await hermesStrings(bundle.bytes, hermescPath ?? resolveArtifactHermesCompiler(rootDir))
      : javascriptStrings(bundle.bytes, rootDir);
    bundles.push({ entry: bundle.entry, platform: bundle.platform, sha256: sha256(bundle.bytes), bytes: bundle.bytes.length,
      format: parsed.format, ...(parsed.bytecodeVersion ? { bytecodeVersion: parsed.bytecodeVersion } : {}),
      ...inspectMobileArtifactStrings(parsed.strings, environment) });
  }
  return {
    status: bundles.every((bundle) => bundle.errors.length === 0) ? 'pass' : 'fail',
    evidenceScope: 'Compiled string literals only; presence does not attest active runtime configuration.',
    artifactPath: file, kind: input.kind, ...(input.artifactSha256 ? { artifactSha256: input.artifactSha256 } : {}),
    ...(input.metadataSha256 ? { metadataSha256: input.metadataSha256 } : {}), bundles,
    runtimeConfigurationVerified: false, commerceCapabilityAttested: false, signingVerified: false,
    authenticationVerified: false, storeSubmissionReady: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const artifactPath = args.shift();
  const platform = args.length === 2 && args[0] === '--platform' ? args[1] : undefined;
  if (!artifactPath || (args.length && !platform)) {
    process.stderr.write('Usage: node scripts/verify-mobile-artifact-config.mjs <export-directory|artifact.ipa|artifact.apk|artifact.aab|bundle> [--platform ios|android]\n');
    process.exitCode = 1;
  } else {
    verifyMobileArtifactConfig({ artifactPath, platform }).then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === 'pass' ? 0 : 1;
    }).catch((error) => {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'ARTIFACT_CONFIG_INSPECTION_FAILED';
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    });
  }
}
