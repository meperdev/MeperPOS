import { test, expect } from "@playwright/test";
import { SEED } from "../fixtures/seed";

// This flow is about signing in, so it starts signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("login", () => {
  test("rejects a wrong password and keeps the user on /login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-form-emblem")).toBeVisible();

    await page.locator("#email").fill(SEED.owner.email);
    await page.locator("#password").fill("not-the-password");
    await page.getByRole("button", { name: "Ingresar al sistema" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
  });

  test("signs the owner in and lands on the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(SEED.owner.email);
    await page.locator("#password").fill(SEED.owner.password);
    await page.getByRole("button", { name: "Ingresar al sistema" }).click();

    await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
    // The dashboard greets the signed-in owner by first name.
    await expect(
      page.getByRole("heading", { level: 1, name: `Bienvenido, ${SEED.owner.firstName}` }),
    ).toBeVisible();
  });
});
