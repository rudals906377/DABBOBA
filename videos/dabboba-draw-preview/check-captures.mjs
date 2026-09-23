// Stage each capture with its own root, as required by HyperFrames' check.
// The interactive preview and the real application's files are never changed.
import { mkdtemp, cp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));
const scene = process.argv[2] === 'kuji' ? 'kuji' : 'gacha';
const temporary = await mkdtemp(join(tmpdir(), 'dabboba-capture-check-'));
const proof = join(root, 'proof', `hyperframes-${scene}`);
let code = 1;
try {
  for (const name of ['assets','scenes','artwork.mjs','motion.mjs','capture.mjs','capture.css']) {
    await cp(join(root, name), join(temporary, name), { recursive: true });
  }
  const entry = scene === 'kuji' ? 'kuji/index' : 'index';
  await cp(join(root, `${entry}.html`), join(temporary, 'index.html'));
  await cp(join(root, `${entry}.motion.json`), join(temporary, 'index.motion.json'));
  const at = scene === 'kuji' ? '0,0.2,0.4,0.7,0.9,0.97,1.04,1.146,1.25,1.386,1.62' : '0,0.50,0.695,0.89,0.995,1.10,1.20,1.50,1.76,1.80,1.92,2.10,2.53,3.12,3.30,3.50,3.71,3.82,3.94,4.06,4.20';
  let output = '';
  code = await new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes','hyperframes@0.8.62','check',temporary,'--json','--snapshots','--at',at], { cwd: root });
    child.stdout.on('data', data => { output += data; process.stdout.write(data); });
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('error', reject); child.on('exit', value => resolve(value ?? 1));
  });
  await mkdir(proof, { recursive: true });
  await writeFile(join(proof, 'check.json'), output);
  try { await cp(join(temporary, 'snapshots'), join(proof, 'snapshots'), { recursive: true }); } catch {}
  if (process.argv.includes('--keyframes')) {
    const diagnostics = join(root, 'proof', 'diagnostics');
    await mkdir(diagnostics, { recursive: true });
    let diagnosticOutput = '';
    const diagnosticCode = await new Promise((resolve, reject) => {
      const child = spawn('npx', ['--yes', 'hyperframes@0.8.62', 'keyframes', temporary,
        '--selector', '#scene-canvas', '--json', '--ghost', '--samples', '5',
        '--from', scene === 'kuji' ? '0.9' : '1.76', '--to', scene === 'kuji' ? '1.146' : '3.30',
        '--shot', join(diagnostics, `${scene}-customer-polish-ghost.png`)], { cwd: root });
      child.stdout.on('data', data => { diagnosticOutput += data; process.stdout.write(data); });
      child.stderr.on('data', data => process.stderr.write(data));
      child.on('error', reject); child.on('exit', value => resolve(value ?? 1));
    });
    await writeFile(join(diagnostics, `${scene}-customer-polish-keyframes.json`), diagnosticOutput);
    if (diagnosticCode !== 0) code = diagnosticCode;
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
process.exitCode = code;
