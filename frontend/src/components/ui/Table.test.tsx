import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Table, TableCell, TableHeader, TableRow } from "./Table";

afterEach(() => {
  cleanup();
});

function renderTable() {
  return render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableCell as="th">Producto</TableCell>
          <TableCell as="th" numeric>
            Total
          </TableCell>
        </TableRow>
      </TableHeader>
      <tbody>
        <TableRow>
          <TableCell>Arroz 1 kg</TableCell>
          <TableCell numeric>$ 12.450</TableCell>
        </TableRow>
      </tbody>
    </Table>,
  );
}

describe("Table type scale", () => {
  it("sets body cells at the body size and keeps header captions at the micro size", () => {
    renderTable();

    // The row the user reads is body content: one step above the caption.
    const bodyCell = screen.getByText("Arroz 1 kg");
    expect(bodyCell).toHaveClass("text-sm");
    expect(bodyCell).not.toHaveClass("text-xs");

    const moneyCell = screen.getByText("$ 12.450");
    expect(moneyCell).toHaveClass("text-sm");

    // A header caption is a micro-label and stays at the 12px floor.
    const headerCell = screen.getByText("Producto");
    expect(headerCell).toHaveClass("text-xs");
    expect(headerCell).not.toHaveClass("text-sm");
  });

  it("keeps the numeric alignment and the neutral header treatment", () => {
    renderTable();

    expect(screen.getByText("$ 12.450")).toHaveClass("text-right", "tabular-nums");
    expect(screen.getByText("Producto")).toHaveClass(
      "font-medium",
      "text-muted-foreground",
      "text-left",
    );
    // A numeric header is right-aligned like its column, so it never sets text-left.
    expect(screen.getByText("Total")).not.toHaveClass("text-left");
  });

  it("still renders a plain table at the body size when no variant is given", () => {
    const { container } = renderTable();

    expect(container.querySelector("table")).toHaveClass("w-full", "text-sm");
    expect(container.querySelector("thead")).toBeTruthy();
  });
});
