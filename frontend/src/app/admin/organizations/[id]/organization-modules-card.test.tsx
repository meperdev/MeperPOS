import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { state, update } = vi.hoisted(() => ({ state: { enabled: true }, update: vi.fn() }));
vi.mock("@/hooks/useAdmin", () => ({
  useOrganizationVehiclesModule: () => ({ data: state, isLoading: false, isError: false }),
  useUpdateOrganizationVehiclesModule: () => ({ mutate: update, isPending: false, isError: false }),
}));
import { OrganizationModulesCard } from "./organization-modules-card";

describe("OrganizationModulesCard", () => {
  it("lets SuperAdmin deactivate vehicles for the selected organization", () => {
    render(<OrganizationModulesCard organizationId="org-1" />);
    expect(screen.getByText("Vehículos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
    expect(update).toHaveBeenCalledWith({ id: "org-1", enabled: false });
  });
});
