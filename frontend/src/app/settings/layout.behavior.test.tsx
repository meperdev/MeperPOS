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

  it("switches to side-by-side by the shell's container width, not the viewport", () => {
    render(
      <SettingsLayout>
        <div>Contenido</div>
      </SettingsLayout>
    );

    const nav = screen.getByRole("navigation", {
      name: "Secciones de configuración",
    });
    const shell = nav.parentElement!;
    // A container query never matches the element that is itself the container, so
    // @container must sit on an ancestor of the element whose layout switches.
    expect(shell.className).not.toContain("@container");
    expect(shell.parentElement!.className).toContain("@container");
    expect(shell.className).toContain("flex-col");
    expect(shell.className).toContain("@4xl:flex-row");
    expect(shell.className).not.toContain("lg:flex-row");

    expect(nav.className).toContain("@4xl:w-56");
    expect(nav.className).toContain("@4xl:shrink-0");
    expect(nav.className).not.toContain("lg:w-56");

    const list = nav.querySelector("ul")!;
    expect(list.className).toContain("flex-wrap");
    expect(list.className).toContain("@4xl:flex-col");
    expect(list.className).toContain("@4xl:sticky");
    expect(list.className).not.toContain("lg:flex-col");

    const link = screen.getByRole("link", { name: "General" });
    expect(link.className).toContain("inline-flex");
    expect(link.className).toContain("@4xl:flex");
    expect(link.className).not.toContain("lg:flex");

    const content = screen.getByText("Contenido").parentElement!;
    expect(content.className).toContain("min-w-0");
    expect(content.className).toContain("@4xl:mt-0");
    expect(content.className).not.toContain("lg:mt-0");
  });
});
