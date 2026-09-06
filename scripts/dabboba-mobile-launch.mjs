#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

export const MOBILE_ROOT = fileURLToPath(new URL('../apps/mobile', import.meta.url));
export const METRO_PORT = 8084;
export const DABBOBA_SUPABASE_URL = 'https://yxkmvgfruphgghowzvmo.supabase.co';
const SAFE_PARENT_KEYS = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'DEVELOPER_DIR']);
const PUBLIC_SETTING_KEYS = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
const FIXED_MOBILE_ENV = Object.freeze({
  NODE_ENV: 'development', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_DABBOBA_API_URL: 'http://127.0.0.1:8788',
  EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL: 'http://127.0.0.1:4174',
  RCT_METRO_PORT: String(METRO_PORT), REACT_NATIVE_PACKAGER_HOSTNAME: '127.0.0.1',
  EXPO_PACKAGER_PROXY_URL: '', BROWSER: 'none',
});
const ATTESTED_KEYS = [...PUBLIC_SETTING_KEYS, ...Object.keys(FIXED_MOBILE_ENV)];
const IOS_APP_ID = 'host.exp.Exponent';
const ANDROID_APP_ID = 'host.exp.exponent';
const execute = promisify(execFile);
const requireFromMobile = createRequire(path.join(MOBILE_ROOT, 'package.json'));

