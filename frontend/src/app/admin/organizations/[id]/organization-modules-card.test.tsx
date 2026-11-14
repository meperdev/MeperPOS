import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { update, modules } = vi.hoisted(() => ({
  update: vi.fn(),
  modules: [
    { id: "vehicles", name: "Vehículos", description: "Placas y modelos.", enabled: true },
    { id: "payroll", name: "Nómina", description: "Empleados y pagos.", enabled: false },
  ],
}));
vi.mock("@/hooks/useAdmin", () => ({
  useOrganizationModules: () => ({ data: modules, isLoading: false, isError: false }),
  useUpdateOrganizationModule: () => ({ mutate: update, isPending: false, isError: false }),
}));
import { OrganizationModulesCard } from "./organization-modules-card";

describe("OrganizationModulesCard", () => {
  it("renders every module the catalog returns, not just vehicles", () => {
    render(<OrganizationModulesCard organizationId="org-1" />);
    expect(screen.getByText("Vehículos")).toBeTruthy();
    expect(screen.getByText("Nómina")).toBeTruthy();
  });

  it("toggles the module the SuperAdmin picked by its own id", () => {
    render(<OrganizationModulesCard organizationId="org-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Desactivar Vehículos" }));
    expect(update).toHaveBeenCalledWith({ id: "org-1", moduleId: "vehicles", enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Activar Nómina" }));
    expect(update).toHaveBeenCalledWith({ id: "org-1", moduleId: "payroll", enabled: true });
  });
});
