import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const organizations = [
  {
    id: "org-a",
    name: "Org A",
    role: "ADMIN",
    plan: "BASIC",
    status: "ACTIVE",
  },
  {
    id: "org-b",
    name: "Org B",
    role: "MEMBER",
    plan: "PRO",
    status: "ACTIVE",
  },
];

describe("OrganizationSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders current organization with role and plan", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(
      <OrganizationSwitcher
        currentOrganizationId="org-a"
        onSwitch={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("Org A")).toBeInTheDocument();
    });

    expect(screen.getByText(/Administrador/)).toBeInTheDocument();
    expect(screen.getByText(/Básico/)).toBeInTheDocument();
  });

  it("opens the list and calls onSwitch with the selected organization", async () => {
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations },
    });

    render(
      <OrganizationSwitcher
        currentOrganizationId="org-a"
        onSwitch={onSwitch}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Cambiar organización/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText(/Cambiar organización/i));

    expect(screen.getByText("Org B")).toBeInTheDocument();
    expect(screen.getByText(/Miembro/)).toBeInTheDocument();
    expect(screen.getByText(/Pro/)).toBeInTheDocument();

    await userEvent.click(screen.getByText("Org B"));

    await waitFor(() => {
      expect(onSwitch).toHaveBeenCalledTimes(1);
      expect(onSwitch).toHaveBeenCalledWith("org-b");
    });
  });

  it("does not render when the user belongs to only one organization", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: [organizations[0]] },
    });

    const { container } = render(
      <OrganizationSwitcher
        currentOrganizationId="org-a"
        onSwitch={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("shows a loading state while fetching organizations", () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {})
    );

    render(
      <OrganizationSwitcher
        currentOrganizationId="org-a"
        onSwitch={vi.fn()}
      />,
      { wrapper }
    );

    expect(screen.getByText(/Cargando organizaciones/i)).toBeInTheDocument();
  });

  it("shows an error state when fetching organizations fails", async () => {
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error")
    );

    render(
      <OrganizationSwitcher
        currentOrganizationId="org-a"
        onSwitch={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(
        screen.getByText(/No se pudieron cargar las organizaciones/i)
      ).toBeInTheDocument();
    });
  });

  it("caps and scrolls a long organization list instead of growing the rail", async () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      id: `org-${index}`,
      name: `Organizacion ${index}`,
      role: "ADMIN",
      plan: "BASIC",
      status: "ACTIVE",
    }));
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { organizations: many },
    });

    render(
      <OrganizationSwitcher
        currentOrganizationId="org-0"
        onSwitch={vi.fn()}
        placement="up"
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Cambiar organización/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText(/Cambiar organización/i));

    const list = screen.getByTestId("organization-list");
    // Bounded height + its own scrollbar: 14 organizations never stretch the
    // rail, and the panel opens upward because the account block is at the end.
    expect(list).toHaveClass("overflow-y-auto");
    expect(list).toHaveClass("overscroll-contain");
    expect(list).toHaveAttribute("data-placement", "up");
    expect(screen.getByText("Organizacion 13")).toBeInTheDocument();
  });
});