export function buildMobileEnvironment(parent, publicSettings) {
  if (publicSettings?.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') !== DABBOBA_SUPABASE_URL ||
      !publicSettings.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
      /\s/.test(publicSettings.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('DABBOBA mobile .env needs its own public Supabase URL and publishable key. Values were not printed.');
  }
  return {
    ...Object.fromEntries(Object.entries(parent).filter(([key]) => SAFE_PARENT_KEYS.has(key))),
    EXPO_PUBLIC_SUPABASE_URL: DABBOBA_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicSettings.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ...FIXED_MOBILE_ENV,
  };
}

export async function readMobilePublicSettings() {
  try {
    const settings = parseEnv(await readFile(path.join(MOBILE_ROOT, '.env'), 'utf8'));
    const selected = Object.fromEntries(PUBLIC_SETTING_KEYS.map(key => [key, settings[key]]));
    buildMobileEnvironment({}, selected);
    return selected;
  } catch {
    throw new Error('Cannot verify DABBOBA apps/mobile/.env public settings. No environment values were printed.');
  }
}

export function assertMetroProcessEnvironment(raw, expected) {
  // macOS ps uses whitespace-delimited KEY=value fields. Check complete tokens,
  // reject duplicates/unknown public flags, and never return or log the raw line.
  const values = new Map();
  for (const match of String(raw).matchAll(/(?:^|[\t ])([A-Za-z_][A-Za-z0-9_]*)=([^\s]*)/g)) {
    const [, key, value] = match;
    if (ATTESTED_KEYS.includes(key)) {
      if (values.has(key)) throw new Error('DABBOBA Metro configuration could not be verified.');
      values.set(key, value);
    } else if (key.startsWith('EXPO_PUBLIC_') || ['CI', 'DATABASE_URL', 'DATABASE_MIGRATION_URL', 'SESSION_TOKEN_PEPPER', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'].includes(key)) {
      throw new Error('DABBOBA Metro contains unexpected inherited configuration.');
    }
  }
  for (const key of ATTESTED_KEYS) {
    if (typeof expected?.[key] !== 'string' || /\s/.test(expected[key]) || !values.has(key) || values.get(key) !== expected[key]) {
      throw new Error('DABBOBA Metro configuration does not match this launcher. Stop its identified owner and reopen DABBOBA. Values were not printed.');
    }
  }
}

export async function readMetroProcessEnvironment(pid) {
  if (process.platform !== 'darwin' || !/^\d+$/.test(String(pid)) || Number(pid) <= 0) throw new Error('Cannot verify DABBOBA Metro process configuration on this host.');
  try {
    return (await execute('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], { timeout: 5000, maxBuffer: 1024 * 1024 })).stdout;
  } catch {
    throw new Error('Cannot inspect the selected DABBOBA Metro configuration. No process details were printed.');
  }
}

export function projectSdkVersion() {
  const version = requireFromMobile('expo/package.json').version;
  const major = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/.exec(version)?.[1];
  if (!major) throw new Error('Cannot determine the installed mobile Expo SDK version.');
  return `${major}.0.0`;
}

export function parseLaunchOptions(args) {
  const options = { platform: null, clear: false, device: null, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') continue;
    if (['--ios', '-i', '--android', '-a', '--web', '-w'].includes(arg)) {
      const platform = { '-i': 'ios', '-a': 'android', '-w': 'web' }[arg] ?? arg.slice(2);
      if (options.platform && options.platform !== platform) throw new Error('Choose one of --ios, --android or --web.');
      options.platform = platform;
    } else if (arg === '--clear' || arg === '-c') options.clear = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--device') {
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new Error('--device needs an existing Simulator name/UDID or Android emulator serial.');
      options.device = value;
    } else if (arg === '--port' || arg.startsWith('--port=')) {
      const value = arg === '--port' ? args[++index] : arg.slice(7);
      if (value !== String(METRO_PORT)) throw new Error('DABBOBA Metro is fixed at port 8084.');
    } else if (arg !== '--go' && arg !== '--localhost') {
      throw new Error(`Unsupported option: ${arg}. Run with --help for the local launcher options.`);
    }
  }
  if (options.device && !['ios', 'android'].includes(options.platform)) throw new Error('--device requires --ios or --android.');
  return options;
}

export function buildExpoCommand(cli, options, env = process.env, publicSettings) {
  return {
    command: process.execPath,
    args: ['--dns-result-order=ipv4first', cli, 'start', '--go', '--localhost', '--port', String(METRO_PORT), ...(options.clear ? ['--clear'] : []), ...(options.platform === 'web' ? ['--web'] : [])],
    options: {
      cwd: MOBILE_ROOT,
      // Pipes make Expo prompts non-interactive without CI=1, which disables Metro watching.
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: buildMobileEnvironment(env, publicSettings),
    },
  };
}

async function run(command, args, options = {}) {
  return execute(command, args, { cwd: MOBILE_ROOT, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, ...options });
}

export async function readListeners() {
  let output;
  try {
    output = (await run('lsof', ['-nP', `-iTCP:${METRO_PORT}`, '-sTCP:LISTEN', '-Fp'])).stdout;
  } catch (error) {
    if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return [];
    throw new Error(`Cannot inspect port ${METRO_PORT}: lsof failed.`, { cause: error });
  }
  const pids = [...new Set(output.split('\n').filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1))))];
  if (!pids.length) throw new Error(`Port ${METRO_PORT} ownership could not be determined.`);
  return Promise.all(pids.map(async pid => {
    try {
      const { stdout } = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
      const cwd = stdout.split('\n').find(line => line.startsWith('n'))?.slice(1);
      return { pid, cwd: cwd ? await realpath(cwd) : null };
    } catch {
      return { pid, cwd: null };
    }
  }));
}

async function readMetroStatus() {
  const response = await fetch(`http://127.0.0.1:${METRO_PORT}/status`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!response.ok) throw new Error(`Metro status HTTP ${response.status}`);
  return (await response.text()).trim();
}

export async function inspectMetro({ listeners = readListeners, status = readMetroStatus, expectedRoot = MOBILE_ROOT, environment = readMetroProcessEnvironment, expectedEnvironment } = {}) {
  const owners = await listeners();
  if (!owners.length) return { state: 'absent', owners };
  if (owners.some(owner => owner.cwd !== expectedRoot)) return { state: 'foreign', owners };
  try {
    const expected = expectedEnvironment ?? buildMobileEnvironment({}, await readMobilePublicSettings());
    for (const owner of owners) assertMetroProcessEnvironment(await environment(owner.pid), expected);
  } catch {
    return { state: 'incompatible', owners };
  }
  try {
    if ((await status()).trim() !== 'packager-status:running') return { state: 'unhealthy', owners };
  } catch {
    return { state: 'unhealthy', owners };
  }
  const current = await listeners();
  if (!current.length) return { state: 'absent', owners: [] };
  if (current.some(owner => owner.cwd !== expectedRoot || !owners.some(previous => previous.pid === owner.pid))) return { state: 'foreign', owners: current };
  return { state: 'ready', owners: current };
}

