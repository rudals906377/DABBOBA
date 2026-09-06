import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const script = new URL('../scripts/verify-local-backend.mjs', import.meta.url).pathname;
const container = 'dabboba-backend-integration-20260905';

async function fixture(options, action) {
  const directory = await mkdtemp(join(tmpdir(), 'dabboba-verifier-unit-'));
  const log = join(directory, 'commands.jsonl');
  const logger = `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(log)},JSON.stringify({command:process.argv[1].split('/').pop(),args:process.argv.slice(2),env:{database:process.env.DATABASE_URL,migration:process.env.DATABASE_MIGRATION_URL,runtime:process.env.DABBOBA_RUNTIME_TEST_DATABASE_URL,worker:process.env.WORKER_DATABASE_URL,realSecret:process.env.PAYMENT_WEBHOOK_SECRET}})+'\\n');`;
  await writeFile(join(directory, 'docker'), `#!${process.execPath}\n${logger}\nif(process.argv[2]==='inspect') console.log(${JSON.stringify(JSON.stringify({ '5432/tcp': [{ HostIp: options.host ?? '127.0.0.1', HostPort: '53219' }] }))});\nelse if(process.argv[2]!=='exec') process.exit(9);\n`, { mode: 0o700 });
  await writeFile(join(directory, 'corepack'), `#!${process.execPath}\n${logger}\n${options.fail ? "console.error('private-diagnostic-must-not-leak'); process.exit(7);" : `console.log('# pass ${options.passed ?? 1}\\n# fail 0\\n# skipped ${options.skip ? 1 : 0}');`}`, { mode: 0o700 });
  try {
    await action(async (args = ['--container', container]) => {
      try {
        const result = await exec(process.execPath, [script, ...args], {
          env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, DATABASE_URL: 'never-inherit-real-database', PAYMENT_WEBHOOK_SECRET: 'never-inherit-provider-secret' },
        });
        return { ...result, code: 0 };
      } catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
    }, async () => (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse));
  } finally { await rm(directory, { recursive: true }); }
}

test('verifier discovers live loopback port, uses all isolated role envs and serializes tests', async () => {
  await fixture({}, async (run, commands) => {
    const result = await run();
    assert.equal(result.code, 0);
    const calls = await commands();
    assert.deepEqual(calls.filter((call) => call.command === 'corepack').map((call) => call.args.slice(-2)), [
      ['run', 'workspace:packages'], ['@dabboba/api', 'build'], ['@dabboba/worker', 'build'],
      ['@dabboba/db', 'test'], ['@dabboba/api', 'test'], ['@dabboba/worker', 'test'],
    ]);
    for (const call of calls.filter((call) => call.command === 'corepack')) {
      assert.equal(call.env.database, '');
      assert.equal(call.env.realSecret, undefined);
      for (const role of ['migration', 'runtime', 'worker']) assert.match(call.env[role], /127\.0\.0\.1:53219\/dabboba_integration$/);
      assert.doesNotMatch(call.args.join(' '), /postgresql|secret/);
    }
  });
});

test('unapproved target or non-loopback published port cannot start any suite', async () => {
  await fixture({ host: '0.0.0.0' }, async (run, commands) => {
    assert.equal((await run()).code, 1);
    assert.equal((await commands()).filter((call) => call.command === 'corepack').length, 0);
    assert.equal((await run(['--container', 'finde-production'])).code, 64);
  });
});

test('a skipped integration or failed build is not reported as a complete pass', async () => {
  await fixture({ passed: 0 }, async (run) => {
    const result = await run();
    assert.equal(result.code, 1, 'an empty suite is not successful behavioral evidence');
  });
  await fixture({ skip: true }, async (run) => {
    const result = await run();
    assert.equal(result.code, 1);
    assert.match(result.stderr, /zero-skip/);
  });
  await fixture({ fail: true }, async (run) => {
    const result = await run();
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /private-diagnostic/);
    assert.match(result.stderr, /shared-build failed/);
  });
});
