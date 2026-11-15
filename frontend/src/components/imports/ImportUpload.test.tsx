import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImportUpload } from "./ImportUpload";

function makeXlsx(name = "import.xlsx"): File {
  return new File(["xlsx"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("ImportUpload", () => {
  it("renders the dropzone instructions and supports .xlsx only", () => {
    render(<ImportUpload selectedFile={null} onFileSelected={vi.fn()} onClear={vi.fn()} />);

    expect(screen.getByText(/Arrastra un archivo o haz clic para subir/i)).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.accept).toBe(".xlsx");
  });

  it("calls onFileSelected when a file is picked through the input", () => {
    const onFileSelected = vi.fn();
    render(<ImportUpload selectedFile={null} onFileSelected={onFileSelected} onClear={vi.fn()} />);

    const file = makeXlsx();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledOnce();
    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("calls onFileSelected when a file is dropped", () => {
    const onFileSelected = vi.fn();
    render(<ImportUpload selectedFile={null} onFileSelected={onFileSelected} onClear={vi.fn()} />);

    const dropzone = screen.getByText(/Arrastra un archivo o haz clic para subir/i).closest("label")!;
    const file = makeXlsx();
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledOnce();
    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("shows the selected file and calls onClear when cleared", () => {
    const onClear = vi.fn();
    render(
      <ImportUpload
        selectedFile={makeXlsx("inventario.xlsx")}
        onFileSelected={vi.fn()}
        onClear={onClear}
      />,
    );

    expect(screen.getByText("inventario.xlsx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Limpiar/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("renders a validation error when one is provided", () => {
    render(
      <ImportUpload
        selectedFile={null}
        onFileSelected={vi.fn()}
        onClear={vi.fn()}
        error="Solo se admiten archivos .xlsx"
      />,
    );

    expect(screen.getByText("Solo se admiten archivos .xlsx")).toBeInTheDocument();
  });
});
