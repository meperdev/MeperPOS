import { describe, expect, it } from "vitest";
import { pluralizeEs } from "@/lib/pluralize";

describe("pluralizeEs", () => {
  it.each([
    ["producto", "productos"],
    ["cliente", "clientes"],
    ["categoría", "categorías"],
    ["préstamo", "préstamos"],
    ["sofá", "sofás"],
    ["salida", "salidas"],
    ["pago", "pagos"],
    ["proveedor", "proveedores"],
    ["empleado", "empleados"],
  ])("pluralises %s as %s", (singular, plural) => {
    expect(pluralizeEs(singular)).toBe(plural);
  });

  it("applies the consonant rule blindly, so accented consonant endings need an explicit plural", () => {
    // Accents are not inferred: "orden" needs "órdenes" and "notificación" needs
    // "notificaciones" passed explicitly at the call site.
    expect(pluralizeEs("orden")).toBe("ordenes");
    expect(pluralizeEs("notificación")).toBe("notificaciónes");
  });

  it("returns an empty string unchanged", () => {
    expect(pluralizeEs("")).toBe("");
  });
});
