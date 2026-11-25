import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import type { PosSite } from "@/hooks/usePosSiteContext";
import { SitePicker } from "./SitePicker";

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

function renderPicker(props: Partial<ComponentProps<typeof SitePicker>> = {}) {
  const onPick = vi.fn();
  render(<SitePicker sites={[centro, norte]} onPick={onPick} {...props} />);
  const group = screen.getByRole("group", { name: "Sedes" });
  return { onPick, group, tiles: within(group).getAllByRole("button") };
}

describe("SitePicker", () => {
  it("offers one tile per store, named after the store and in the order the server sent", () => {
    const { tiles } = renderPicker();

    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveAccessibleName("Centro");
    expect(tiles[1]).toHaveAccessibleName("Norte");
  });

  it("describes a tile with its principal badge, its address and its phone", () => {
    const { tiles } = renderPicker();

    expect(tiles[0]).toHaveAccessibleDescription(
      "Principal Calle 10 #5-20 300 123 4567",
    );
    // Visible too, so the cashier reads the same facts the screen reader gets.
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(screen.getByText("Calle 10 #5-20")).toBeTruthy();
    expect(screen.getByText("300 123 4567")).toBeTruthy();
  });

  it("leaves a store without contact details undescribed", () => {
    const { tiles } = renderPicker();

    expect(tiles[1]).toHaveAccessibleDescription("");
    expect(tiles[1]).not.toHaveAttribute("aria-describedby");
  });

  it("opens the store the cashier clicks", async () => {
    const { onPick, tiles } = renderPicker();

    await userEvent.click(tiles[1]);

    expect(onPick).toHaveBeenCalledExactlyOnceWith("site-b");
  });

  it("opens a store from the keyboard alone", async () => {
    const { onPick } = renderPicker();

    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Centro" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenLastCalledWith("site-a");

    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Norte" })).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onPick).toHaveBeenLastCalledWith("site-b");
  });

  it("marks only the store the till is on right now", () => {
    const { tiles } = renderPicker({ currentId: "site-b" });

    expect(tiles[0]).not.toHaveAttribute("aria-current");
    expect(tiles[1]).toHaveAttribute("aria-current", "true");
  });

  it("marks nothing when the server nominated no store", () => {
    const { tiles } = renderPicker();

    for (const tile of tiles) {
      expect(tile).not.toHaveAttribute("aria-current");
    }
  });
});
