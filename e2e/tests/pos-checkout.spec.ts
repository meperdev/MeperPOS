import { test, expect } from "../fixtures/test";
import { SEED, cop } from "../fixtures/seed";

test.describe("POS checkout", () => {
  test("sells a seeded product for cash and lists the sale in /sales", async ({ page }) => {
    const { coffee } = SEED;

    await page.goto("/pos");
    await expect(page.getByTestId("pos-page-root")).toBeVisible();

    // Find the seeded product by SKU so the test does not depend on grid order.
    await page
      .getByPlaceholder("Escanear o buscar por nombre, SKU o código...")
      .fill(coffee.sku);
    await page
      .getByRole("button", { name: `Agregar al carrito: ${coffee.name}` })
      .click();

    // The server-derived price reaches the cart total untouched.
    await expect(page.getByTestId("pos-cart-total")).toHaveText(cop(coffee.salePrice));

    await page.getByRole("button", { name: "Finalizar venta" }).click();
    const payment = page.getByRole("dialog", { name: "Confirmar pago" });
    await expect(payment).toBeVisible();

    await payment.getByRole("button", { name: /Completar con efectivo/ }).click();
    await payment.getByRole("button", { name: "Confirmar pago" }).click();

    const receipt = page.getByRole("dialog", { name: "Venta registrada" });
    await expect(receipt).toBeVisible();
    await expect(receipt.getByText(cop(coffee.salePrice)).first()).toBeVisible();

    const receiptLine = await receipt.getByText(/Comprobante #\d+/).textContent();
    const saleNumber = receiptLine?.match(/#(\d+)/)?.[1];
    expect(saleNumber, "the receipt shows the new sale number").toBeTruthy();

    // The cart is emptied for the next customer.
    await page.keyboard.press("Escape");
    await expect(receipt).toBeHidden();
    await expect(page.getByTestId("pos-cart-total")).toHaveText(cop(0));

    // The sale is persisted and listed with the same number and total.
    await page.goto("/sales");
    const row = page.getByRole("button", { name: `Ver detalle de venta ${saleNumber}`, exact: true });
    await expect(row).toBeVisible();
    await expect(row).toContainText(cop(coffee.salePrice));
  });
});
