import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/ui/Modal", () => ({
  Modal: ({
    children,
    title,
    size,
    footer,
  }: {
    children: React.ReactNode;
    title: string;
    size?: string;
    footer?: React.ReactNode;
  }) => (
    <section data-testid="taxonomy-modal" data-size={size}>
      <h2>{title}</h2>
      {children}
      {footer}
    </section>
  ),
}));
vi.mock("@/hooks/useExpenses", () => ({
  useExpenseGroups: () => ({ data: [
    { id: "g1", name: "Gastos del local", active: true, labels: [{ id: "l1", name: "Arriendo", active: true }] },
    { id: "g2", name: "Servicios", active: true, labels: [] },
  ] }),
  useCreateExpenseGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateExpenseGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteExpenseGroup: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateExpenseLabel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateExpenseLabel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteExpenseLabel: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import { ExpenseTaxonomyModal } from "./ExpenseTaxonomyModal";

// Locate layout boundaries by their contents, not class names or parent depth.
function sharedContainer(root: HTMLElement, ...contents: HTMLElement[]) {
  const candidates = Array.from(root.querySelectorAll("div")).filter((element) =>
    contents.every((content) => element.contains(content)),
  );
  const container = candidates.find((candidate) =>
    !candidates.some((other) => other !== candidate && candidate.contains(other)),
  );
  if (!container) throw new Error("No shared layout container found");
  return container;
}

describe("ExpenseTaxonomyModal", () => {
  it("renders groups and nested labels for an administrator", () => {
    render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText("Gastos del local")).toBeInTheDocument();
    expect(screen.getByText("Arriendo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /nuevo grupo/i })).toBeInTheDocument();
  });

  it("requests an extra-large modal", () => {
    render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId("taxonomy-modal")).toHaveAttribute("data-size", "xl");
  });

  it("stacks new-group controls on mobile and arranges them in a row from sm", () => {
    const { container } = render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);
    const newGroupControls = sharedContainer(
      container,
      screen.getByRole("textbox", { name: "Nuevo grupo" }),
      screen.getByRole("button", { name: /nuevo grupo/i }),
    );
    expect(newGroupControls).toHaveClass("flex", "flex-col", "sm:flex-row");
  });

  it("lays out group cards in two columns from md without minimum-width overflow", () => {
    const { container } = render(<ExpenseTaxonomyModal isOpen onClose={vi.fn()} />);
    const premisesHeading = screen.getByRole("heading", { name: "Gastos del local" });
    const servicesHeading = screen.getByRole("heading", { name: "Servicios" });
    const groupCards = sharedContainer(container, premisesHeading, servicesHeading);
    const premisesCard = Array.from(groupCards.children).find((card) => card.contains(premisesHeading));
    const servicesCard = Array.from(groupCards.children).find((card) => card.contains(servicesHeading));
    expect(groupCards).toHaveClass("grid", "grid-cols-1", "md:grid-cols-2");
    expect(premisesCard).toHaveClass("min-w-0");
    expect(servicesCard).toHaveClass("min-w-0");
  });
});
