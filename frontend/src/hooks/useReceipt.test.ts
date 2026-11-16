import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  const createObjectURL = vi.fn<typeof URL.createObjectURL>(
    () => "blob:receipt",
  );
  const revokeObjectURL = vi.fn<typeof URL.revokeObjectURL>();

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
    cleanup();
    vi.restoreAllMocks();
    // The sheet is plain DOM, so the tests clean it up themselves.
    document.querySelectorAll("[data-receipt-sheet]").forEach((node) => node.remove());
    document.body.style.overflow = "";
    delete (navigator as unknown as Record<string, unknown>).share;
    delete (navigator as unknown as Record<string, unknown>).canShare;
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

  it("shows the receipt inside the app instead of opening a window", async () => {
    const blob = pdfBlob();
    fetchBlob.mockResolvedValue({
      blob,
      filename: "comprobante_42.pdf",
    });
    const open = vi.spyOn(window, "open");

    await openReceiptPdf("sale-42");

    // S4.6: no popup, so no popup blocker and nothing to explain to the user.
    expect(open).not.toHaveBeenCalled();
    expect(createObjectURL.mock.calls[0]?.[0]).toBe(blob);

    const sheet = screen.getByRole("dialog", { name: "Comprobante de venta" });
    const frame = sheet.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame).toHaveAttribute("title", "Comprobante de venta");
    expect(frame).toHaveAttribute("src", "blob:receipt");
  });

  it("closes the receipt, frees the blob and returns focus", async () => {
    fetchBlob.mockResolvedValue({ blob: pdfBlob(), filename: "comprobante_42.pdf" });
    const trigger = document.createElement("button");
    trigger.textContent = "Ver comprobante";
    document.body.appendChild(trigger);
    trigger.focus();

    await openReceiptPdf("sale-42");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar comprobante" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt");
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("closes the receipt on Escape", async () => {
    fetchBlob.mockResolvedValue({ blob: pdfBlob(), filename: "comprobante_42.pdf" });

    await openReceiptPdf("sale-42");
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:receipt");
  });

  it("wraps a failed receipt request and shows no sheet", async () => {
    fetchBlob.mockRejectedValue(new Error("500"));

    await expect(openReceiptPdf("sale-42")).rejects.toThrow(
      "Error al generar el comprobante",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shares the receipt as a PDF file so the system sheet can print it", async () => {
    fetchBlob.mockResolvedValue({
      blob: pdfBlob(),
      filename: "comprobante_42.pdf",
    });
    const share = vi.fn<(data: { files: File[]; title: string }) => Promise<void>>(
      () => Promise.resolve(),
    );
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: share,
    });

    await openReceiptPdf("sale-42");
    await userEvent.click(
      screen.getByRole("button", { name: "Imprimir o compartir" }),
    );

    expect(share).toHaveBeenCalledTimes(1);
    const payload = share.mock.calls[0][0];
    expect(payload.title).toBe("Comprobante de venta");
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("comprobante_42.pdf");
    expect(payload.files[0].type).toBe("application/pdf");
  });

  it("offers the PDF as a download when the browser cannot share files", async () => {
    fetchBlob.mockResolvedValue({
      blob: pdfBlob(),
      filename: "comprobante_42.pdf",
    });
    expect(typeof navigator.canShare).toBe("undefined");

    await openReceiptPdf("sale-42");

    expect(
      screen.queryByRole("button", { name: "Imprimir o compartir" }),
    ).toBeNull();
    const download = screen.getByRole("link", { name: "Descargar comprobante" });
    expect(download).toHaveAttribute("download", "comprobante_42.pdf");
    expect(download).toHaveAttribute("href", "blob:receipt");
  });

  it("treats a cancelled share as a cancel, not a failure", async () => {
    fetchBlob.mockResolvedValue({
      blob: pdfBlob(),
      filename: "comprobante_42.pdf",
    });
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: vi.fn(() => Promise.reject(abort)),
    });

    await openReceiptPdf("sale-42");
    await userEvent.click(
      screen.getByRole("button", { name: "Imprimir o compartir" }),
    );

    // Nothing to report: the user closed the share sheet on purpose.
    expect(saveBlob).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Comprobante de venta" })).toBeInTheDocument();
  });

  it("wraps backend failures in a user-facing message", async () => {
    fetchBlob.mockRejectedValue(new Error("500"));

    await expect(downloadReceiptPdf("sale-42")).rejects.toThrow(
      "Error al generar el comprobante",
    );
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
