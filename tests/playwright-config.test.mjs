import assert from "node:assert/strict";
import test from "node:test";

let revision = 0;
async function loadConfig(port) {
  const previous = process.env.MOBILE_RUNTIME_TEST_PORT;
  try {
    if (port === undefined) delete process.env.MOBILE_RUNTIME_TEST_PORT;
    else process.env.MOBILE_RUNTIME_TEST_PORT = port;
    // Import the real defineConfig result; each case re-evaluates environment input.
    return (await import(`../playwright.config.ts?config-test=${revision++}`)).default;
  } finally {
    if (previous === undefined) delete process.env.MOBILE_RUNTIME_TEST_PORT;
    else process.env.MOBILE_RUNTIME_TEST_PORT = previous;
  }
}

function assertIsolatedFixture(config, port) {
  assert.equal(config.workers, 1);
  assert.equal(config.use.baseURL, `http://127.0.0.1:${port}`);
  assert.equal(config.webServer.url, `http://127.0.0.1:${port}/tests/runtime-fixture.html`);
  assert.equal(config.webServer.reuseExistingServer, false);
  assert.equal(config.webServer.env.VITE_DABBOBA_API_URL, "");
  assert.equal(config.webServer.command, `pnpm run dev --host 127.0.0.1 --port ${port} --strictPort`);
}

test("runtime suite owns a dedicated loopback fixture server by default", async () => {
  assertIsolatedFixture(await loadConfig(), 4186);
});

test("explicit port overrides retain fixture isolation and one worker", async () => {
  for (const port of ["1024", "4191", "65535"]) {
    assertIsolatedFixture(await loadConfig(port), Number(port));
  }
});

test("invalid, privileged and injected port values fail before launching a server", async () => {
  for (const port of ["", "0", "1023", "65536", "-4186", "4186.5", "1e4", "0x105a", " 4186", "4186 ", "NaN", "4186; echo nope", "127.0.0.1:4186"]) {
    await assert.rejects(loadConfig(port), /MOBILE_RUNTIME_TEST_PORT.*1024.*65535/);
  }
});
