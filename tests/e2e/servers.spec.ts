import { test, expect } from "@playwright/test";

// Server configurations
const SERVERS = [
  { key: "basic-react", index: 0, name: "Basic MCP App Server (React-based)" },
  {
    key: "basic-vanillajs",
    index: 1,
    name: "Basic MCP App Server (Vanilla JS)",
  },
  { key: "budget-allocator", index: 2, name: "Budget Allocator Server" },
  { key: "cohort-heatmap", index: 3, name: "Cohort Heatmap Server" },
  {
    key: "customer-segmentation",
    index: 4,
    name: "Customer Segmentation Server",
  },
  { key: "scenario-modeler", index: 5, name: "SaaS Scenario Modeler" },
  { key: "system-monitor", index: 6, name: "System Monitor Server" },
  { key: "threejs", index: 7, name: "Three.js Server" },
];

/**
 * Wait for the MCP App to load inside nested iframes.
 * Structure: page > iframe (sandbox) > iframe (app)
 */
async function waitForAppLoad(page: import("@playwright/test").Page) {
  // Wait for outer iframe (sandbox)
  const outerFrame = page.frameLocator("iframe").first();
  // Wait for inner iframe (app) to be visible
  await expect(outerFrame.locator("iframe")).toBeVisible();
}

test.describe("Host UI", () => {
  test("initial state shows controls", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("label:has-text('Server')")).toBeVisible();
    await expect(page.locator("label:has-text('Tool')")).toBeVisible();
    await expect(page.locator('button:has-text("Call Tool")')).toBeVisible();
  });

  test("screenshot of initial state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('button:has-text("Call Tool")')).toBeVisible();
    await expect(page).toHaveScreenshot("host-initial.png");
  });
});

// Generate tests for each server
for (const server of SERVERS) {
  test.describe(`${server.name}`, () => {
    test(`loads app UI`, async ({ page }) => {
      await page.goto("/");

      // Select server and call tool
      await page.locator("select").first().selectOption({ index: server.index });
      await page.click('button:has-text("Call Tool")');

      // Wait for app to load in nested iframes
      await waitForAppLoad(page);
    });

    test(`screenshot matches golden`, async ({ page }) => {
      await page.goto("/");

      // Select server and call tool
      await page.locator("select").first().selectOption({ index: server.index });
      await page.click('button:has-text("Call Tool")');

      // Wait for app to load
      await waitForAppLoad(page);

      // Brief stabilization for animations/rendering
      await page.waitForTimeout(500);

      // Take screenshot
      await expect(page).toHaveScreenshot(`${server.key}.png`, {
        maxDiffPixelRatio: 0.1, // 10% tolerance for dynamic content
      });
    });
  });
}
