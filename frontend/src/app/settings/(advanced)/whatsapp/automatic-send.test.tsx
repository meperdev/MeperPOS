import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WhatsAppAutomaticSend } from "@/types";
import { AutomaticSendStatus } from "./automatic-send";

const ACTIVE: WhatsAppAutomaticSend = {
  state: "active",
  consecutiveFailures: 0,
  pausedSince: null,
  nextRunAt: "2026-11-17T01:00:00.000Z",
};

function renderCard(
  state: WhatsAppAutomaticSend | undefined,
  overrides: Partial<Parameters<typeof AutomaticSendStatus>[0]> = {},
) {
  const props = {
    state,
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
    onLinkNumber: vi.fn(),
    onResume: vi.fn(),
    linking: false,
    resuming: false,
    ...overrides,
  };
  render(<AutomaticSendStatus {...props} />);
  return props;
}

describe("automatic send status", () => {
  afterEach(() => {
    cleanup();
  });

  it("reads as active and names the schedule it runs on", () => {
    renderCard(ACTIVE);

    expect(screen.getByText("Envío automático")).toBeInTheDocument();
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByText(/Todos los días a las 8:00 p\. m\./)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("marks the active dot as success, not as decoration only", () => {
    renderCard(ACTIVE);

    const dot = screen.getByTestId("automatic-send-dot");
    expect(dot.className).toContain("bg-success");
    expect(dot.className).toContain("h-1.5");
    expect(dot.className).toContain("w-1.5");
  });

  it("offers the link flow when there is no verified number", async () => {
    const user = userEvent.setup();
    const props = renderCard({
      state: "paused_no_recipient",
      consecutiveFailures: 0,
      pausedSince: null,
      nextRunAt: "2026-11-17T01:00:00.000Z",
    });

    expect(screen.getByText("Pausado sin número")).toBeInTheDocument();
    expect(
      screen.getByText("No hay un número verificado que reciba el reporte."),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("automatic-send-dot").className,
    ).toContain("bg-warning");

    await user.click(screen.getByRole("button", { name: "Vincular número" }));
    expect(props.onLinkNumber).toHaveBeenCalledTimes(1);
  });

  it("says why the send paused and resumes with the manual report", async () => {
    const user = userEvent.setup();
    const props = renderCard({
      state: "paused_failures",
      consecutiveFailures: 3,
      pausedSince: "2026-11-14T01:05:00.000Z",
      nextRunAt: "2026-11-17T01:00:00.000Z",
    });

    expect(screen.getByText("Pausado por fallos")).toBeInTheDocument();
    expect(screen.getByText(/Se pausó tras 3 fallos seguidos/)).toBeInTheDocument();
    expect(
      screen.getByTestId("automatic-send-dot").className,
    ).toContain("bg-danger");

    await user.click(
      screen.getByRole("button", { name: "Enviar ahora para reanudar" }),
    );
    expect(props.onResume).toHaveBeenCalledTimes(1);
  });

  it("never claims a state it does not know yet", () => {
    renderCard(undefined, { isLoading: true });

    expect(screen.getByText("Envío automático")).toBeInTheDocument();
    expect(screen.getByText(/Consultando el envío automático/)).toBeInTheDocument();
    expect(screen.queryByText("Activo")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps a failed read quiet and offers a retry", async () => {
    const user = userEvent.setup();
    const props = renderCard(undefined, { isError: true });

    expect(
      screen.getByText("No se pudo consultar el envío automático."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
