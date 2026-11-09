import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_URL ?? "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.E2E_CHROME_PATH ?? (existsSync(chrome) ? chrome : undefined),
    },
  },
});
