import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The screen is judged by what the operator can see and do: the three panels, a QR
 * that is never fetched unasked, two deliveries that read differently, and a
 * missing identity offered as an action rather than an error.
 */
const mocks = vi.hoisted(() => ({
  auth: { role: "ADMIN" as string },
  status: vi.fn(),
  qr: vi.fn(),
  identities: vi.fn(),
  deliveries: vi.fn(),
  connect: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  challenge: vi.fn(),
  revoke: vi.fn(),
  sendReport: vi.fn(),
  qrRefetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", role: mocks.auth.role } }),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWhatsApp", () => ({
  useWhatsAppStatus: () => mocks.status(),
  useWhatsAppQr: (enabled: boolean) => mocks.qr(enabled),
  useWhatsAppIdentities: () => mocks.identities(),
  useWhatsAppDeliveries: () => mocks.deliveries(),
  useWhatsAppConnect: () => ({ mutateAsync: mocks.connect, isPending: false }),
  useWhatsAppStop: () => ({ mutateAsync: mocks.stop, isPending: false }),
  useWhatsAppRestart: () => ({ mutateAsync: mocks.restart, isPending: false }),
  useWhatsAppChallenge: () => ({
    mutateAsync: mocks.challenge,
    isPending: false,
  }),
  useWhatsAppRevokeIdentity: () => ({
    mutateAsync: mocks.revoke,
    isPending: false,
  }),
  useWhatsAppSendReport: () => ({
    mutateAsync: mocks.sendReport,
    isPending: false,
  }),
}));

import WhatsAppSettingsPage from "./page";

/**
 * A status is printed by the shared StatusBadge, which renders the dot and the
 * label as one typed chip. The local mark this screen used to hand-roll did
 * not, so the class and the dot child are what tell the two apart.
 */
function expectSharedStatusBadge(label: string) {
  const badge = screen.getByText(label);
  expect(badge.className).toContain("font-mono");
  expect(badge.firstElementChild).not.toBeNull();
}

function statusState(status = "WORKING") {
  return {
    data: { status },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function emptyQuery<T>(data: T) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe("WhatsApp settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.role = "ADMIN";
    mocks.status.mockReturnValue(statusState());
    mocks.identities.mockReturnValue(emptyQuery([]));
    mocks.deliveries.mockReturnValue(emptyQuery([]));
    mocks.qr.mockImplementation((enabled: boolean) =>
      enabled
        ? {
            data: { data: "qr-base64" },
            isLoading: false,
            isError: false,
            error: null,
            refetch: mocks.qrRefetch,
          }
        : {
            data: undefined,
            isLoading: false,
            isError: false,
            error: null,
            refetch: mocks.qrRefetch,
          },
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the three cards for an administrator", () => {
    render(<WhatsAppSettingsPage />);

    expect(
      screen.getByRole("heading", { name: "Canal comercial" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Número vinculado" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Reporte diario" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Conectado")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enviar reporte ahora" }),
    ).toBeInTheDocument();
  });

  it("paints the session state through the shared status badge", () => {
    render(<WhatsAppSettingsPage />);

    expectSharedStatusBadge("Conectado");
  });

  it("holds the deliveries table with the shared skeleton while it loads", () => {
    mocks.deliveries.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<WhatsAppSettingsPage />);

    const skeleton = screen.getByRole("status");
    expect(screen.getByText("Cargando envíos...")).toBeInTheDocument();
    // Four bars in the header band: the table it stands in for has four columns.
    expect(skeleton.querySelector("div")?.children).toHaveLength(4);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the skeleton column count equal to the real table", () => {
    mocks.deliveries.mockReturnValue(
      emptyQuery([
        {
          id: "delivery-1",
          kind: "SCHEDULED",
          reportDate: "2026-02-10T00:00:00.000Z",
          status: "SENT",
          failureReason: null,
          sentAt: "2026-02-10T12:30:00.000Z",
          attempts: 1,
        },
      ]),
    );

    render(<WhatsAppSettingsPage />);

    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });

  it("confirms before revoking a verified number", async () => {
    const user = userEvent.setup();
    mocks.identities.mockReturnValue(
      emptyQuery([
        {
          id: "identity-1",
          phone: "+573001234567",
          status: "VERIFIED",
          verifiedAt: "2026-02-10T12:00:00.000Z",
          organizationId: null,
        },
      ]),
    );

    render(<WhatsAppSettingsPage />);

    expectSharedStatusBadge("Verificado");

    await user.click(
      screen.getByRole("button", { name: "Acciones de +573001234567" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Revocar número" }));

    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Revocar número" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Revocar" }));

    expect(mocks.revoke).toHaveBeenCalledWith("identity-1");
  });

  it("keeps WhatsApp away from a role that cannot drive it", () => {
    mocks.auth.role = "CASHIER";

    render(<WhatsAppSettingsPage />);

    expect(
      screen.getByText("Solo la administración gestiona WhatsApp"),
    ).toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.deliveries).not.toHaveBeenCalled();
  });

  it("does not fetch the QR until the operator asks for it", async () => {
    const user = userEvent.setup();
    render(<WhatsAppSettingsPage />);

    expect(mocks.qr).toHaveBeenLastCalledWith(false);
    expect(
      screen.queryByAltText("Código QR para vincular el número de WhatsApp"),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: /Mostrar código/ }));

    expect(mocks.qr).toHaveBeenLastCalledWith(true);
    expect(
      screen.getByAltText("Código QR para vincular el número de WhatsApp"),
    ).toHaveAttribute("src", "data:image/png;base64,qr-base64");
  });

  it("tells a sent delivery apart from a failed one", () => {
    mocks.deliveries.mockReturnValue(
      emptyQuery([
        {
          id: "delivery-1",
          kind: "SCHEDULED",
          reportDate: "2026-02-10T00:00:00.000Z",
          status: "SENT",
          failureReason: null,
          sentAt: "2026-02-10T12:30:00.000Z",
          attempts: 1,
        },
        {
          id: "delivery-2",
          kind: "ON_DEMAND",
          reportDate: "2026-02-09T00:00:00.000Z",
          status: "FAILED",
          failureReason: "provider_rejected",
          sentAt: null,
          attempts: 1,
        },
      ]),
    );

    render(<WhatsAppSettingsPage />);

    expect(screen.getByText("Enviado")).toBeInTheDocument();
    expect(screen.getByText("Falló")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp rechazó el envío")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Automático")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("shows the missing identity as an action instead of an error", async () => {
    const user = userEvent.setup();
    mocks.sendReport.mockResolvedValue({
      status: "no_identity",
      reason: "no_recipient",
    });

    render(<WhatsAppSettingsPage />);

    await user.click(
      screen.getByRole("button", { name: "Enviar reporte ahora" }),
    );

    expect(
      await screen.findByText(/Todavía no hay un número verificado/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Solicitar código de vinculación/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the code once and the fixed reason of a failed send", async () => {
    const user = userEvent.setup();
    mocks.challenge.mockResolvedValue({
      code: "ABCDEFGHJK",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    mocks.sendReport.mockResolvedValue({
      status: "failed",
      reason: "report_failed",
    });

    render(<WhatsAppSettingsPage />);

    await user.click(screen.getByRole("button", { name: /Solicitar código/ }));
    expect(await screen.findByTestId("whatsapp-link-code")).toHaveTextContent(
      "ABCDEFGHJK",
    );

    await user.click(
      screen.getByRole("button", { name: "Enviar reporte ahora" }),
    );
    expect(
      await screen.findByText(/No se envió el reporte: no se pudo generar el reporte/),
    ).toBeInTheDocument();
  });

  it("hides the code on demand so it stops being readable", async () => {
    const user = userEvent.setup();
    mocks.challenge.mockResolvedValue({
      code: "ABCDEFGHJK",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    render(<WhatsAppSettingsPage />);

    await user.click(screen.getByRole("button", { name: /Solicitar código/ }));
    expect(await screen.findByTestId("whatsapp-link-code")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ocultar código" }));
    expect(screen.queryByTestId("whatsapp-link-code")).toBeNull();
  });

  it("clears an expired code without requiring a reload", async () => {
    const user = userEvent.setup();
    mocks.challenge.mockResolvedValue({
      code: "ABCDEFGHJK",
      expiresAt: new Date(Date.now() + 400).toISOString(),
    });

    render(<WhatsAppSettingsPage />);

    await user.click(screen.getByRole("button", { name: /Solicitar código/ }));
    expect(await screen.findByTestId("whatsapp-link-code")).toBeInTheDocument();

    await waitFor(
      () => expect(screen.queryByTestId("whatsapp-link-code")).toBeNull(),
      { timeout: 3000 },
    );
  });
});