function requireUsablePort(snapshot) {
  if (snapshot.state === 'absent' || snapshot.state === 'ready') return;
  const ownerText = snapshot.owners.map(owner => `PID ${owner.pid}: ${owner.cwd ?? 'unknown working directory'}`).join(', ');
  const reason = snapshot.state === 'foreign' ? 'belongs to another or unverified process' : snapshot.state === 'incompatible' ? 'has mismatched or unverifiable mobile configuration' : 'has an unhealthy Metro process';
  throw new Error(`DABBOBA port ${METRO_PORT} ${reason} (${ownerText}). Stop the identified process in its owning terminal before retrying. No process was stopped and no fallback port was selected.`);
}

function launchUrl(platform) {
  return `${platform === 'web' ? 'http' : 'exp'}://127.0.0.1:${METRO_PORT}`;
}

export function assertLaunchUrl(value, platform) {
  const url = new URL(value);
  const expected = new URL(launchUrl(platform));
  if (url.protocol !== expected.protocol || url.hostname !== expected.hostname || url.port !== expected.port || url.username || url.password || (url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('Refusing a URL outside the DABBOBA local Metro scope.');
  }
}

async function plistValue(file, key) {
  try {
    return (await run('plutil', ['-extract', key, 'raw', '-o', '-', file])).stdout.trim();
  } catch {
    return null;
  }
}

async function directories(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(directory, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function installedIosHost(device) {
  // Inspect only this Simulator's installed application containers; shutdown devices need no boot.
  const containers = await directories(path.join(device.dataPath, 'Containers', 'Bundle', 'Application'));
  for (const container of containers) {
    for (const bundle of await directories(container)) {
      if (!bundle.endsWith('.app')) continue;
      if (await plistValue(path.join(bundle, 'Info.plist'), 'CFBundleIdentifier') !== IOS_APP_ID) continue;
      const sdkVersion = await plistValue(path.join(bundle, 'EXBuildConstants.plist'), 'TEMPORARY_SDK_VERSION');
      const hostVersion = await plistValue(path.join(bundle, 'Info.plist'), 'CFBundleShortVersionString');
      return { sdkVersion, hostVersion, bundle };
    }
  }
  return { sdkVersion: null, hostVersion: null, bundle: null };
}

export function selectIosSimulator(devices, requested = null, sdkVersion = projectSdkVersion()) {
  const candidates = devices.filter(device => device.isAvailable && (requested ? device.udid === requested || device.name === requested : /^DABBOBA(?:\s|$)/i.test(device.name)));
  const compatible = candidates.filter(device => device.sdkVersion === sdkVersion);
  if (!compatible.length) {
    const detail = candidates.filter(device => device.hostVersion).map(device => `${device.name}: Expo Go ${device.hostVersion}`).join(', ');
    throw new Error(`No dedicated DABBOBA iOS Simulator has an installed Expo Go for SDK ${sdkVersion.split('.')[0]}${requested ? ` matching "${requested}"` : ''}.${detail ? ` Found ${detail}.` : ''} Install a compatible host on a separate Simulator, then retry; this launcher never replaces Expo Go or selects another app's device automatically.`);
  }
  if (requested && compatible.length > 1) throw new Error('Several compatible Simulators share that name. Use --device with the exact UDID.');
  const rank = device => (/dabboba/i.test(device.name) ? 2 : 0) + (device.state === 'Booted' ? 1 : 0);
  return compatible.sort((left, right) => rank(right) - rank(left) || left.udid.localeCompare(right.udid))[0];
}

export async function listIosSimulators() {
  const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
  const devices = Object.entries(JSON.parse(stdout).devices).filter(([runtime]) => runtime.includes('.iOS-')).flatMap(([, items]) => items);
  const result = [];
  for (const device of devices) result.push({ ...device, ...await installedIosHost(device) });
  return result;
}

async function adbCommand() {
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (root) return path.join(root, 'platform-tools', 'adb');
  }
  return 'adb';
}

async function prepareTarget(options, sdkVersion) {
  if (!options.platform) return null;
  if (options.platform === 'web') return { platform: 'web' };
  if (options.platform === 'ios') {
    if (process.platform !== 'darwin') throw new Error('--ios requires macOS with an existing compatible Simulator.');
    return { platform: 'ios', ...selectIosSimulator(await listIosSimulators(), options.device, sdkVersion), expectedSdkVersion: sdkVersion };
  }
  const adb = await adbCommand();
  const { stdout } = await run(adb, ['devices']);
  const serials = stdout.split('\n').filter(line => /^emulator-\d+\s+device\s*$/.test(line)).map(line => line.split(/\s+/)[0]).filter(serial => !options.device || serial === options.device);
  for (const serial of serials) {
    const { stdout: info } = await run(adb, ['-s', serial, 'shell', 'dumpsys', 'package', ANDROID_APP_ID]);
    const version = info.match(/\bversionName=(\d+\.\d+\.\d+)\b/)?.[1];
    // Modern Expo Go uses a matching SDK major; older 2.x clients are intentionally not guessed.
    if (version?.split('.')[0] === sdkVersion.split('.')[0]) return { platform: 'android', adb, serial, expectedSdkVersion: sdkVersion };
  }
  throw new Error(`No connected Android emulator has Expo Go for SDK ${sdkVersion.split('.')[0]}. Start a compatible emulator first; this launcher never installs or replaces Expo Go.`);
}

export async function ensureAndroidReverse(target, executeAdb = run) {
  const { stdout } = await executeAdb(target.adb, ['-s', target.serial, 'reverse', '--list']);
  const source = `tcp:${METRO_PORT}`;
  const existing = stdout.split('\n').map(line => line.trim().split(/\s+/)).filter(fields => fields[1] === source);
  if (existing.some(fields => fields[2] !== source)) throw new Error(`Android emulator port ${METRO_PORT} already forwards to another service. Its mapping was preserved.`);
  if (!existing.length) await executeAdb(target.adb, ['-s', target.serial, 'reverse', '--no-rebind', source, source]);
}

async function openTarget(target, url) {
  if (!target) return;
  assertLaunchUrl(url, target.platform);
  if (target.platform === 'web') {
    await run(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
  } else if (target.platform === 'ios') {
    // Recheck installation immediately before opening, in case another launcher changed the host.
    if ((await installedIosHost(target)).sdkVersion !== target.expectedSdkVersion) throw new Error(`Selected Simulator Expo Go changed and no longer supports SDK ${target.expectedSdkVersion.split('.')[0]}.`);
    const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
    const current = Object.values(JSON.parse(stdout).devices).flat().find(device => device.udid === target.udid);
    if (!current) throw new Error('Selected Simulator is no longer available.');
    if (current.state !== 'Booted') await run('xcrun', ['simctl', 'boot', target.udid]);
    await run('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', target.udid]);
    await run('xcrun', ['simctl', 'bootstatus', target.udid, '-b'], { timeout: 120_000 });
    await run('xcrun', ['simctl', 'openurl', target.udid, url]);
  } else {
    const { stdout } = await run(target.adb, ['-s', target.serial, 'shell', 'dumpsys', 'package', ANDROID_APP_ID]);
    const version = stdout.match(/\bversionName=(\d+)\.\d+\.\d+\b/)?.[1];
    if (version !== target.expectedSdkVersion.split('.')[0]) throw new Error(`Selected Android emulator Expo Go no longer supports SDK ${target.expectedSdkVersion.split('.')[0]}.`);
    // Keep manifest asset URLs on the same localhost origin, scoped to this emulator and port.
    await ensureAndroidReverse(target);
    await run(target.adb, ['-s', target.serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, '-p', ANDROID_APP_ID]);
  }
}

async function waitForChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode ?? 1;
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 1)));
  });
}

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  // The detached group contains only the CLI created by this invocation and its Metro workers.
  const send = signal => {
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  send('SIGINT');
  await Promise.race([waitForChild(child), sleep(5000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    send('SIGTERM');
    await Promise.race([waitForChild(child), sleep(2000, undefined, { ref: false })]);
  }
  if (child.exitCode === null && child.signalCode === null) send('SIGKILL');
}

export async function launchMobile(options, overrides = {}) {
  const publicSettings = overrides.publicSettings ?? await readMobilePublicSettings();
  const expectedEnvironment = buildMobileEnvironment({}, publicSettings);
  const deps = { inspect: () => inspectMetro({ expectedEnvironment }), resolveCli: () => requireFromMobile.resolve('expo/bin/cli'), sdkVersion: projectSdkVersion(), prepareTarget, spawn, openTarget, stopChild, waitForChild, sleep, log: console.log, env: process.env, ...overrides };
  let snapshot = await deps.inspect();
  requireUsablePort(snapshot);
  if (snapshot.state === 'ready' && options.clear) throw new Error('Cannot apply --clear to an existing Metro. Stop that server in its owning terminal, then retry with --clear.');
  const target = await deps.prepareTarget(options, deps.sdkVersion);
  const url = launchUrl(options.platform);
  if (snapshot.state === 'ready') {
    requireUsablePort(snapshot = await deps.inspect());
    if (snapshot.state !== 'ready') throw new Error('Existing DABBOBA Metro stopped before opening. Retry the launcher.');
    await deps.openTarget(target, url);
    deps.log(`Reusing DABBOBA Metro at ${url}${target?.name ? ` on ${target.name}` : ''}.`);
    return { reused: true, url, exitCode: 0 };
  }
  // Device inspection can take time: do not trust the earlier free-port observation.
  requireUsablePort(snapshot = await deps.inspect());
  if (snapshot.state === 'ready') {
    if (options.clear) throw new Error('Another DABBOBA Metro started before --clear. Stop its owner before clearing.');
    await deps.openTarget(target, url);
    deps.log(`Reusing DABBOBA Metro at ${url}.`);
    return { reused: true, url, exitCode: 0 };
  }
  const command = buildExpoCommand(deps.resolveCli(), options, deps.env, publicSettings);
  const child = deps.spawn(command.command, command.args, command.options);
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  let childError;
  child.on('error', error => { childError = error; });
  const interrupted = new AbortController();
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  let stopping;
  const stop = () => stopping ??= deps.stopChild(child);
  const interrupt = () => { interrupted.abort(); void stop(); };
  for (const signal of signals) process.once(signal, interrupt);
  try {
    const deadline = Date.now() + 90_000;
    while (true) {
      if (interrupted.signal.aborted) throw new Error('DABBOBA launch interrupted.');
      if (childError) throw childError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Expo exited before DABBOBA Metro was ready (code ${child.exitCode}, signal ${child.signalCode}).`);
      snapshot = await deps.inspect();
      if (snapshot.state === 'foreign' || snapshot.state === 'incompatible') requireUsablePort(snapshot);
      if (snapshot.state === 'ready') break;
      if (Date.now() >= deadline) throw new Error(`DABBOBA Metro did not become healthy on port ${METRO_PORT} within 90 seconds.`);
      await deps.sleep(500);
    }
    if (interrupted.signal.aborted) throw new Error('DABBOBA launch interrupted.');
    await deps.openTarget(target, url);
    deps.log(`DABBOBA Metro ready at ${url}${target?.name ? ` on ${target.name}` : ''}. Stop this launcher to stop its Metro.`);
    return { reused: false, url, exitCode: await deps.waitForChild(child) };
  } finally {
    await stop();
    for (const signal of signals) process.removeListener(signal, interrupt);
  }
}

async function main() {
  const options = parseLaunchOptions(process.argv.slice(2));
  if (options.help) {
    console.log(`DABBOBA local Metro (fixed port 8084, installed Expo SDK ${projectSdkVersion().split('.')[0]})\nUsage: node scripts/dabboba-mobile-launch.mjs [--ios | --android | --web] [--device NAME_OR_ID] [--clear]\nAn existing healthy apps/mobile Metro is reused. Native hosts must already be installed and compatible. iOS defaults to a dedicated DABBOBA Simulator.`);
    return;
  }
  const root = await realpath(MOBILE_ROOT);
  const publicSettings = await readMobilePublicSettings();
  const expectedEnvironment = buildMobileEnvironment({}, publicSettings);
  const { exitCode } = await launchMobile(options, { publicSettings, inspect: () => inspectMetro({ expectedRoot: root, expectedEnvironment }) });
  process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`[DABBOBA] ${error.message}`); process.exitCode = 1; });
}
