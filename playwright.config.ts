import { defineConfig } from "@playwright/test";

const configuredPort = process.env.MOBILE_RUNTIME_TEST_PORT;
const testPort = configuredPort === undefined ? 4186 : Number(configuredPort);
if (
  (configuredPort !== undefined && !/^[0-9]{4,5}$/.test(configuredPort))
  || !Number.isInteger(testPort) || testPort < 1024 || testPort > 65535
) {
  throw new Error("MOBILE_RUNTIME_TEST_PORT must be an integer port between 1024 and 65535.");
}

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 20_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    viewport: { width: 1100, height: 1100 },
  },
  webServer: {
    command: `pnpm run dev --host 127.0.0.1 --port ${testPort} --strictPort`,
    env: {
      VITE_DABBOBA_API_URL: "",
    },
    url: `http://127.0.0.1:${testPort}/tests/runtime-fixture.html`,
    reuseExistingServer: false,
  },
});
