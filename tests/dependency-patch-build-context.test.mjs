import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('pnpm-workspace.yaml');
const patchSection = workspace.split('patchedDependencies:\n')[1]?.split(/^\S/m)[0];
assert.ok(patchSection, 'Expected the explicit pinned dependency-patch section');
const patches = [...patchSection.matchAll(/^\s+[^:\n]+:\s+(patches\/[^\s]+\.patch)\s*$/gm)].map(match => match[1]);
assert.ok(patches.length > 0);

for (const patch of patches) {
  test(`pinned dependency patch ${patch} is available before the Docker frozen install`, () => {
    const dockerfile = read('Dockerfile');
    const copy = `COPY ${patch} ./${patch}`;
    assert.ok(dockerfile.includes(copy), `Missing explicit patch COPY: ${patch}`);
    assert.ok(dockerfile.indexOf(copy) < dockerfile.indexOf('pnpm install --frozen-lockfile'));
    assert.ok(read('.dockerignore').split('\n').includes(`!${patch}`));
    assert.ok(read('.gcloudignore').split('\n').includes(`!${patch}`));
    assert.ok(read('ops/cloud-run/check-artifacts.sh').includes(patch));
    assert.ok(read('ops/cloud-run/context-check.Dockerfile').includes(`test -f ${patch}`));
  });
}
