import { test, expect } from "../fixtures/test";
import { SEED } from "../fixtures/seed";

test.describe("inventory", () => {
  test("creates a product and finds it in the catalogue", async ({ page }) => {
    // Unique per run, so the test also passes against a database that has
    // already seen earlier runs.
    const suffix = Date.now().toString(36).toUpperCase();
    const name = `Producto smoke ${suffix}`;
    const sku = `SMOKE-${suffix}`;

    await page.goto("/inventory");
    await page.getByRole("button", { name: "Nuevo producto" }).click();

    const form = page.getByRole("dialog", { name: "Nuevo producto" });
    await expect(form).toBeVisible();

    await form.getByLabel("Nombre").fill(name);
    await form.getByLabel("SKU").fill(sku);
    await form.getByLabel("Categoría").click();
    await page.getByRole("option", { name: SEED.category }).click();
    await form.getByLabel("Precio de costo").fill("1000");
    await form.getByLabel("Precio de venta").fill("2500");
    // Stock is the shared counter (a numeric textbox); exact, so "Stock mín." does not match.
    await form.getByRole("textbox", { name: "Stock", exact: true }).fill("12");
    await form.getByRole("button", { name: "Crear" }).click();

    await expect(page.getByText("Producto creado correctamente")).toBeVisible();
    await expect(form).toBeHidden();

    // Search the catalogue for it, as a user would.
    await page.getByPlaceholder("Buscar por nombre, SKU...").fill(sku);
    await expect(
      page.getByRole("button", { name: `Editar producto: ${name}` }),
    ).toBeVisible();
  });
});
