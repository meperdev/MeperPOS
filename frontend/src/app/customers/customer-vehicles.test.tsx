import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { create, update } = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/useCustomerVehicles", () => ({
  useCustomerVehicles: () => ({ data: [{ id: 'v1', plate: 'ABC123', model: 'X' }], isLoading: false, isError: false }),
  useCreateCustomerVehicle: () => ({ mutateAsync: create, isPending: false }),
  useUpdateCustomerVehicle: () => ({ mutateAsync: update, isPending: false }),
}));
import { CustomerVehicles } from "./customer-vehicles";

describe("CustomerVehicles", () => {
  it("edits an existing vehicle for the selected customer", async () => {
    update.mockResolvedValue({});
    render(<CustomerVehicles customerId="customer-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Editar ABC123" }));
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar vehículo" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ customerId: "customer-1", vehicleId: "v1", plate: "ABC123", model: "Y" }));
  });

  it("shows existing vehicles and adds a plate and model to the selected customer", async () => {
    create.mockResolvedValue({});
    render(<CustomerVehicles customerId="customer-1" />);
    expect(screen.getByText(/ABC123/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Placa"), { target: { value: "DEF456" } });
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar vehículo" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ customerId: "customer-1", plate: "DEF456", model: "Y" }));
  });
});
