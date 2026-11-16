import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getBogotaDateInputValue } from "@/lib/utils";
import { reportPeriodPresets } from "@/lib/reportPresentation";
import { PeriodFilter } from "./PeriodFilter";

afterEach(cleanup);

const today = getBogotaDateInputValue();
const presets = reportPeriodPresets(today);

function renderFilter(overrides: Partial<Parameters<typeof PeriodFilter>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <PeriodFilter
      presets={presets}
      startDate={presets[2].startDate}
      endDate={presets[2].endDate}
      appliedLabel="1 mar 2026 - 15 mar 2026"
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange };
}

describe("filtro de período", () => {
  it("offers only ranges with an explicit window and marks Este mes as active", () => {
    renderFilter();

    for (const preset of presets) {
      expect(screen.getByRole("button", { name: preset.label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Todo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Este mes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("sends the preset window when a preset is chosen", () => {
    const { onChange } = renderFilter();

    fireEvent.click(screen.getByRole("button", { name: "Últimos 30 días" }));

    const last30 = presets.find((preset) => preset.id === "last30")!;
    expect(onChange).toHaveBeenCalledWith({
      startDate: last30.startDate,
      endDate: last30.endDate,
    });
  });

  it("keeps a custom range ordered instead of sending an inverted window", () => {
    const { onChange } = renderFilter({
      startDate: "2026-03-10",
      endDate: "2026-03-15",
    });

    fireEvent.change(screen.getByLabelText("Hasta"), {
      target: { value: "2026-03-01" },
    });

    expect(onChange).toHaveBeenCalledWith({
      startDate: "2026-03-01",
      endDate: "2026-03-10",
    });
  });
});
