import { test, expect } from "@playwright/test";
import { SEED } from "../fixtures/seed";

// Signs in on its own so dropping cookies never touches the shared owner session.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("session restore after a browser restart", () => {
  test("keeps the user signed in once session-only cookies are dropped", async ({
    page,
    context,
  }) => {
    await page.goto("/login");
    await page.locator("#email").fill(SEED.owner.email);
    await page.locator("#password").fill(SEED.owner.password);
    await page.getByRole("button", { name: "Ingresar al sistema" }).click();
    await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);

    // A browser restart keeps cookies with Max-Age / Expires and drops the
    // rest (Playwright reports session cookies with expires === -1).
    const persistent = (await context.cookies()).filter((c) => c.expires !== -1);
    const names = persistent.map((c) => c.name);
    expect(names).toContain("refresh_token");
    // POST /api/auth/refresh is CSRF-guarded: without this cookie the first
    // page boot gets a 403 and lands on /login. Soft, so a regression still
    // shows that user-visible outcome below.
    expect.soft(names).toContain("csrf_token");

    await context.clearCookies();
    await context.addCookies(persistent);

    const refresh = page.waitForResponse(
      (r) => r.url().endsWith("/api/auth/refresh") && r.request().method() === "POST",
    );
    await page.goto("/dashboard");
    expect((await refresh).status()).toBe(201);

    await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
    await expect(
      page.getByRole("heading", { level: 1, name: `Bienvenido, ${SEED.owner.firstName}` }),
    ).toBeVisible();
  });
});
