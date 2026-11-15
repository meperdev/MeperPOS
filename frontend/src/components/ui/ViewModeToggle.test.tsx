import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";

afterEach(() => {
  cleanup();
});

function getTrack() {
  const group = screen.getByRole("group", { name: "Cambiar vista" });
  return group.querySelector<HTMLElement>('[role="group"]');
}

describe("ViewModeToggle geometry", () => {
  it("is exactly the field height (h-9) with no clipping wrapper", () => {
    render(<ViewModeToggle value="grid" onChange={vi.fn()} />);

    const track = getTrack();
    expect(track).not.toBeNull();
    expect(track!.className).toContain("h-9");
    expect(track!.className).toContain("p-px");
    expect(track!.className).not.toContain("overflow-x-auto");
    expect(track!.className).not.toContain("max-w-full");
  });

  it("sizes each segment h-8 w-8 so the icon sits centred", () => {
    render(<ViewModeToggle value="grid" onChange={vi.fn()} />);

    for (const name of ["Vista en tarjeta", "Vista en lista"]) {
      const segment = screen.getByRole("button", { name });
      expect(segment.className).toContain("h-8");
      expect(segment.className).toContain("w-8");
    }
  });

  it("uses the shared raised-chip tokens for the active segment only", () => {
    render(<ViewModeToggle value="table" onChange={vi.fn()} />);

    const active = screen.getByRole("button", { name: "Vista en lista" });
    const idle = screen.getByRole("button", { name: "Vista en tarjeta" });
    expect(active.className).toContain("bg-card");
    expect(active.className).toContain("shadow-2xs");
    expect(active.className).toContain("border-border/60");
    expect(idle.className).toContain("border-transparent");
    expect(idle.className).not.toContain("bg-card");
  });
});

describe("ViewModeToggle behaviour", () => {
  it("reports the pressed view and emits the other mode on click", async () => {
    const onChange = vi.fn();
    render(<ViewModeToggle value="grid" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Vista en tarjeta" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Vista en lista" }).getAttribute("aria-pressed")).toBe("false");

    await userEvent.click(screen.getByRole("button", { name: "Vista en lista" }));
    expect(onChange).toHaveBeenCalledWith("table");
  });
});
