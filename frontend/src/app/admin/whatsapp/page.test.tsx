import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminWhatsAppPage from "./page";

/**
 * The console is judged by what a platform operator can see and do: the channel's
 * real state, a QR that is never fetched unasked, and a re-link that asks first
 * because it takes the administrative number offline for the whole platform.
 */
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  qr: vi.fn(),
  qrEnabled: vi.fn(),
  connect: vi.fn(),
  relink: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  refetch: vi.fn(),
  qrRefetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWhatsAppIntelligence", () => ({
  useCentralSession: () => mocks.session(),
  useCentralSessionQr: (enabled: boolean) => {
    mocks.qrEnabled(enabled);
    return mocks.qr();
  },
  useCentralConnect: () => ({ mutateAsync: mocks.connect, isPending: false }),
  useCentralRelink: () => ({ mutateAsync: mocks.relink, isPending: false }),
  useCentralStop: () => ({ mutateAsync: mocks.stop, isPending: false }),
  useCentralRestart: () => ({ mutateAsync: mocks.restart, isPending: false }),
}));

const OBSERVED_AT = "2026-01-02T03:04:05.000Z";

function sessionState(
  overrides: Partial<{
    status: string;
    accountId: string | null;
    lastObservedAt: string | null;
  }> = {},
) {
  return {
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: mocks.refetch,
    data: {
      status: "WORKING",
      accountId: "57311@c.us",
      sessionName: "meper-intelligence",
      lastObservedAt: OBSERVED_AT,
      ...overrides,
    },
  };
}

function qrState(overrides: Record<string, unknown> = {}) {
  return {
    data: { data: "qr-base64" },
    isFetching: false,
    isError: false,
    error: undefined,
    refetch: mocks.qrRefetch,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.session.mockReturnValue(sessionState());
  mocks.qr.mockReturnValue(qrState());
  mocks.connect.mockResolvedValue({ status: "SCAN_QR_CODE" });
  mocks.relink.mockResolvedValue({ status: "SCAN_QR_CODE" });
  mocks.stop.mockResolvedValue(undefined);
  mocks.restart.mockResolvedValue(undefined);
});

describe("central WhatsApp console", () => {
  it("names the linked number and never fetches a QR for a working session", () => {
    render(<AdminWhatsAppPage />);

    expect(screen.getByText("57311")).toBeInTheDocument();
    expect(screen.getByText("meper-intelligence")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /re-vincular/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(mocks.qrEnabled).toHaveBeenLastCalledWith(false);
  });

  it("asks before taking the platform number offline", async () => {
    const user = userEvent.setup();
    render(<AdminWhatsAppPage />);

    await user.click(screen.getByRole("button", { name: /re-vincular/i }));

    expect(mocks.relink).not.toHaveBeenCalled();
    expect(screen.getByText(/deja de\s+recibir respuestas/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /sí, re-vincular/i }));

    await waitFor(() => expect(mocks.relink).toHaveBeenCalledTimes(1));
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("offers a start for an idle session and shows the code afterwards", async () => {
    mocks.session.mockReturnValue(sessionState({ status: "STOPPED", accountId: null }));
    const user = userEvent.setup();
    render(<AdminWhatsAppPage />);

    expect(screen.getByText("Sin vincular")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^iniciar$/i }));

    await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.qrEnabled).toHaveBeenLastCalledWith(true));
  });

  it("reports an unreadable state with a retry instead of an empty screen", async () => {
    mocks.session.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("boom"),
      refetch: mocks.refetch,
      data: undefined,
    });
    const user = userEvent.setup();
    render(<AdminWhatsAppPage />);

    expect(
      screen.getByText(/no se pudo consultar el canal central/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});
