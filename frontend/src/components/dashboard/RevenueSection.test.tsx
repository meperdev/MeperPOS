import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  chartProps: vi.fn(),
  paymentProps: vi.fn(),
  topProps: vi.fn(),
}));

vi.mock("./CategoryStackedChart", () => ({
  CategoryStackedChart: (props: { startDate: string; endDate: string }) => {
    mocks.chartProps(props);
    return <div data-testid="mock-category-chart" />;
  },
}));

vi.mock("./PaymentMethodsCard", () => ({
  PaymentMethodsCard: (props: { startDate: string; endDate: string }) => {
    mocks.paymentProps(props);
    return <div data-testid="mock-payment-card" />;
  },
}));

vi.mock("./TopProductsCard", () => ({
  TopProductsCard: (props: { startDate: string; endDate: string }) => {
    mocks.topProps(props);
    return <div data-testid="mock-top-card" />;
  },
}));

import { RevenueSectionInner } from "./RevenueSection";

const TODAY = "2026-08-22";

describe("RevenueSection (shared range over three cards)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("sizes the two side cards to their content below lg and gives the piece room at lg", () => {
    render(<RevenueSectionInner today={TODAY} />);

    const paymentWrapper = screen.getByTestId("mock-payment-card").parentElement as HTMLElement;
    const topWrapper = screen.getByTestId("mock-top-card").parentElement as HTMLElement;

    for (const wrapper of [paymentWrapper, topWrapper]) {
      expect(wrapper.className).toContain("h-auto");
      expect(wrapper.className).toContain("lg:h-full");
      expect(wrapper.className).not.toContain("h-[15rem]");
    }

    const outerGrid = paymentWrapper.parentElement?.parentElement as HTMLElement;
    expect(outerGrid.className).toContain("lg:h-[30rem]");
    expect(outerGrid.className).not.toContain("lg:h-[26rem]");
  });

  it("renders the selector and the three cards", () => {
    render(<RevenueSectionInner today={TODAY} />);

    expect(screen.getByTestId("revenue-section")).toBeTruthy();
    expect(screen.getByRole("button", { name: /7 días/ })).toBeTruthy();
    expect(screen.getByTestId("mock-category-chart")).toBeTruthy();
    expect(screen.getByTestId("mock-payment-card")).toBeTruthy();
    expect(screen.getByTestId("mock-top-card")).toBeTruthy();
  });

  it("defaults to a 7-day window passed to every child", () => {
    render(<RevenueSectionInner today={TODAY} />);

    expect(mocks.chartProps).toHaveBeenLastCalledWith({
      startDate: "2026-08-16",
      endDate: TODAY,
    });
    expect(mocks.paymentProps).toHaveBeenLastCalledWith({
      startDate: "2026-08-16",
      endDate: TODAY,
    });
    expect(mocks.topProps).toHaveBeenLastCalledWith({
      startDate: "2026-08-16",
      endDate: TODAY,
    });
  });

  it("changes the window passed to the children when the range changes", () => {
    render(<RevenueSectionInner today={TODAY} />);

    fireEvent.click(screen.getByRole("button", { name: /7 días/ }));
    fireEvent.click(screen.getByText("1 mes"));

    // Rolling 30-day window ending today.
    expect(mocks.chartProps).toHaveBeenLastCalledWith({
      startDate: "2026-07-24",
      endDate: TODAY,
    });
    expect(mocks.paymentProps).toHaveBeenLastCalledWith({
      startDate: "2026-07-24",
      endDate: TODAY,
    });
    expect(mocks.topProps).toHaveBeenLastCalledWith({
      startDate: "2026-07-24",
      endDate: TODAY,
    });
  });
});
