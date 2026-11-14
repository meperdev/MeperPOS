import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "./layout";

const pushMock = vi.fn();
let pathname = "/admin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathname,
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

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

const superAdmin = {
  id: "u-1",
  name: "Owner",
  email: "owner@example.com",
  role: "SUPER_ADMIN",
};

function renderLayout() {
  return render(
    <AdminLayout>
      <p>Contenido</p>
    </AdminLayout>,
  );
}

describe("AdminLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathname = "/admin";
    mockUseAuth.mockReturnValue({
      user: superAdmin,
      loading: false,
      logout: vi.fn(),
    });
  });

  it("keeps Panel and Organizaciones as peer sections and renders its children", () => {
    renderLayout();

    expect(screen.getByRole("link", { name: "Panel" })).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(screen.getByRole("link", { name: "Organizaciones" })).toHaveAttribute(
      "href",
      "/admin/organizations",
    );
    expect(screen.getByText("Contenido")).toBeInTheDocument();
  });

  it("adds Módulos at the same level as Panel and Organizaciones", () => {
    renderLayout();

    expect(screen.getByRole("link", { name: "Módulos" })).toHaveAttribute(
      "href",
      "/admin/modules",
    );
  });

  it("matches Panel only at /admin and marks child sections by prefix", () => {
    pathname = "/admin/organizations/org-1";
    renderLayout();

    expect(
      screen.getByRole("link", { name: "Organizaciones" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Panel" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Módulos" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks Módulos as the current section on its own route", () => {
    pathname = "/admin/modules/vehicles";
    renderLayout();

    expect(screen.getByRole("link", { name: "Módulos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Panel" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(
      screen.getByRole("link", { name: "Organizaciones" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("redirects users that are not SuperAdmin and renders nothing", () => {
    mockUseAuth.mockReturnValue({
      user: { ...superAdmin, role: "ADMIN" },
      loading: false,
      logout: vi.fn(),
    });

    const { container } = renderLayout();

    expect(pushMock).toHaveBeenCalledWith("/dashboard");
    expect(container).toBeEmptyDOMElement();
  });
});
