import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: unknown;
    children: React.ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : String(href)} {...rest}>
      {children}
    </a>
  ),
}));

const { mockUseOrganizationModules } = vi.hoisted(() => ({
  mockUseOrganizationModules: vi.fn(),
}));

// The card is a read-only summary: the module intentionally exposes no
// mutation hook, so any activation control would fail instead of silently
// duplicating the SuperAdmin > Módulos surface.
vi.mock("@/hooks/useAdmin", () => ({
  useOrganizationModules: (id: string) => mockUseOrganizationModules(id),
}));

import { OrganizationModulesCard } from "./organization-modules-card";

const vehicles = {
  id: "vehicles",
  name: "Vehículos",
  description: "Placas y modelos.",
  enabled: true,
};

const payroll = {
  id: "payroll",
  name: "Nómina",
  description: "Empleados y pagos.",
  enabled: false,
};

function moduleQuery(
  overrides: Partial<{
    data: typeof vehicles[];
    isLoading: boolean;
    isError: boolean;
    refetch: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    data: [vehicles, payroll],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderCard() {
  return render(<OrganizationModulesCard organizationId="org-1" />);
}

describe("OrganizationModulesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("summarizes every module the server reports, not just vehicles", () => {
    mockUseOrganizationModules.mockReturnValue(moduleQuery());

    renderCard();

    expect(mockUseOrganizationModules).toHaveBeenCalledWith("org-1");
    expect(screen.getByText("Vehículos")).toBeInTheDocument();
    expect(screen.getByText("Placas y modelos.")).toBeInTheDocument();
    expect(screen.getByText("Nómina")).toBeInTheDocument();
    expect(screen.getByText("Empleados y pagos.")).toBeInTheDocument();
  });

  it("links each module to its detail page instead of rendering activation controls", () => {
    mockUseOrganizationModules.mockReturnValue(moduleQuery());

    renderCard();

    expect(screen.getByRole("link", { name: /Vehículos/ })).toHaveAttribute(
      "href",
      "/admin/modules/vehicles",
    );
    expect(screen.getByRole("link", { name: /Nómina/ })).toHaveAttribute(
      "href",
      "/admin/modules/payroll",
    );
    expect(
      screen.queryByRole("button", { name: /^(Activar|Desactivar)/ }),
    ).toBeNull();
  });

  it("shows the server's active or inactive state for each module", () => {
    mockUseOrganizationModules.mockReturnValue(moduleQuery());

    renderCard();

    expect(screen.getAllByText("Activo")).toHaveLength(1);
    expect(screen.getAllByText("Inactivo")).toHaveLength(1);
  });

  it("links the card header to the SuperAdmin module administration", () => {
    mockUseOrganizationModules.mockReturnValue(moduleQuery());

    renderCard();

    expect(
      screen.getByRole("link", { name: /Administrar módulos/ }),
    ).toHaveAttribute("href", "/admin/modules");
  });

  it("keeps the loading message while the module state is fetched", () => {
    mockUseOrganizationModules.mockReturnValue(
      moduleQuery({ data: [], isLoading: true }),
    );

    renderCard();

    expect(screen.getByText("Cargando módulos…")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Vehículos/ })).toBeNull();
  });

  it("offers an honest retry when the module state fails to load", async () => {
    const refetch = vi.fn();
    mockUseOrganizationModules.mockReturnValue(
      moduleQuery({ data: [], isError: true, refetch }),
    );

    renderCard();

    expect(
      screen.getByText("No se pudieron cargar los módulos."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("says so when the server reports no modules for the organization", () => {
    mockUseOrganizationModules.mockReturnValue(
      moduleQuery({ data: [], isLoading: false }),
    );

    renderCard();

    expect(
      screen.getByText("No hay módulos disponibles para esta organización."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Vehículos/ })).toBeNull();
  });
});
