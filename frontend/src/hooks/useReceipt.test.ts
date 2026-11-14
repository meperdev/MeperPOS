import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { downloadReceiptPdf, openReceiptPdf } from "./useReceipt";

vi.mock("@/lib/api", () => ({
  api: { fetchBlob: vi.fn(), saveBlob: vi.fn() },
}));

const fetchBlob = vi.mocked(api.fetchBlob);
const saveBlob = vi.mocked(api.saveBlob);

function pdfBlob(content = "pdf"): Blob {
  return new Blob([content], { type: "application/pdf" });
}

describe("receipt PDF helpers", () => {
  const createObjectURL = vi.fn(() => "blob:receipt");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the server-generated PDF with its filename", async () => {
    const blob = pdfBlob();
    fetchBlob.mockResolvedValue({
      blob,
      filename: "comprobante_42.pdf",
    });

    await downloadReceiptPdf("sale-42");

    expect(fetchBlob).toHaveBeenCalledWith("/sales/sale-42/receipt", {});
    expect(saveBlob).toHaveBeenCalledWith(blob, "comprobante_42.pdf");
  });

  it("keeps a meaningful filename when the header is unavailable", async () => {
    const blob = pdfBlob();
    fetchBlob.mockResolvedValue({
      blob,
      filename: "export_1793587105789",
    });

    await downloadReceiptPdf("sale-42");

    expect(saveBlob).toHaveBeenCalledWith(blob, "comprobante.pdf");
  });

  it("opens the PDF in a new tab for preview and printing", async () => {
    const blob = pdfBlob();
    const receiptWindow = {
      opener: {},
      location: { href: "" },
      close: vi.fn(),
    } as unknown as Window;
    fetchBlob.mockResolvedValue({
      blob,
      filename: "comprobante_42.pdf",
    });
    const open = vi.spyOn(window, "open").mockReturnValue(receiptWindow);

    await openReceiptPdf("sale-42");

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(receiptWindow.location.href).toBe("blob:receipt");
    expect(receiptWindow.opener).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("reports the popup blocker instead of silently doing nothing", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    await expect(openReceiptPdf("sale-42")).rejects.toThrow(
      "Permita las ventanas emergentes para ver el comprobante",
    );
    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it("closes the reserved tab when the PDF request fails", async () => {
    const receiptWindow = {
      opener: {},
      location: { href: "" },
      close: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(receiptWindow);
    fetchBlob.mockRejectedValue(new Error("500"));

    await expect(openReceiptPdf("sale-42")).rejects.toThrow(
      "Error al generar el comprobante",
    );
    expect(receiptWindow.close).toHaveBeenCalled();
  });

  it("wraps backend failures in a user-facing message", async () => {
    fetchBlob.mockRejectedValue(new Error("500"));

    await expect(downloadReceiptPdf("sale-42")).rejects.toThrow(
      "Error al generar el comprobante",
    );
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
