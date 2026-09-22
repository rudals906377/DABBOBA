import { defineConfig } from "@playwright/test";

const port = 4191;

export default defineConfig({
  testDir: "./tests-browser",
  timeout: 20_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `corepack pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
