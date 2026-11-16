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
  automatic: vi.fn(),
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
  useWhatsAppAutomaticSend: () => mocks.automatic(),
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
    mocks.automatic.mockReturnValue(
      emptyQuery({
        state: "active",
        consecutiveFailures: 0,
        pausedSince: null,
        nextRunAt: "2026-11-17T01:00:00.000Z",
      }),
    );
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
    expect(screen.getByText("Cargando envíos…")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /Mostrar QR/ }));

    expect(mocks.qr).toHaveBeenLastCalledWith(true);
    expect(
      screen.getByAltText("Código QR para vincular el número de WhatsApp"),
    ).toHaveAttribute("src", "data:image/png;base64,qr-base64");
  });

  it("tells a sent delivery apart from a failed one", () => {    mocks.deliveries.mockReturnValue(
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

    await user.click(
      screen.getByRole("button", { name: "Ocultar código de vinculación" }),
    );
    expect(screen.queryByTestId("whatsapp-link-code")).toBeNull();
  });

  it("places the channel cards side by side by container width, not viewport", () => {
    render(<WhatsAppSettingsPage />);

    const grid = screen
      .getByRole("heading", { name: "Canal comercial" })
      .closest("section")!.parentElement!;

    expect(grid.parentElement!.className).toContain("@container");
    expect(grid.className).toContain("@4xl:grid-cols-2");
    expect(grid.className).not.toContain("lg:grid-cols-2");
  });

  it("stacks the QR row until its card is wide enough, with the text block taking the free width", () => {
    render(<WhatsAppSettingsPage />);

    const label = screen.getByText("Vinculación por código QR");
    const row = label.closest(".flex")!;
    expect(row.className).toContain("@md:flex-row");
    expect(row.className).not.toContain("sm:flex-row");
    expect(row.closest("[class~='@container']")).not.toBeNull();

    const textBlock = label.parentElement!;
    expect(textBlock.className).toContain("min-w-0");
    expect(textBlock.className).toContain("flex-1");
  });

  it("keeps the automatic send state at the top of the daily report card", () => {
    render(<WhatsAppSettingsPage />);

    const card = screen
      .getByRole("heading", { name: "Reporte diario" })
      .closest("section")!;
    const status = screen.getByText("Envío automático");
    const manual = screen.getByText(/El envío manual va/);

    expect(card).toContainElement(status);
    expect(card).toContainElement(screen.getByText("Activo"));
    // The state introduces the card; the manual row and the history follow it.
    expect(
      status.compareDocumentPosition(manual) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers the manual send as the resume action when the automatic send paused", async () => {
    const user = userEvent.setup();
    mocks.automatic.mockReturnValue(
      emptyQuery({
        state: "paused_failures",
        consecutiveFailures: 3,
        pausedSince: "2026-11-14T01:05:00.000Z",
        nextRunAt: "2026-11-17T01:00:00.000Z",
      }),
    );
    mocks.sendReport.mockResolvedValue({
      status: "sent",
      providerMessageId: "wamid-1",
    });

    render(<WhatsAppSettingsPage />);

    expect(screen.getByText("Pausado por fallos")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Enviar ahora para reanudar" }),
    );

    expect(mocks.sendReport).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/El reporte se envió/)).toBeInTheDocument();
  });

  it("collapses a run of identical failures into one row that opens to its days", async () => {
    const user = userEvent.setup();
    mocks.deliveries.mockReturnValue(
      emptyQuery([
        {
          id: "delivery-3",
          kind: "SCHEDULED",
          reportDate: "2026-11-12T00:00:00.000Z",
          status: "FAILED",
          failureReason: "no_recipient",
          sentAt: null,
          attempts: 1,
        },
        {
          id: "delivery-2",
          kind: "SCHEDULED",
          reportDate: "2026-11-11T00:00:00.000Z",
          status: "FAILED",
          failureReason: "no_recipient",
          sentAt: null,
          attempts: 1,
        },
        {
          id: "delivery-1",
          kind: "SCHEDULED",
          reportDate: "2026-11-10T00:00:00.000Z",
          status: "FAILED",
          failureReason: "no_recipient",
          sentAt: null,
          attempts: 1,
        },
      ]),
    );

    render(<WhatsAppSettingsPage />);

    expect(screen.getByText("Falló 3 días seguidos")).toBeInTheDocument();
    expect(screen.getByText("10 nov – 12 nov")).toBeInTheDocument();
    expect(
      screen.getByText("no hay un número verificado que reciba el reporte"),
    ).toBeInTheDocument();
    // The days themselves are behind the disclosure, not spelled out twice.
    expect(screen.queryByText("10 de noviembre de 2026")).toBeNull();

    const summary = screen.getByTestId("delivery-group-summary");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    await user.click(summary);

    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("10 de noviembre de 2026")).toBeInTheDocument();
    expect(screen.getByText("11 de noviembre de 2026")).toBeInTheDocument();
    expect(screen.getByText("12 de noviembre de 2026")).toBeInTheDocument();
  });

  it("shows the first eight groups and opens the rest on demand", async () => {
    const user = userEvent.setup();
    const reasons = ["no_recipient", "provider_rejected", "send_failed"] as const;
    mocks.deliveries.mockReturnValue(
      emptyQuery(
        // Ten runs of two consecutive days, newest first; the reason changes
        // every two rows so each pair is its own group.
        Array.from({ length: 20 }, (_, index) => ({
          id: `delivery-${index}`,
          kind: "SCHEDULED" as const,
          reportDate: new Date(Date.UTC(2026, 10, 14 - index)).toISOString(),
          status: "FAILED" as const,
          failureReason: reasons[Math.floor(index / 2) % reasons.length],
          sentAt: null,
          attempts: 1,
        })),
      ),
    );

    render(<WhatsAppSettingsPage />);

    expect(screen.getAllByTestId("delivery-group-summary")).toHaveLength(8);
    expect(
      screen.queryByRole("button", { name: "Ver menos" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Ver más" }));

    expect(screen.getAllByTestId("delivery-group-summary")).toHaveLength(10);
  });

  it("reports what was sent instead of counting every failure", () => {
    mocks.deliveries.mockReturnValue(
      emptyQuery([
        {
          id: "delivery-2",
          kind: "ON_DEMAND",
          reportDate: "2026-11-11T00:00:00.000Z",
          status: "SENT",
          failureReason: null,
          sentAt: "2026-11-11T19:41:00.000Z",
          attempts: 1,
        },
        {
          id: "delivery-1",
          kind: "SCHEDULED",
          reportDate: "2026-11-10T00:00:00.000Z",
          status: "FAILED",
          failureReason: "no_recipient",
          sentAt: null,
          attempts: 1,
        },
      ]),
    );

    render(<WhatsAppSettingsPage />);

    expect(screen.getByText("Enviados")).toBeInTheDocument();
    expect(screen.getByText("Último envío")).toBeInTheDocument();
    expect(screen.getByText("Fallos recientes")).toBeInTheDocument();
    expect(screen.queryByText("Fallidos")).toBeNull();
    // Failures are the quiet third figure, not the headline.
    expect(
      screen.getByText("Fallos recientes").nextElementSibling?.className,
    ).toContain("text-muted-foreground");
  });

  it("offers a horizontal scroll area only when the deliveries table is rendered", () => {
    const { unmount } = render(<WhatsAppSettingsPage />);
    expect(
      screen.getByText("Sin envíos registrados").closest(".overflow-x-auto"),
    ).toBeNull();
    unmount();

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
    expect(
      screen.getByRole("table").closest(".overflow-x-auto"),
    ).not.toBeNull();
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
