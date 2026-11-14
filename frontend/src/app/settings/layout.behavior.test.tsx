import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/general",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    scroll?: boolean;
  }) => (
    <a
      href={href}
      data-scroll={scroll === false ? "false" : "true"}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import SettingsLayout from "./layout";

describe("settings sub-sidebar layout", () => {
  it("renders all approved settings sections as links", () => {
    render(
      <SettingsLayout>
        <div>Contenido</div>
      </SettingsLayout>
    );

    expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Facturación y recibos" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Equipo y acceso" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "/settings/whatsapp"
    );
    expect(screen.getByRole("link", { name: "Importar y exportar datos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Suscripción" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Avanzado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Facturación" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Localización" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Moneda y Región" })).not.toBeInTheDocument();
  });

  it("marks the active section and navigates without scrolling the page", () => {
    render(
      <SettingsLayout>
        <div>Contenido</div>
      </SettingsLayout>
    );

    const generalLink = screen.getByRole("link", { name: "General" });
    expect(generalLink).toHaveAttribute("aria-current", "page");
    expect(generalLink).toHaveAttribute("data-scroll", "false");

    const invoicingLink = screen.getByRole("link", {
      name: "Facturación y recibos",
    });
    expect(invoicingLink).not.toHaveAttribute("aria-current");
    expect(invoicingLink).toHaveAttribute("data-scroll", "false");
  });
});
