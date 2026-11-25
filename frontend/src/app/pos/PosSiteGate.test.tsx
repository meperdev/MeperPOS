import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PosSiteGate, type PosCheckoutSite } from "./PosSiteGate";

type ListedSite = {
  id: string;
  name: string;
  type: "STORE" | "WAREHOUSE";
  isDefault: boolean;
};
type Context = {
  locations: ListedSite[];
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

const centro: ListedSite = {
  id: "site-a",
  name: "Centro",
  type: "STORE",
  isDefault: true,
};
const norte: ListedSite = {
  id: "site-b",
  name: "Norte",
  type: "STORE",
  isDefault: false,
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
    expect(screen.queryByRole("combobox")).toBeNull();
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
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Sede" }),
      norte.id,
    );
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
    const select = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Sede",
    });
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Selecciona una sede", "Centro", "Norte"]);

    await userEvent.selectOptions(select, norte.id);

    expect(screen.getByText("workspace")).toBeTruthy();
    expect(scopes.at(-1)).toBe(JSON.stringify(["u1", "org-1", norte.id]));
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
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Sede" }),
      centro.id,
    );
    const centroScope = scopes.at(-1);

    cleanup();
    renderGate((_site, scope) => {
      scopes.push(scope);
      return <p>workspace</p>;
    });
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Sede" }),
      norte.id,
    );

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
    expect(screen.getByRole("combobox", { name: "Sede" })).toBeTruthy();
  });

  it("asks for a site when the cashier has none assigned", () => {
    siteState.value.data = { locations: [], checkoutLocationId: null };

    renderGate((_site, scope) => <p>{scope}</p>);

    expect(screen.getByText("No tienes sedes asignadas")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos verificar tus sedes. No se habilitó el cobro.",
    );
  });
});
