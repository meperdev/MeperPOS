import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModulesPage from "./page";

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

const { mockUseModuleCatalog } = vi.hoisted(() => ({
  mockUseModuleCatalog: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useModuleCatalog: () => mockUseModuleCatalog(),
}));

const vehicles = {
  id: "vehicles",
  name: "Vehículos",
  description: "Placas, modelos y vehículos asociados a cada cliente.",
};

describe("ModulesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the catalog returned by the server with a link to each module", () => {
    mockUseModuleCatalog.mockReturnValue({
      data: [vehicles],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ModulesPage />);

    expect(screen.getByRole("heading", { name: "Módulos" })).toBeInTheDocument();
    expect(screen.getByText("Vehículos")).toBeInTheDocument();
    expect(screen.getByText(vehicles.description)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Vehículos/ })).toHaveAttribute(
      "href",
      "/admin/modules/vehicles",
    );
  });

  it("shows a loading state while the catalog is fetched", () => {
    mockUseModuleCatalog.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ModulesPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Cargando módulos...");
  });

  it("offers a retry when the catalog request fails", async () => {
    const refetch = vi.fn();
    mockUseModuleCatalog.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<ModulesPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los módulos.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows an empty catalog without inventing modules", () => {
    mockUseModuleCatalog.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ModulesPage />);

    expect(screen.getByText("No hay módulos disponibles")).toBeInTheDocument();
    expect(screen.queryByText("Vehículos")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
