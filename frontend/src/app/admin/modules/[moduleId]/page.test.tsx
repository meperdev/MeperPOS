import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ModuleDetailPage from "./page";

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

const {
  mockUseModuleCatalog,
  mockUseOrganizations,
  mockUseUpdateOrganizationModule,
  toastSuccess,
  toastError,
} = vi.hoisted(() => ({
  mockUseModuleCatalog: vi.fn(),
  mockUseOrganizations: vi.fn(),
  mockUseUpdateOrganizationModule: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useModuleCatalog: () => mockUseModuleCatalog(),
  useOrganizations: () => mockUseOrganizations(),
  useUpdateOrganizationModule: () => mockUseUpdateOrganizationModule(),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}));

const vehicles = {
  id: "vehicles",
  name: "Vehículos",
  description: "Placas, modelos y vehículos asociados a cada cliente.",
};

type MockOrganization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  trialEndsAt: string | null;
  billingStatus: string | null;
  taxId: string | null;
  phone: string | null;
  address: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  enabledModules?: string[];
  userCount?: number;
};

function org(overrides: Partial<MockOrganization> = {}): MockOrganization {
  return {
    id: "org-1",
    name: "Cafetería Demo",
    slug: "cafeteria-demo",
    status: "ACTIVE",
    plan: "PRO",
    trialEndsAt: null,
    billingStatus: "PAID",
    taxId: null,
    phone: null,
    address: null,
    active: true,
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    enabledModules: ["vehicles"],
    userCount: 4,
    ...overrides,
  };
}

function setupCatalog(overrides: Record<string, unknown> = {}) {
  mockUseModuleCatalog.mockReturnValue({
    data: [vehicles],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
}

function setupOrganizations(
  data: MockOrganization[] | undefined,
  overrides: Record<string, unknown> = {},
) {
  mockUseOrganizations.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
}

function setupMutation(overrides: Record<string, unknown> = {}) {
  mockUseUpdateOrganizationModule.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
    ...overrides,
  });
}

async function renderPageWithResult(moduleId = "vehicles") {
  const params = Promise.resolve({ moduleId });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<ModuleDetailPage params={params} />);
  });
  return { view, params };
}

async function renderPage(moduleId = "vehicles") {
  await renderPageWithResult(moduleId);
}

function paginatedOrganizations() {
  return Array.from({ length: 11 }, (_, index) =>
    org({
      id: `org-${index + 1}`,
      name: `Empresa ${String(index + 1).padStart(2, "0")}`,
      slug: `empresa-${index + 1}`,
      enabledModules: ["vehicles"],
    }),
  );
}

