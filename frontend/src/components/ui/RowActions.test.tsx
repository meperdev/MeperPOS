import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RowActions } from "@/components/ui/RowActions";

afterEach(cleanup);

describe("RowActions touch targets (S3.2)", () => {
  it("gives the trigger a 44px hit area on phones", () => {
    render(<RowActions items={[{ label: "Editar", onSelect: vi.fn() }]} />);

    const trigger = screen.getByRole("button", { name: "Más acciones" });
    expect(trigger.className).toContain("max-sm:h-11");
    expect(trigger.className).toContain("max-sm:w-11");
    // Desktop keeps its 36px rail control.
    expect(trigger.className).toContain("h-9");
    expect(trigger.className).toContain("w-9");
  });

  it("gives every menu row a 44px row on phones", async () => {
    render(
      <RowActions
        items={[
          { label: "Editar", onSelect: vi.fn() },
          { kind: "separator" },
          { label: "Desactivar", onSelect: vi.fn(), destructive: true },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Más acciones" }));

    for (const name of ["Editar", "Desactivar"]) {
      const item = await screen.findByRole("menuitem", { name });
      expect(item.className).toContain("max-sm:min-h-11");
    }
  });
});
