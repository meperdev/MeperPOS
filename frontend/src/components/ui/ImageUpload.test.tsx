import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ImageUpload } from "./ImageUpload";

const error = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ error }) }));

function Draft({ initial = "/images/old.jpg" }: { initial?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [value, setValue] = useState(initial);
  return <ImageUpload value={value} file={file} onFileChange={setFile} onChange={setValue} />;
}

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:local-preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  error.mockClear();
});
afterEach(cleanup);

describe("ImageUpload", () => {
  it("previews a controlled file locally, offers visible replace/remove, and revokes its URL on removal", async () => {
    render(<Draft />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(screen.getByRole("img", { name: "Preview" })).toHaveAttribute("src", expect.stringContaining("old.jpg"));
    fireEvent.change(input, { target: { files: [new File(["photo"], "new.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByRole("img", { name: "Preview" })).toHaveAttribute("src", "blob:local-preview"));
    expect(screen.getByRole("button", { name: "Cambiar" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(screen.queryByRole("img", { name: "Preview" })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
  });

  it("rejects invalid controlled selections without replacing the existing image", () => {
    render(<Draft />);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File(["text"], "note.txt", { type: "text/plain" })] } });
    expect(error).toHaveBeenCalledOnce();
    expect(screen.getByRole("img", { name: "Preview" })).toHaveAttribute("src", expect.stringContaining("old.jpg"));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("preserves the immediate upload callback for expense receipts", async () => {
    const upload = vi.fn().mockResolvedValue("/receipts/new.jpg");
    const change = vi.fn();
    render(<ImageUpload value="/receipts/old.jpg" onChange={change} onUpload={upload} />);
    const file = new File(["photo"], "receipt.png", { type: "image/png" });
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(change).toHaveBeenCalledWith("/receipts/new.jpg"));
    expect(upload).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: "Cambiar" })).toBeInTheDocument();
  });

  it("keeps the default variant markup: square preview and visible text buttons", () => {
    const { container } = render(<ImageUpload value="/images/old.jpg" onChange={vi.fn()} />);
    expect(container.firstElementChild).toHaveClass("space-y-2");
    expect(container.querySelector(".aspect-square")).not.toBeNull();
    expect(container.innerHTML).not.toContain("aspect-[4/3]");
    expect(screen.getByRole("button", { name: "Cambiar" })).toHaveTextContent("Cambiar");
    expect(screen.getByRole("button", { name: "Eliminar" })).toHaveTextContent("Eliminar");
  });

  it("keeps the default empty dropzone square", () => {
    render(<ImageUpload onChange={vi.fn()} />);
    const dropzone = screen.getByRole("button", { name: /Seleccionar imagen/ });
    expect(dropzone).toHaveClass("aspect-square");
    expect(dropzone.className).not.toContain("aspect-[4/3]");
  });

  describe("hero variant", () => {
    it("renders a 4:3 / md:aspect-square preview with icon-only overlay buttons and no gradients or blur", () => {
      const change = vi.fn();
      const { container } = render(<ImageUpload variant="hero" value="/images/old.jpg" onChange={change} />);
      const preview = screen.getByRole("img", { name: "Preview" }).parentElement!;
      expect(preview).toHaveClass("aspect-[4/3]", "md:aspect-square", "rounded-2xl", "overflow-hidden", "border", "border-border");
      expect(preview).not.toHaveClass("aspect-square");
      expect(container.firstElementChild).not.toHaveClass("space-y-2");

      const replace = screen.getByRole("button", { name: "Cambiar" });
      const remove = screen.getByRole("button", { name: "Eliminar" });
      expect(replace).toHaveAttribute("type", "button");
      expect(remove).toHaveAttribute("type", "button");
      expect(replace).toHaveAttribute("title", "Cambiar");
      expect(remove).toHaveAttribute("title", "Eliminar");
      expect(replace.textContent?.trim()).toBe("");
      expect(remove.textContent?.trim()).toBe("");
      expect(replace.parentElement).toHaveClass("absolute", "bottom-2", "right-2", "z-10", "flex", "gap-1.5");
      expect(preview).toContainElement(replace);

      expect(container.innerHTML).not.toContain("backdrop-");
      expect(container.innerHTML).not.toMatch(/gradient/);

      fireEvent.click(remove);
      expect(change).toHaveBeenCalledWith("");
    });

    it("honors disabled on the overlay buttons", () => {
      render(<ImageUpload variant="hero" value="/images/old.jpg" onChange={vi.fn()} disabled />);
      expect(screen.getByRole("button", { name: "Cambiar" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Eliminar" })).toBeDisabled();
    });

    it("renders the empty dropzone with the same aspect and copy", () => {
      const { container } = render(<ImageUpload variant="hero" onChange={vi.fn()} />);
      const dropzone = screen.getByRole("button", { name: /Seleccionar imagen/ });
      expect(dropzone).toHaveClass("aspect-[4/3]", "md:aspect-square", "rounded-2xl", "border-dashed", "w-full");
      expect(dropzone).not.toHaveClass("aspect-square");
      expect(screen.getByText("Seleccionar imagen")).toBeInTheDocument();
      expect(screen.getByText("JPG, PNG, GIF o WEBP · Máx. 5 MB")).toBeInTheDocument();
      expect(container.innerHTML).not.toContain("backdrop-");
      expect(container.innerHTML).not.toMatch(/gradient/);
    });

    it("still selects a file through the hidden input", async () => {
      const select = vi.fn();
      render(<ImageUpload variant="hero" file={null} onFileChange={select} onChange={vi.fn()} />);
      const file = new File(["photo"], "new.png", { type: "image/png" });
      fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } });
      await waitFor(() => expect(select).toHaveBeenCalledWith(file));
    });
  });
});
