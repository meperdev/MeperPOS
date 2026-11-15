import { describe, it, expect } from "vitest";
import { CODE_LABELS, getImportErrorCodeLabel } from "./labels";

describe("getImportErrorCodeLabel", () => {
  it("returns the Spanish label for a known code", () => {
    expect(getImportErrorCodeLabel("DUPLICATE_SKU")).toBe("SKU duplicado");
    expect(getImportErrorCodeLabel("INVALID_EMAIL")).toBe("Correo inválido");
    expect(getImportErrorCodeLabel("UNKNOWN_ERROR")).toBe("Error desconocido");
  });

  it("maps every known code to a non-raw label", () => {
    for (const [code, label] of Object.entries(CODE_LABELS)) {
      expect(label, code).not.toBe(code);
      expect(label, code).not.toMatch(/^[A-Z_]+$/);
    }
  });

  it("falls back to a generic Spanish label for an unknown code, never the raw code", () => {
    const label = getImportErrorCodeLabel("SOMETHING_NEW_FROM_BACKEND");
    expect(label).toBe("Error de validación");
    expect(label).not.toContain("SOMETHING_NEW_FROM_BACKEND");
  });

  it("falls back for null, undefined and empty codes", () => {
    expect(getImportErrorCodeLabel(null)).toBe("Error de validación");
    expect(getImportErrorCodeLabel(undefined)).toBe("Error de validación");
    expect(getImportErrorCodeLabel("")).toBe("Error de validación");
  });

  it("does not resolve inherited object keys as labels", () => {
    expect(getImportErrorCodeLabel("constructor")).toBe("Error de validación");
    expect(getImportErrorCodeLabel("toString")).toBe("Error de validación");
  });
});
