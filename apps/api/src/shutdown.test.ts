import assert from "node:assert/strict";
import test from "node:test";
import { createGracefulShutdown } from "./shutdown.js";

function logger() {
  return {
    info() {},
    error() {},
  };
}

test("successful graceful shutdown cancels its forced-exit watchdog", async () => {
  let cancelled = 0;
  let unrefed = 0;
  const timer = { unref: () => { unrefed += 1; } };
  const shutdown = createGracefulShutdown(
    { close: async () => undefined, log: logger() },
    {
      cancel(value) {
        assert.equal(value, timer);
        cancelled += 1;
      },
      forceExit() {
        assert.fail("successful shutdown must not force exit");
      },
      schedule(_callback, delayMs) {
        assert.equal(delayMs, 9_000);
        return timer;
      },
      setExitCode() {
        assert.fail("successful shutdown must not set a failure exit code");
      },
    },
  );

  await shutdown("SIGTERM");
  assert.equal(unrefed, 1);
  assert.equal(cancelled, 1);
});

test("failed graceful shutdown keeps its watchdog active", async () => {
  const failure = Object.assign(new Error("pool close failed with postgres://user:secret@database.example.test/db"), {
    code: "57P01",
    detail: "private row contents",
  });
  const errorLogs: Array<{ bindings: Record<string, unknown>; message: string }> = [];
  const scheduledCallback: { current: (() => void) | null } = { current: null };
  let cancelled = 0;
  let forcedExitCode: number | null = null;
  let processExitCode: number | null = null;
  let closeCalls = 0;
  const timer = { unref() {} };
  const shutdown = createGracefulShutdown(
    {
      async close() {
        closeCalls += 1;
        throw failure;
      },
      log: {
        info() {},
        error(bindings, message) {
          errorLogs.push({ bindings, message });
        },
      },
    },
    {
      cancel() {
        cancelled += 1;
      },
      forceExit(code) {
        forcedExitCode = code;
      },
      schedule(callback, delayMs) {
        assert.equal(delayMs, 9_000);
        scheduledCallback.current = callback;
        return timer;
      },
      setExitCode(code) {
        processExitCode = code;
      },
    },
  );

  const first = shutdown("SIGTERM");
  const second = shutdown("SIGINT");
  assert.equal(second, first);
  await first;

  assert.equal(closeCalls, 1);
  assert.equal(cancelled, 0);
  assert.equal(processExitCode, 1);
  assert.deepEqual(errorLogs, [{
    bindings: { signal: "SIGTERM", errorKind: "database", sqlState: "57P01" },
    message: "graceful shutdown failed",
  }]);
  assert.doesNotMatch(JSON.stringify(errorLogs), /secret|private|database\.example\.test/);
  assert.ok(scheduledCallback.current);
  scheduledCallback.current();
  assert.equal(forcedExitCode, 1);
});
