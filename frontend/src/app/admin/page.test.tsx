import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminPage from "./page";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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

const { mockMetrics, mockOrganizations } = vi.hoisted(() => ({
  mockMetrics: vi.fn(),
  mockOrganizations: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useAdminMetrics: () => mockMetrics(),
  useOrganizations: () => mockOrganizations(),
}));

const metrics = {
  totalOrganizations: 4,
  activeOrganizations: 2,
  trialOrganizations: 1,
  pastDueOrganizations: 0,
  suspendedOrganizations: 1,
  trialExpiringSoon: 1,
  trialExpired: 0,
  billingOverdue: 0,
  newOrganizationsThisMonth: 2,
  totalUsers: 30,
  activeUsers: 24,
  organizationsByPlan: { BASIC: 3, PRO: 1 },
};

const attentionOrg = {
  id: "org-9",
  name: "Panadería Sur",
  slug: "panaderia-sur",
  status: "ACTIVE",
  plan: "BASIC",
  trialEndsAt: null,
  billingStatus: "OVERDUE",
  taxId: null,
  phone: null,
  address: null,
  active: true,
  createdAt: "2026-01-15T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
  userCount: 2,
};

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMetrics.mockReturnValue({ data: metrics, isLoading: false, isError: false, refetch: vi.fn() });
    mockOrganizations.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it("renders the KPI strip with context", () => {
    render(<AdminPage />);

    expect(screen.getByText("Organizaciones")).toBeInTheDocument();
    expect(screen.getByText("2 nuevas este mes")).toBeInTheDocument();
    expect(screen.getByText("Usuarios activos")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("de 30 cuentas")).toBeInTheDocument();
  });

  it("links each risk KPI to its filtered list", () => {
    render(<AdminPage />);

    expect(screen.getByRole("link", { name: /Suspendidas/ })).toHaveAttribute(
      "href",
      "/admin/organizations?status=SUSPENDED",
    );
    expect(screen.getByRole("link", { name: /En mora/ })).toHaveAttribute(
      "href",
      "/admin/organizations?status=PAST_DUE",
    );
  });

  it("lists the tenants that need attention with a link to each one", () => {
    mockOrganizations.mockReturnValue({
      data: [attentionOrg],
      isLoading: false,
      isError: false,
    });

    render(<AdminPage />);

    expect(screen.getByText("Panadería Sur")).toBeInTheDocument();
    expect(screen.getByText("Facturación en mora")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Panadería Sur/ })).toHaveAttribute(
      "href",
      "/admin/organizations/org-9",
    );
  });

  it("reports a quiet queue when nothing needs attention", () => {
    render(<AdminPage />);

    expect(
      screen.getByText("Ninguna organización requiere atención."),
    ).toBeInTheDocument();
  });
});
