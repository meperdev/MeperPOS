import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmployeesPage from "./page";

const state = vi.hoisted(() => ({ role: "ADMIN", list: { data: [] as object[], isLoading: false, isError: false, refetch: vi.fn() }, create: vi.fn(), update: vi.fn(), active: vi.fn() }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: {children: React.ReactNode}) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => state.list,
  useCreateEmployee: () => ({ mutateAsync: state.create }),
  useUpdateEmployee: () => ({ mutateAsync: state.update }),
  useSetEmployeeActive: () => ({ mutateAsync: state.active }),
}));
const employee = { id: "1", name: "Ana", identification: "123", phone: null, email: "ana@example.com", address: null, jobTitle: "Vendedora", startDate: "2024-01-03T00:00:00.000Z", remunerationModality: "BY_DAY", referenceAmount: "1000.00", active: true };
beforeEach(() => { vi.clearAllMocks(); state.role = "ADMIN"; state.list = { data: [], isLoading: false, isError: false, refetch: vi.fn() }; state.create.mockResolvedValue({}); state.update.mockResolvedValue({}); state.active.mockResolvedValue({}); });
afterEach(cleanup);
it("shows loading, error and empty states", () => {
  state.list.isLoading = true; const view = render(<EmployeesPage />); expect(screen.getByText("Cargando empleados...")).toBeInTheDocument();
  state.list.isLoading = false; state.list.isError = true; view.rerender(<EmployeesPage />); expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los empleados");
  state.list.isError = false; view.rerender(<EmployeesPage />); expect(screen.getByText("No hay empleados")).toBeInTheDocument();
});
it("creates and edits profiles, explicitly clearing nullable fields", async () => {
  const user = userEvent.setup(); state.list.data = [employee]; render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo empleado" }));
  await user.type(screen.getByLabelText(/Nombre/), "Luis");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Luis", email: null, referenceAmount: null })));
  await user.click(screen.getByRole("button", { name: "Editar Ana" }));
  await user.clear(screen.getByLabelText("Correo electrónico"));
  await user.clear(screen.getByLabelText("Fecha de ingreso"));
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ id: "1", data: expect.objectContaining({ email: null, startDate: null, referenceAmount: 1000 }) })));
});
it("explains whitespace-only names and accepts a corrected name", async () => {
  const user = userEvent.setup(); render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo empleado" }));
  const name = screen.getByLabelText(/Nombre/);
  await user.type(name, "   ");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Ingresa un nombre válido");
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription("Ingresa un nombre válido");
  expect(state.create).not.toHaveBeenCalled();
  await user.clear(name); await user.type(name, "Ana");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Ana" })));
});
it("names the dialog, contains keyboard focus, and restores it after Escape", async () => {
  const user = userEvent.setup(); render(<EmployeesPage />);
  const opener = screen.getByRole("button", { name: "Nuevo empleado" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Nuevo empleado" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(screen.getByLabelText(/Nombre/)).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
  await user.tab();
  expect(screen.getByLabelText(/Nombre/)).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
it("returns escaped programmatic focus and restores the edit opener on close", async () => {
  const user = userEvent.setup(); state.list.data = [employee]; render(<EmployeesPage />);
  const opener = screen.getByRole("button", { name: "Editar Ana" });
  await user.click(opener);
  expect(screen.getByRole("dialog", { name: "Editar empleado" })).toBeInTheDocument();
  screen.getByRole("button", { name: "Nuevo empleado" }).focus();
  expect(screen.getByLabelText(/Nombre/)).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cerrar" }));
  expect(opener).toHaveFocus();
});
it("keeps the dialog open while a save is pending", async () => {
  const user = userEvent.setup(); state.create.mockReturnValue(new Promise(() => {})); render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Nuevo empleado" }));
  await user.type(screen.getByLabelText(/Nombre/), "Ana");
  await user.click(screen.getByRole("button", { name: "Guardar" }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Nuevo empleado" })).toBeInTheDocument();
});
it("changes active state without deleting the employee", async () => {
  state.list.data = [employee]; render(<EmployeesPage />); await userEvent.click(screen.getByRole("button", { name: "Desactivar Ana" }));
  await waitFor(() => expect(state.active).toHaveBeenCalledWith({ id: "1", active: false }));
});
it("does not expose employee controls to SUPER_ADMIN", () => { state.role = "SUPER_ADMIN"; state.list.data = [employee]; render(<EmployeesPage />); expect(screen.queryByRole("button", { name: "Nuevo empleado" })).not.toBeInTheDocument(); expect(screen.queryByText("Ana")).not.toBeInTheDocument(); });
