type ShutdownTimer = {
  unref(): unknown;
};

type ShutdownApplication = {
  close(): Promise<unknown>;
  log: {
    error(bindings: Record<string, unknown>, message: string): unknown;
    info(bindings: Record<string, unknown>, message: string): unknown;
  };
};

type ShutdownRuntime = {
  cancel(timer: ShutdownTimer): void;
  forceExit(code: number): void;
  schedule(callback: () => void, delayMs: number): ShutdownTimer;
  setExitCode(code: number): void;
};

const defaultRuntime: ShutdownRuntime = {
  cancel(timer) {
    clearTimeout(timer as NodeJS.Timeout);
  },
  forceExit(code) {
    process.exit(code);
  },
  schedule(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  setExitCode(code) {
    process.exitCode = code;
  },
};

export function createGracefulShutdown(
  app: ShutdownApplication,
  runtime: ShutdownRuntime = defaultRuntime,
) {
  let shutdownPromise: Promise<void> | null = null;

  return (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    app.log.info({ signal }, "shutting down");
    const forcedExit = runtime.schedule(() => {
      app.log.error({ signal }, "graceful shutdown exceeded the Cloud Run termination window");
      runtime.forceExit(1);
    }, 9_000);
    forcedExit.unref();

    shutdownPromise = Promise.resolve()
      .then(() => app.close())
      .then(() => runtime.cancel(forcedExit))
      .catch((error: unknown) => {
        app.log.error({ err: error, signal }, "graceful shutdown failed");
        runtime.setExitCode(1);
        // Keep the unref'ed watchdog active. If close left a pool, socket, or
        // other handle open, it must still force termination before Cloud Run's
        // shutdown window expires.
      });
    return shutdownPromise;
  };
}
