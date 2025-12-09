import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Run tests sequentially to share server
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker since we share the server
  reporter: "html",
  // Use platform-agnostic snapshot names (no -darwin/-linux suffix)
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Use system Chrome on macOS for stability, default chromium in CI
          ...(process.platform === "darwin" ? { channel: "chrome" } : {}),
        },
      },
    },
  ],
  // Run examples server before tests
  webServer: {
    command: "npm run examples:start",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  // Snapshot configuration
  expect: {
    toHaveScreenshot: {
      // Allow 5% pixel difference for cross-platform rendering differences
      maxDiffPixelRatio: 0.05,
      // Animation stabilization
      animations: "disabled",
    },
  },
});