describe("ModuleDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCatalog();
    setupOrganizations([org()]);
    setupMutation();
  });

  it("renders the real catalog module and the server state of each organization", async () => {
    setupOrganizations([
      org({ id: "org-1", name: "Cafetería Demo", slug: "cafeteria-demo" }),
      org({
        id: "org-2",
        name: "Tienda Norte",
        slug: "tienda-norte",
        status: "SUSPENDED",
        enabledModules: [],
      }),
      org({
        id: "org-3",
        name: "Panadería Sur",
        slug: "panaderia-sur",
        status: "TRIAL",
        enabledModules: undefined,
      }),
    ]);

    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Vehículos" }),
    ).toBeInTheDocument();
    expect(screen.getByText(vehicles.description)).toBeInTheDocument();
    expect(screen.getByText("Cafetería Demo")).toBeInTheDocument();
    expect(screen.getByText("cafeteria-demo")).toBeInTheDocument();
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.getByText("tienda-norte")).toBeInTheDocument();
    expect(screen.getByText("Activa")).toBeInTheDocument();
    expect(screen.getByText("Suspendida")).toBeInTheDocument();
    expect(screen.getByText("En prueba")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(screen.getByText("No disponible")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Vehículos" });
    expect(
      within(heading.parentElement as HTMLElement).getByText("3"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Desactivar Vehículos en Cafetería Demo",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Activar Vehículos en Tienda Norte" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /Panadería Sur/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Sin datos del servidor")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver a módulos/ })).toHaveAttribute(
      "href",
      "/admin/modules",
    );
  });

  it("shows an honest not-found for a module outside the catalog", async () => {
    setupOrganizations([org()]);

    await renderPage("payroll");

    expect(screen.getByText("Módulo no encontrado")).toBeInTheDocument();
    expect(
      screen.getByText("Este módulo no existe en el catálogo."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Vehículos" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Cafetería Demo")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Volver a módulos/ })).toHaveAttribute(
      "href",
      "/admin/modules",
    );
  });

  it("shows a catalog loading state before the module is known", async () => {
    setupCatalog({ data: undefined, isLoading: true });
    setupOrganizations(undefined, { data: undefined, isLoading: true });

    await renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Cargando módulo…");
  });

  it("shows an organization loading state once the module is known", async () => {
    setupOrganizations(undefined, { data: undefined, isLoading: true });

    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Vehículos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Cargando organizaciones…",
    );
  });

  it("offers a retry when the catalog fails", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    setupCatalog({ data: undefined, isLoading: false, isError: true, refetch });

    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo cargar el catálogo de módulos.",
    );
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when the organization list fails", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    setupOrganizations(undefined, {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar las organizaciones.",
    );
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an empty organization collection from empty filters", async () => {
    setupOrganizations([]);

    await renderPage();

    expect(screen.getByText("No hay organizaciones")).toBeInTheDocument();
    expect(
      screen.queryByText("Ninguna organización coincide con los filtros"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("matches organization names and slugs ignoring case and accents", async () => {
    const user = userEvent.setup();
    setupOrganizations([
      org({ id: "org-1", name: "Cafetería Demo", slug: "cafeteria-demo" }),
      org({ id: "org-2", name: "Tienda Norte", slug: "tienda-norte" }),
    ]);

    await renderPage();

    const search = screen.getByRole("searchbox");
    await user.type(search, "CAFETERIA");
    expect(screen.getByText("Cafetería Demo")).toBeInTheDocument();
    expect(screen.queryByText("Tienda Norte")).not.toBeInTheDocument();
    expect(screen.getByText("1 de 2")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "TIENDA-NORTE");
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.queryByText("Cafetería Demo")).not.toBeInTheDocument();
  });

  it("filters organizations by the authoritative module state", async () => {
    const user = userEvent.setup();
    setupOrganizations([
      org({
        id: "org-1",
        name: "Cafetería Demo",
        enabledModules: ["vehicles"],
      }),
      org({ id: "org-2", name: "Tienda Norte", enabledModules: [] }),
      org({ id: "org-3", name: "Panadería Sur", enabledModules: undefined }),
    ]);

    await renderPage();

    await user.click(screen.getByRole("button", { name: "Todos" }));
    await user.click(screen.getByText("Activados"));
    expect(screen.getByText("Cafetería Demo")).toBeInTheDocument();
    expect(screen.queryByText("Tienda Norte")).not.toBeInTheDocument();
    expect(screen.queryByText("Panadería Sur")).not.toBeInTheDocument();
    expect(screen.getByText("1 de 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Activados" }));
    await user.click(screen.getByText("Desactivados"));
    expect(screen.queryByText("Cafetería Demo")).not.toBeInTheDocument();
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.queryByText("Panadería Sur")).not.toBeInTheDocument();
    expect(screen.getByText("1 de 3")).toBeInTheDocument();
  });

  it("retains the query on no results and restores the list with the clear control", async () => {
    const user = userEvent.setup();
    setupOrganizations([
      org({ id: "org-1", name: "Cafetería Demo" }),
      org({ id: "org-2", name: "Tienda Norte", enabledModules: [] }),
    ]);

    await renderPage();

    const search = screen.getByRole("searchbox");
    await user.type(search, "zzz");
    expect(
      screen.getByText("Ninguna organización coincide con los filtros"),
    ).toBeInTheDocument();
    expect(search).toHaveValue("zzz");
    expect(screen.getByText("0 de 2")).toBeInTheDocument();

    const clear = screen.getByRole("button", { name: "Limpiar" });
    expect(clear).toBeEnabled();
    await user.click(clear);
    expect(search).toHaveValue("");
    expect(screen.getByText("Cafetería Demo")).toBeInTheDocument();
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeDisabled();
  });

  it("paginates with the shared page size and resets when a filter narrows the list", async () => {
    const user = userEvent.setup();
    setupOrganizations(paginatedOrganizations());

    await renderPage();

    expect(screen.getByText("Empresa 01")).toBeInTheDocument();
    expect(screen.queryByText("Empresa 11")).not.toBeInTheDocument();
    expect(screen.getByText(/Mostrando/)).toHaveTextContent(
      "Mostrando 1 - 10 de 11",
    );

    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(screen.getByText("Empresa 11")).toBeInTheDocument();
    expect(screen.queryByText("Empresa 01")).not.toBeInTheDocument();

    await user.type(screen.getByRole("searchbox"), "Empresa 01");
    expect(screen.getByText("Empresa 01")).toBeInTheDocument();
    expect(screen.queryByText("Empresa 11")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  it("clamps the current page when the organization list shrinks", async () => {
    const user = userEvent.setup();
    const organizations = paginatedOrganizations();
    setupOrganizations(organizations);
    const { view, params } = await renderPageWithResult();

    await user.click(screen.getByRole("button", { name: /Siguiente/ }));
    expect(screen.getByText("Empresa 11")).toBeInTheDocument();

    setupOrganizations(organizations.slice(0, 2));
    await act(async () => {
      view.rerender(<ModuleDetailPage params={params} />);
    });

    expect(screen.getByText("Empresa 01")).toBeInTheDocument();
    expect(screen.getByText("Empresa 02")).toBeInTheDocument();
    expect(screen.queryByText("Empresa 11")).not.toBeInTheDocument();
    expect(screen.getByText(/Mostrando/)).toHaveTextContent(
      "Mostrando 1 - 2 de 2",
    );
  });

  it("saves only the chosen organization with the inverse module state", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({});
    setupMutation({ mutateAsync });
    setupOrganizations([
      org({
        id: "org-1",
        name: "Cafetería Demo",
        enabledModules: ["vehicles"],
      }),
      org({ id: "org-2", name: "Tienda Norte", enabledModules: [] }),
    ]);

    await renderPage();

    await user.click(
      screen.getByRole("button", { name: "Activar Vehículos en Tienda Norte" }),
    );
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: "org-2",
      moduleId: "vehicles",
      enabled: true,
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Se activó el módulo Vehículos en Tienda Norte",
      ),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Desactivar Vehículos en Cafetería Demo",
      }),
    );
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: "org-1",
      moduleId: "vehicles",
      enabled: false,
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Se desactivó el módulo Vehículos en Cafetería Demo",
    );
  });

  it("disables the actions while a change is pending", async () => {
    setupMutation({ isPending: true });
    setupOrganizations([
      org({
        id: "org-1",
        name: "Cafetería Demo",
        enabledModules: ["vehicles"],
      }),
      org({ id: "org-2", name: "Tienda Norte", enabledModules: [] }),
    ]);

    await renderPage();

    expect(
      screen.getByRole("button", {
        name: "Desactivar Vehículos en Cafetería Demo",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Activar Vehículos en Tienda Norte" }),
    ).toBeDisabled();
  });

  it("reports a rejected change without claiming success", async () => {
    const user = userEvent.setup();
    let rejectRequest!: (error: unknown) => void;
    const mutateAsync = vi.fn(
      () =>
        new Promise<unknown>((_, reject) => {
          rejectRequest = reject;
        }),
    );
    setupMutation({ mutateAsync });
    setupOrganizations([
      org({ id: "org-1", name: "Tienda Norte", enabledModules: [] }),
    ]);

    await renderPage();

    const action = screen.getByRole("button", {
      name: "Activar Vehículos en Tienda Norte",
    });
    await user.click(action);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    await act(async () => {
      rejectRequest(new Error("boom"));
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "No se pudo actualizar el módulo Vehículos en Tienda Norte.",
      ),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("Inactivo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Activar Vehículos en Tienda Norte" }),
    ).toBeEnabled();
  });
});
