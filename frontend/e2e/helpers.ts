import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

export const fixtures = JSON.parse(readFileSync(process.env.E2E_FIXTURE_PATH!, "utf8"));

export async function ownerLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixtures.email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(fixtures.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/kasir/);
}

export async function noPageOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport + 1);
}

export function trackBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    // A deliberate HTTP error may be logged by Chromium's network layer.
    // React/hydration/unhandled failures are never filtered out.
    if (message.type() === "error" && !/^Failed to load resource:/.test(message.text()) && !message.text().includes("Download the React DevTools")) errors.push(message.text());
  });
  return errors;
}
