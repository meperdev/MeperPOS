import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrganizationSelectModal } from "./OrganizationSelectModal";

describe("OrganizationSelectModal", () => {
  const organizations = [
    { id: "org-1", name: "Org One", role: "ADMIN", plan: "BASIC" },
    { id: "org-2", name: "Org Two", role: "CASHIER", plan: "PRO" },
  ];

  it("renders list of organizations", () => {
    render(
      <OrganizationSelectModal
        organizations={organizations}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText("Org One")).toBeInTheDocument();
    expect(screen.getByText("Org Two")).toBeInTheDocument();
    expect(screen.getByText("Selecciona una organización")).toBeInTheDocument();
  });

  it("calls onSelect with correct organization id when clicked", () => {
    const onSelect = vi.fn();
    render(
      <OrganizationSelectModal
        organizations={organizations}
        onSelect={onSelect}
      />
    );

    const orgTwoButton = screen.getByText("Org Two").closest("button");
    expect(orgTwoButton).toBeTruthy();

    fireEvent.click(orgTwoButton!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("org-2");
  });

  it("does not render a close button", () => {
    render(
      <OrganizationSelectModal
        organizations={organizations}
        onSelect={vi.fn()}
      />
    );

    const closeButtons = screen.queryAllByRole("button").filter((btn) => {
      const ariaLabel = btn.getAttribute("aria-label");
      return ariaLabel?.toLowerCase().includes("close");
    });

    expect(closeButtons).toHaveLength(0);
  });
});
