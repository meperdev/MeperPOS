import { test as setup, expect } from "@playwright/test";
import { OWNER_STATE_FILE } from "../fixtures/paths";
import { SEED } from "../fixtures/seed";

/** Signs the seeded owner in once and stores the session for the specs. */
setup("sign in as the seeded owner", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill(SEED.owner.email);
  await page.locator("#password").fill(SEED.owner.password);
  await page.getByRole("button", { name: "Ingresar al sistema" }).click();

  await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
  await page.context().storageState({ path: OWNER_STATE_FILE });
});
