import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MetricCard } from "./MetricCard";

describe("MetricCard (DIA-5)", () => {
  it("renders label, value and helper", () => {
    render(
      <MetricCard label="Ventas hoy" value="$ 250.000" helper="del día" />,
    );

    expect(screen.getByText("Ventas hoy")).toBeTruthy();
    expect(screen.getByText("$ 250.000")).toBeTruthy();
    expect(screen.getByText("del día")).toBeTruthy();
  });

  it("renders a positive delta pill with its percentage", () => {
    render(
      <MetricCard
        label="Ventas"
        value="$ 100"
        helper="hoy"
        delta={{ percentage: 12.5 }}
      />,
    );

    expect(screen.getByText("+12.5%")).toBeTruthy();
  });

  it("does not render a delta pill when delta is absent", () => {
    render(<MetricCard label="Ventas" value="$ 100" helper="hoy" />);

    expect(screen.queryByText("+12.5%")).toBeNull();
    expect(screen.queryByText("Sin base")).toBeNull();
  });

  it("renders 'Sin base' with no trend arrow when the delta percentage is null", () => {
    const { container } = render(
      <MetricCard
        label="Ventas"
        value="$ 100"
        helper="hoy"
        delta={{ percentage: null }}
      />,
    );

    expect(screen.getByText("Sin base")).toBeTruthy();
    // With no baseline there is no direction to imply, so the pill must not
    // render a trend arrow (an up-arrow would read as growth).
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("applies the requested tone (data-tone) and defaults to neutral", () => {
    const { container } = render(
      <MetricCard label="A" value="1" helper="h" tone="rose" />,
    );
    const { container: neutral } = render(<MetricCard label="B" value="2" helper="h" />);

    expect(container.querySelector('[data-tone="rose"]')).toBeTruthy();
    expect(neutral.querySelector('[data-tone="neutral"]')).toBeTruthy();
  });

  it("renders a sparkline only when the sparkline prop is provided", () => {
    const { container: withSpark } = render(
      <MetricCard
        label="Ventas"
        value="$ 100"
        helper="hoy"
        tone="green"
        sparkline={[1, 2, 3, 4, 5, 6, 7]}
      />,
    );
    const { container: withoutSpark } = render(
      <MetricCard label="Ventas" value="$ 100" helper="hoy" tone="green" />,
    );

    expect(withSpark.querySelector('[data-testid="metric-sparkline"]')).toBeTruthy();
    expect(withoutSpark.querySelector('[data-testid="metric-sparkline"]')).toBeNull();
  });

  it("renders the neutral path with a sparkline without requiring a tone", () => {
    const { container } = render(
      <MetricCard label="Ventas" value="$ 100" helper="hoy" sparkline={[3, 1, 4]} />,
    );

    expect(container.querySelector('[data-tone="neutral"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="metric-sparkline"]')).toBeTruthy();
  });

  it("renders an action button and invokes its handler on click", async () => {
    const onClick = vi.fn();
    render(
      <MetricCard
        label="Stock crítico"
        value="2"
        helper="por reordenar"
        tone="rose"
        action={{ label: "Reordenar", onClick }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Reordenar" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not render an action button when no action is provided", () => {
    render(<MetricCard label="Ventas" value="$ 100" helper="hoy" />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("anchors the value under its label and pushes the helper footer to the bottom", () => {
    const { container } = render(
      <MetricCard label="Ventas hoy" value="$ 250.000" helper="del día" />,
    );

    // The defect was a stretched card that floated the value in the middle:
    // the root distributed the free space instead of anchoring label+value.
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("justify-between");

    const footer = screen.getByText("del día").closest("div") as HTMLElement;
    expect(footer.className).toContain("mt-auto");
  });
});
