/**
 * What the explorer does, in priority order. Each scenario is a sequence of
 * `s.act(...)` calls (one user intent each, counted against the budget) with
 * oracles that turn surprising outcomes into findings.
 *
 * Scope (e2e/README.md, "Exploratory bug bash"): login, dashboard, POS,
 * inventory, sales, settings (General and Facturación only) and reports.
 * Never: WhatsApp, Suscripción, Equipo y acceso, image/logo uploads,
 * "Eliminar definitivo", SuperAdmin, or anything outside the isolated stack.
 */

import { EXPLORE_SEED } from "./seed.mjs";

const LONG = (n, unit = "Ñ") => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const UNICODE_NAME = "Ñandú «prueba» 漢字 🍓 ‘comillas’";
const ODD_SEARCHES = [
  "' OR 1=1 --",
  "🍓🙃 漢字",
  "%_\\",
  LONG(300, "a"),
];

/** Toast text currently on screen (the stack is `role=region` "Notificaciones"). */
async function toastText(page) {
  try {
    return (await page.getByRole("region", { name: "Notificaciones" }).innerText({ timeout: 1_500 })).trim();
  } catch {
    return "";
  }
}

async function closeDialogs(page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.getByRole("dialog").first().isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

// --- Login (signed out; not counted against the budget) ---------------------

export async function login(s) {
  await s.visit("/login", { free: true });
  await s.check("/login");

  const empty = await s.act("Submit the login form empty", async (page) => {
    await page.getByRole("button", { name: "Ingresar al sistema" }).click();
  });
  if (empty.network.some((e) => e.url.startsWith("/api/auth/login"))) {
    s.record({
      title: "Empty login form reaches the API",
      severity: "low",
      category: "validation",
      expected: "Native `required` validation blocks the submit; no request.",
      actual: "POST /api/auth/login was sent.",
      evidence: { network: empty.network },
    });
  }

  const wrong = await s.act(
    "Sign in with the seed owner's email and a wrong password",
    async (page) => {
      await page.locator("#email").fill(EXPLORE_SEED.owner.email);
      await page.locator("#password").fill("contraseña-incorrecta-ñ");
      await page.getByRole("button", { name: "Ingresar al sistema" }).click();
      await page.getByRole("alert").waitFor({ timeout: 6_000 });
    },
    { expectStatuses: [401] },
  );
  if (wrong.ok && !/\/login/.test(s.page.url())) {
    s.record({ title: "Wrong password left the login page", severity: "critical", category: "validation", actual: s.page.url() });
  }

  await s.act(
    "Sign in with a 5-character password (below the API's MinLength(6))",
    async (page) => {
      await page.locator("#password").fill("12345");
      await page.getByRole("button", { name: "Ingresar al sistema" }).click();
      await page.getByRole("alert").waitFor({ timeout: 6_000 });
      const alert = (await page.getByRole("alert").innerText()).trim();
      if (/must be|should|longer|characters/i.test(alert)) {
        s.record({
          title: "Login shows a raw English validation message",
          severity: "low",
          category: "copy",
          expected: "Spanish, user-facing copy (AGENTS.md).",
          actual: `Alert text: "${alert}"`,
        });
      }
    },
    { expectStatuses: [400, 401] },
  );

  await s.act("Sign in as the seed owner", async (page) => {
    await page.locator("#email").fill(EXPLORE_SEED.owner.email);
    await page.locator("#password").fill(EXPLORE_SEED.owner.password);
    await page.getByRole("button", { name: "Ingresar al sistema" }).click();
    await page.waitForURL(/\/dashboard(?:[/?#]|$)/, { timeout: 20_000 });
  });
  if (!/\/dashboard/.test(s.page.url())) {
    throw new Error(`could not sign in as the seed owner (still on ${s.page.url()})`);
  }
  s.signedIn = true;
}

// --- Coverage pass: every scoped page once, with checks ----------------------

export async function coverage(s) {
  for (const path of ["/dashboard", "/pos", "/inventory", "/sales", "/settings", "/reports"]) {
    await s.visit(path);
    await s.check(path);
  }
}

// --- Inventory ----------------------------------------------------------------

async function openNewProduct(page) {
  const form = page.getByRole("dialog", { name: "Nuevo producto" });
  if (!(await form.isVisible().catch(() => false))) {
    await closeDialogs(page);
    await page.getByRole("button", { name: "Nuevo producto" }).click();
    await form.waitFor();
  }
  return form;
}

async function fillProduct(page, form, values) {
  if (values.name !== undefined) await form.getByLabel("Nombre").fill(values.name);
  if (values.sku !== undefined) await form.getByLabel("SKU", { exact: false }).first().fill(values.sku);
  if (values.category) {
    await form.getByLabel("Categoría").click();
    await page.getByRole("option", { name: EXPLORE_SEED.category }).click();
  }
  if (values.cost !== undefined) await form.getByLabel("Precio de costo").fill(values.cost);
  if (values.sale !== undefined) await form.getByLabel("Precio de venta").fill(values.sale);
  if (values.tax !== undefined) await form.getByLabel("Impuesto (%)").fill(values.tax);
  if (values.stock !== undefined) await form.getByRole("spinbutton", { name: /^Stock\*?$/ }).fill(values.stock);
}

/**
 * One create attempt: open the form if needed, fill it, press "Crear", and
 * judge the outcome. `reject` attempts must not be accepted by the server.
 */
async function productAttempt(s, label, values, { reject, severity = "high", expected } = {}) {
  let toast = "";
  const result = await s.act(
    `Nuevo producto: ${label}`,
    async (page) => {
      const form = await openNewProduct(page);
      await fillProduct(page, form, values);
      await form.getByRole("button", { name: "Crear" }).click();
      await page.waitForTimeout(800);
      toast = await toastText(page);
    },
    { expectStatuses: reject ? [400, 404, 409, 422] : [] },
  );
  if (!result.ok) return result;
  const verdict = reject
    ? s.expectRejected(result.network, {
        match: (e) => e.method === "POST" && e.url.replace(/\?.*$/, "") === "/api/products",
        caseLabel: `a product with ${label}`,
        severity,
        expected,
      })
    : "valid input";
  if (reject && /already exists|must be|should not|not found/i.test(toast)) {
    s.record({
      title: "Product form shows a raw English API message",
      severity: "low",
      category: "copy",
      key: "copy|english-api-message|products",
      expected: "Spanish, user-facing copy (AGENTS.md); the API message is for developers.",
      actual: `Toast: "${toast.split("\n").slice(0, 2).join(" — ")}"`,
    });
  }
  const last = s.actions.at(-1);
  if (last) last.outcome += ` — ${verdict}${toast ? `; toast: "${toast.split("\n")[0].slice(0, 80)}"` : ""}`;
  return result;
}

export async function inventory(s) {
  await s.visit("/inventory");
  const search = s.page.getByRole("searchbox", { name: "Buscar" });
  for (const term of ODD_SEARCHES.slice(0, 3)) {
    await s.act(`Search the catalogue for ${JSON.stringify(term.slice(0, 40))}`, async () => {
      await search.fill(term);
    });
  }
  await s.act("Clear the catalogue search", () => search.fill(""));

  await productAttempt(s, "every field empty", {}, { reject: true });
  await productAttempt(
    s,
    "a whitespace-only name and SKU",
    { name: "   ", sku: "   ", category: true, cost: "1000", sale: "2000", stock: "1" },
    { reject: true, expected: "Blank names/SKUs are rejected (trimmed before validation)." },
  );
  await productAttempt(
    s,
    `the duplicate SKU ${EXPLORE_SEED.coffee.sku}`,
    { name: "Duplicado E2E", sku: EXPLORE_SEED.coffee.sku, category: true, cost: "1000", sale: "2000", stock: "1" },
    { reject: true },
  );
  await productAttempt(
    s,
    "a negative stock (-5)",
    { name: "Stock negativo E2E", sku: `NEG-${Date.now().toString(36)}`, category: true, cost: "1000", sale: "2000", stock: "-5" },
    { reject: true },
  );
  await productAttempt(
    s,
    "a fractional stock (2.5)",
    { name: "Stock fraccional E2E", sku: `FRAC-${Date.now().toString(36)}`, category: true, cost: "1000", sale: "2000", stock: "2.5" },
    { reject: true, severity: "medium", expected: "Stock is a whole number; the API answers 400, never 500 or a silent truncation." },
  );
  await productAttempt(
    s,
    "a 150% tax rate",
    { name: "Impuesto 150 E2E", sku: `TAX-${Date.now().toString(36)}`, category: true, cost: "1000", sale: "2000", tax: "150", stock: "1" },
    { reject: true, severity: "medium", expected: "A tax rate above 100% is rejected." },
  );
  await productAttempt(
    s,
    "a 2,000-character name",
    { name: LONG(2000), sku: `LONG-${Date.now().toString(36)}`, category: true, cost: "1000", sale: "2000", tax: "0", stock: "1" },
    { reject: true, severity: "low", expected: "Names have a maximum length (no MaxLength on CreateProductDto.name)." },
  );
  await closeDialogs(s.page);

  const sku = `UNI-${Date.now().toString(36).toUpperCase()}`;
  await productAttempt(s, "a valid unicode name, sale price 0", {
    name: UNICODE_NAME,
    sku,
    category: true,
    cost: "0",
    sale: "0",
    tax: "0",
    stock: "3",
  });
  await closeDialogs(s.page);
  await s.act(`Search the catalogue for the unicode product's SKU ${sku}`, async (page) => {
    await search.fill(sku);
    await page.getByText(UNICODE_NAME).first().waitFor({ timeout: 6_000 });
  });
  await s.check("/inventory (after odd products)");
  await s.act("Toggle the 'Stock bajo' filter", (page) =>
    page.getByRole("button", { name: /Stock bajo/ }).first().click(),
  );
  await s.visit("/inventory?page=99999");
}

// --- POS --------------------------------------------------------------------

export async function pos(s) {
  const { coffee } = EXPLORE_SEED;
  await s.visit("/pos");
  const search = s.page.getByPlaceholder("Escanear o buscar por nombre, SKU o código...");
  await s.act("Search the POS for a product that does not exist (emoji)", () => search.fill("zzz-no-existe-🙃"));
  await s.act(`Search the POS for ${coffee.sku} and add it to the cart`, async (page) => {
    await search.fill(coffee.sku);
    await page.getByRole("button", { name: `Agregar al carrito: ${coffee.name}` }).click();
    await page.getByTestId("pos-cart-total").waitFor();
  });

  const quantity = s.page.getByRole("spinbutton", { name: "Cantidad" }).or(s.page.getByLabel("Cantidad")).first();
  for (const [typed, check] of [
    ["0", (v) => v >= 1],
    ["-5", (v) => v >= 1],
    ["99999", (v) => v <= coffee.stock],
  ]) {
    await s.act(`Type ${typed} into the cart line's quantity`, async (page) => {
      await quantity.fill(typed);
      await quantity.press("Tab");
      await page.waitForTimeout(300);
      const value = Number(await quantity.inputValue());
      if (!check(value)) {
        s.record({
          title: `POS cart accepts a quantity of ${typed}`,
          severity: "high",
          category: "validation",
          expected: `The quantity is clamped to 1..${coffee.stock} (available stock).`,
          actual: `The quantity input shows ${value}.`,
        });
      }
    });
  }
  await s.act("Set the quantity to 2", async () => {
    await quantity.fill("2");
    await quantity.press("Tab");
  });

  await s.act("Finalizar venta, then try to pay $1.000 cash for a larger total", async (page) => {
    await page.getByRole("button", { name: "Finalizar venta" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirmar pago" });
    await dialog.waitFor();
    const amount = dialog.getByRole("textbox").first();
    await amount.fill("1000");
    await page.waitForTimeout(300);
    const confirm = dialog.getByRole("button", { name: "Confirmar pago" });
    if (await confirm.isEnabled()) {
      s.record({
        title: "Payment can be confirmed while underpaid",
        severity: "high",
        category: "validation",
        expected: "'Confirmar pago' stays disabled until the payments cover the total.",
        actual: "The button is enabled with $1.000 paid against a $10.000 total.",
      });
    }
  });

  await s.act("Complete with cash and confirm the payment", async (page) => {
    const dialog = page.getByRole("dialog", { name: "Confirmar pago" });
    await dialog.getByRole("button", { name: /Completar con efectivo/ }).click();
    await dialog.getByRole("button", { name: "Confirmar pago" }).click();
    await page.getByRole("dialog", { name: "Venta registrada" }).waitFor({ timeout: 10_000 });
  });
  await s.check("/pos (receipt open)");
  await s.act("Close the receipt with Escape", async (page) => {
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Venta registrada" }).waitFor({ state: "hidden" });
  });

  let pausedTotal = "";
  await s.act("Add the product again and pause the sale", async (page) => {
    await search.fill(coffee.sku);
    await page.getByRole("button", { name: `Agregar al carrito: ${coffee.name}` }).click();
    pausedTotal = (await page.getByTestId("pos-cart-total").innerText()).trim();
    await page.getByRole("button", { name: "Pausar" }).click();
  });
  await s.act("Resume the paused sale", async (page) => {
    await page.getByRole("button", { name: /^Reanudar/ }).click();
    await page.waitForTimeout(400);
    // Resuming may open a picker of paused sales.
    const picker = page.getByRole("dialog").first();
    if (await picker.isVisible().catch(() => false)) {
      await picker.getByRole("button").filter({ hasText: /Reanudar|\$/ }).first().click();
    }
    await page.waitForTimeout(400);
    const resumed = (await page.getByTestId("pos-cart-total").innerText()).trim();
    if (pausedTotal && resumed !== pausedTotal) {
      s.record({
        title: "Resuming a paused sale does not restore its total",
        severity: "medium",
        category: "functional",
        expected: `Cart total ${pausedTotal}`,
        actual: `Cart total ${resumed}`,
      });
    }
  });
  await s.act("Reload /pos with a cart in progress", (page) => page.reload());
}

// --- Sales -----------------------------------------------------------------

export async function sales(s) {
  await s.visit("/sales");
  for (const preset of ["Hoy", "30 días", "Todas"]) {
    await s.act(`Pick the '${preset}' period`, (page) => page.getByRole("button", { name: preset, exact: true }).first().click());
  }
  const search = s.page.getByPlaceholder("Buscar por N° o cliente...");
  await s.act("Search sales for a SQL-ish and emoji string", () => search.fill("🙃' OR 1=1 --"));
  await s.act("Search sales for a sale number that does not exist (99999999)", () => search.fill("99999999"));
  await s.act("Clear the sales search", () => search.fill(""));
  await s.act("Open the first sale's detail and close it", async (page) => {
    await page.getByRole("button", { name: /^Ver detalle de venta/ }).first().click();
    const dialog = page.getByRole("dialog", { name: /Detalles/ });
    await dialog.waitFor();
    await page.keyboard.press("Escape");
  });
  await s.visit("/sales?page=-1");
  await s.visit("/sales/00000000-0000-4000-8000-000000000000", { expectStatuses: [404] });
  await s.check("/sales/<unknown id>");
  await s.visit("/sales/no-es-un-id", { expectStatuses: [400, 404] });
}

// --- Settings (General + Facturación only) -----------------------------------

export async function settings(s) {
  await s.visit("/settings");
  const name = s.page.locator("#organization-name");
  let original = "";
  const saveName = async (value, label, { reject, severity, expected } = {}) => {
    const result = await s.act(
      `Save the business name as ${label}`,
      async (page) => {
        original ||= await name.inputValue();
        await name.fill(value);
        await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
        await page.waitForTimeout(800);
      },
      { expectStatuses: reject ? [400] : [] },
    );
    if (result.ok && reject) {
      const verdict = s.expectRejected(result.network, {
        match: (e) => e.method !== "GET" && /^\/api\/settings/.test(e.url),
        caseLabel: `a business name that is ${label}`,
        severity,
        expected,
      });
      const last = s.actions.at(-1);
      if (last) last.outcome += ` — ${verdict}`;
    }
  };
  await saveName("", "empty", { reject: true });
  await saveName("   ", "whitespace only", { reject: true, severity: "medium" });
  await saveName(LONG(1000), "1,000 characters long", {
    reject: true,
    severity: "low",
    expected: "The business name has a maximum length (UpdateOrganizationNameDto has none); it is printed on every receipt.",
  });
  await s.check("/settings (long business name)");
  await s.act("Restore the business name", async (page) => {
    await name.fill(original || "Tienda Smoke E2E");
    await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
    await page.waitForTimeout(800);
  });

  await s.act("Open 'Facturación y recibos'", (page) =>
    page.getByRole("navigation", { name: "Secciones de configuración" }).getByRole("link", { name: /Facturación/ }).click(),
  );
  await s.act("Save a 3,000-character unicode print header", async (page) => {
    await page.getByLabel("Encabezado de impresión").fill(LONG(3000, "Línea «ñ» 漢字 🍓\n"));
    await page.getByRole("button", { name: "Guardar", exact: true }).first().click();
    await page.waitForTimeout(800);
  });
  await s.check("/settings/billing");
}

// --- Reports -------------------------------------------------------------------

export async function reports(s) {
  await s.visit("/reports");
  await s.act("Set an inverted range (Desde 2030-01-01, Hasta 2020-01-01)", async (page) => {
    await page.locator("#reports-start").fill("2030-01-01");
    await page.locator("#reports-end").fill("2020-01-01");
  }, { expectStatuses: [400] });
  await s.act("Set a range starting in 1900", async (page) => {
    await page.locator("#reports-start").fill("1900-01-01");
    await page.locator("#reports-end").fill("2026-12-31");
  }, { expectStatuses: [400] });
  await s.check("/reports (odd range)");
  await s.act("Pick the 'Este mes' preset", (page) =>
    page.getByRole("group", { name: "Filtros de período" }).getByRole("button", { name: "Este mes" }).click()
      .catch(() => page.getByRole("button", { name: "Este mes" }).first().click()),
  );
  await s.act("Download 'Reporte del día (PDF)'", async (page) => {
    const download = page.waitForEvent("download", { timeout: 10_000 });
    await page.getByRole("button", { name: "Reporte del día (PDF)" }).click();
    await download;
  });
  await s.act("Open 'Exportar'", async (page) => {
    const download = page.waitForEvent("download", { timeout: 4_000 }).catch(() => null);
    await page.getByRole("button", { name: "Exportar" }).first().click();
    await download;
    await closeDialogs(page);
  });
}

// --- Edge paths ----------------------------------------------------------------

export async function edgePaths(s) {
  await s.visit("/ruta-que-no-existe", { expectStatuses: [404] });
  const body = await s.page.locator("body").innerText().catch(() => "");
  if (/could not be found/i.test(body)) {
    s.record({
      title: "Unknown routes render Next.js's default English 404",
      severity: "low",
      category: "copy",
      layer: "02",
      layerReason: "Add app/not-found.tsx (Spanish, with a way back) and a smoke assertion that an unknown route renders it.",
      expected: "A Spanish not-found page inside the app shell (AGENTS.md: UI copy in Spanish).",
      actual: `"${body.trim().replace(/\s+/g, " ").slice(0, 80)}"`,
    });
  }
  await s.check("/ruta-que-no-existe");
  await s.act("Go back in history", (page) => page.goBack());
  await s.act("Go forward in history", (page) => page.goForward());
  await s.act("Toggle the colour theme", (page) =>
    page.getByRole("button", { name: /Cambiar a modo (claro|oscuro)/ }).first().click(),
  );
  await s.visit("/dashboard");
  await s.check("/dashboard (theme toggled)");
  await s.act("Toggle the colour theme back", (page) =>
    page.getByRole("button", { name: /Cambiar a modo (claro|oscuro)/ }).first().click(),
  );
}

// --- Dashboard -------------------------------------------------------------------

export async function dashboard(s) {
  await s.visit("/dashboard");
  await s.act("Change the revenue range to '15 días'", async (page) => {
    await page.getByLabel(/Rango/).or(page.getByRole("button", { name: /Rango|7 días/ })).first().click();
    await page.getByRole("option", { name: "15 días" }).click();
  });
  await s.act("Follow 'Ver todas' (recent sales)", (page) => page.getByRole("link", { name: "Ver todas" }).first().click());
}

/** Signed-in scenarios in priority order; the budget may stop the tail. */
export const SCENARIOS = [
  ["coverage", coverage],
  ["inventory", inventory],
  ["pos", pos],
  ["sales", sales],
  ["settings", settings],
  ["reports", reports],
  ["edge-paths", edgePaths],
  ["dashboard", dashboard],
];
