import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PosSiteGate, type PosCheckoutSite } from "./PosSiteGate";
import type { PosSite } from "@/hooks/usePosSiteContext";

type Context = {
  locations: PosSite[];
  checkoutLocationId: string | null;
};

/**
 * The gate reads the whole context from one hook. It is replaced here so the
 * component can be driven through every server answer (nomination, no
 * nomination, revocation, failure) without a running API.
 */
const siteState = vi.hoisted(() => ({
  value: {
    data: undefined as Context | undefined,
    isFetchedAfterMount: true,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/hooks/usePosSiteContext", () => ({
  usePosSiteContext: () => siteState.value,
}));

const centro: PosSite = {
  id: "site-a",
  name: "Centro",
  type: "STORE",
  isDefault: true,
  address: "Calle 10 #5-20",
  phone: "300 123 4567",
};
const norte: PosSite = {
  id: "site-b",
  name: "Norte",
  type: "STORE",
  isDefault: false,
  address: null,
  phone: null,
};

beforeEach(() => {
  siteState.value = {
    data: { locations: [centro], checkoutLocationId: centro.id },
    isFetchedAfterMount: true,
    isError: false,
    refetch: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderGate(
  receive: (site: PosCheckoutSite, scope: string) => React.ReactNode,
) {
  return render(
    <PosSiteGate userId="u1" organizationId="org-1">
      {receive}
    </PosSiteGate>,
  );
}

/** The store tiles of the picker, in the order the server listed them. */
function siteTiles() {
  return within(screen.getByRole("group", { name: "Sedes" })).getAllByRole(
    "button",
  );
}

describe("PosSiteGate", () => {
  it("mounts checkout at the store the server nominates", () => {
    renderGate((site, scope) => (
      <p>
        {site.name} {scope}
      </p>
    ));

    expect(
      screen.getByText(`Centro ${JSON.stringify(["u1", "org-1", centro.id])}`),
    ).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Sedes" })).toBeNull();
  });

  it("lets a cashier with several stores leave the nominated store for another", async () => {
    siteState.value.data = {
      locations: [centro, norte],
      checkoutLocationId: centro.id,
    };
    let current: PosCheckoutSite | undefined;
    renderGate((site) => {
      current = site;
      return <p>workspace {site.name}</p>;
    });

    expect(screen.getByText("workspace Centro")).toBeTruthy();
    act(() => current?.change?.());
    expect(screen.queryByText(/^workspace/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Norte" }));
    expect(screen.getByText("workspace Norte")).toBeTruthy();
    expect(current?.id).toBe(norte.id);
  });

  it("returns to the same store when the cashier keeps it", async () => {
    siteState.value.data = {
      locations: [centro, norte],
      checkoutLocationId: centro.id,
    };
    let current: PosCheckoutSite | undefined;
    renderGate((site) => {
      current = site;
      return <p>workspace {site.name}</p>;
    });

    act(() => current?.change?.());
    await userEvent.click(screen.getByRole("button", { name: "Seguir en Centro" }));
    expect(screen.getByText("workspace Centro")).toBeTruthy();
  });

  it("marks the store the till is on when the picker reopens", () => {
    siteState.value.data = {
      locations: [centro, norte],
      checkoutLocationId: centro.id,
    };
    let current: PosCheckoutSite | undefined;
    renderGate((site) => {
      current = site;
      return <p>workspace {site.name}</p>;
    });

    act(() => current?.change?.());

    expect(
      screen.getByRole("heading", { name: "Cambiar de sede", level: 2 }),
    ).toBeTruthy();
    const [marked, other] = siteTiles();
    expect(marked).toHaveAccessibleName("Centro");
    expect(marked).toHaveAttribute("aria-current", "true");
    expect(other).toHaveAccessibleName("Norte");
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("offers no site change to a cashier with a single store", () => {
    let current: PosCheckoutSite | undefined;
    renderGate((site) => {
      current = site;
      return <p>workspace</p>;
    });
    expect(screen.getByText("workspace")).toBeTruthy();
    expect(current?.change).toBeUndefined();
  });

  it("lets the cashier pick among the listed stores when nothing is nominated", async () => {
    siteState.value.data = {
      locations: [centro, norte],
      checkoutLocationId: null,
    };
    const scopes: string[] = [];

    renderGate((_site, scope) => {
      scopes.push(scope);
      return <p>workspace</p>;
    });

    expect(screen.queryByText("workspace")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "¿Dónde vas a vender hoy?", level: 2 }),
    ).toBeTruthy();
    const tiles = siteTiles();
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveAccessibleName("Centro");
    expect(tiles[1]).toHaveAccessibleName("Norte");
    // Choosing on the first visit is not "keeping" anything: nothing is marked.
    expect(tiles[0]).not.toHaveAttribute("aria-current");

    await userEvent.click(tiles[1]);

    expect(screen.getByText("workspace")).toBeTruthy();
    expect(scopes.at(-1)).toBe(JSON.stringify(["u1", "org-1", norte.id]));
  });

  it("opens the chosen store from the keyboard", async () => {
    siteState.value.data = {
      locations: [centro, norte],
      checkoutLocationId: null,
    };

    renderGate((site) => <p>workspace {site.name}</p>);

    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Centro" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");

    expect(screen.getByText("workspace Centro")).toBeTruthy();
  });

  it("shows each store's principal badge, address and phone", () => {
    siteState.value.data = {
      locations: [centro, norte],
      checkoutLocationId: null,
    };

    renderGate(() => <p>workspace</p>);

    const [marked] = siteTiles();
    expect(marked).toHaveAccessibleDescription(
      "Principal Calle 10 #5-20 300 123 4567",
    );
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(screen.getByText("Calle 10 #5-20")).toBeTruthy();
    expect(screen.getByText("300 123 4567")).toBeTruthy();
  });

  it("keys each store's workspace separately so a cart never follows another site", async () => {
    siteState.value.data = {
      locations: [centro, norte],
      checkoutLocationId: null,
    };
    const scopes: string[] = [];

    renderGate((_site, scope) => {
      scopes.push(scope);
      return <p>workspace</p>;
    });
    await userEvent.click(screen.getByRole("button", { name: "Centro" }));
    const centroScope = scopes.at(-1);

    cleanup();
    renderGate((_site, scope) => {
      scopes.push(scope);
      return <p>workspace</p>;
    });
    await userEvent.click(screen.getByRole("button", { name: "Norte" }));

    expect(centroScope).toBe(JSON.stringify(["u1", "org-1", centro.id]));
    expect(scopes.at(-1)).toBe(JSON.stringify(["u1", "org-1", norte.id]));
  });

  it("never promotes a nomination that is not in the reachable list", () => {
    siteState.value.data = {
      locations: [centro, norte],
      checkoutLocationId: "site-elsewhere",
    };
    const mounted: string[] = [];

    renderGate((site) => {
      mounted.push(site.id);
      return <p>workspace</p>;
    });

    expect(mounted).toEqual([]);
    expect(screen.queryByText("workspace")).toBeNull();
    expect(siteTiles()).toHaveLength(2);
  });

  it("asks for a site when the cashier has none assigned", () => {
    siteState.value.data = { locations: [], checkoutLocationId: null };

    renderGate((_site, scope) => <p>{scope}</p>);

    expect(screen.getByText("No tienes sedes asignadas")).toBeTruthy();
    expect(
      screen.getByText(
        "Un administrador tiene que asignarte una sede en Sedes para que puedas cobrar.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Sedes" })).toBeNull();
  });

  it("says it is still reading the stores before showing any", () => {
    siteState.value.data = undefined;

    renderGate(() => <p>workspace</p>);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Consultando sedes del punto de venta",
    );
    expect(screen.queryByRole("group", { name: "Sedes" })).toBeNull();
  });

  it("revalidates the charging site against the live list", async () => {
    const live: { current: Context } = {
      current: { locations: [centro], checkoutLocationId: null },
    };
    siteState.value.data = live.current;
    siteState.value.refetch.mockImplementation(async () => ({
      data: live.current,
      isError: false,
    }));
    let checkoutSite: PosCheckoutSite | undefined;

    renderGate((site) => {
      checkoutSite = site;
      return <p>{site.name}</p>;
    });

    expect(checkoutSite?.id).toBe(centro.id);
    await expect(checkoutSite!.revalidate()).resolves.toBe(true);

    live.current = { locations: [], checkoutLocationId: null };
    await expect(checkoutSite!.revalidate()).resolves.toBe(false);
  });

  it("keeps the workspace of a site it could not verify, but locks it", () => {
    siteState.value.isError = true;

    renderGate((site) => <p>{site.available ? "enabled" : "locked"}</p>);

    expect(screen.getByText("locked")).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No pudimos verificar tus sedes");
    expect(alert).toHaveTextContent("No se habilitó el cobro");
  });

  it("retries the verification from the error screen", async () => {
    siteState.value.isError = true;

    renderGate(() => <p>workspace</p>);

    await userEvent.click(screen.getByRole("button", { name: "Volver a intentar" }));

    expect(siteState.value.refetch).toHaveBeenCalledOnce();
  });
});
