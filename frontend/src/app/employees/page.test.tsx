import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmployeesPage from "./page";
import { formatDate } from "@/lib/utils";

const state = vi.hoisted(() => ({ role: "ADMIN", list: { data: [] as object[], isLoading: false, isError: false, refetch: vi.fn() }, create: vi.fn(), update: vi.fn(), active: vi.fn(), shiftCreate: vi.fn(), shifts: { data: [] as { id: string; date: string; kind: string; amount: string; observation: string | null }[], isLoading: false, isError: false, refetch: vi.fn() } }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: {children: React.ReactNode}) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => state.list,
  useCreateEmployee: () => ({ mutateAsync: state.create }),
  useUpdateEmployee: () => ({ mutateAsync: state.update }),
  useSetEmployeeActive: () => ({ mutateAsync: state.active }),
}));
vi.mock("@/hooks/useEmployeeShifts", () => ({ useEmployeeShifts: () => state.shifts, useCreateEmployeeShift: () => ({ mutateAsync: state.shiftCreate }) }));
const employee = { id: "1", name: "Ana", identification: "123", phone: null, email: "ana@example.com", address: null, jobTitle: "Vendedora", startDate: "2024-01-03T00:00:00.000Z", remunerationModality: "BY_DAY", referenceAmount: "1000.00", active: true };
beforeEach(() => { vi.clearAllMocks(); state.role = "ADMIN"; state.list = { data: [], isLoading: false, isError: false, refetch: vi.fn() }; state.create.mockResolvedValue({}); state.update.mockResolvedValue({}); state.active.mockResolvedValue({}); state.shiftCreate.mockResolvedValue({}); state.shifts = { data: [], isLoading: false, isError: false, refetch: vi.fn() }; });
afterEach(cleanup);

async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Acciones de ${name}` }));
}
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
  await openRowMenu(user, "Ana");
  await user.click(screen.getByRole("menuitem", { name: "Editar" }));
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
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  await user.tab();
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
it("returns escaped programmatic focus and restores the edit opener on close", async () => {
  const user = userEvent.setup(); state.list.data = [employee]; render(<EmployeesPage />);
  const opener = screen.getByRole("button", { name: "Acciones de Ana" });
  await user.click(opener);
  await user.click(screen.getByRole("menuitem", { name: "Editar" }));
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
  const user = userEvent.setup();
  state.list.data = [employee]; render(<EmployeesPage />);
  await openRowMenu(user, "Ana");
  await user.click(screen.getByRole("menuitem", { name: "Desactivar" }));
  const dialog = screen.getByRole("dialog", { name: "Desactivar empleado" });
  await user.click(within(dialog).getByRole("button", { name: "Desactivar" }));
  await waitFor(() => expect(state.active).toHaveBeenCalledWith({ id: "1", active: false }));
});
it("opens shift history for active and inactive employees without allowing inactive creation", async () => {
  const user = userEvent.setup(); state.list.data = [employee, { ...employee, id: "2", name: "Luis", active: false }];
  render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Jornadas Luis" }));
  expect(screen.getByRole("dialog", { name: "Jornadas de Luis" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Registrar jornada" })).not.toBeInTheDocument();
});
it("lists shifts and creates a partial day with a date-only payload", async () => {
  const user = userEvent.setup(); state.list.data = [employee];
  state.shifts.data = [{ id: "s", date: "2025-01-02T00:00:00.000Z", kind: "FULL_DAY", amount: "100.00", observation: "Nota anterior" }];
  render(<EmployeesPage />); await user.click(screen.getByRole("button", { name: "Jornadas Ana" }));
  expect(screen.getByText(formatDate("2025-01-02T00:00:00.000Z"))).toBeInTheDocument();
  expect(screen.getAllByText("Día completo").length).toBeGreaterThan(0);
  expect(screen.getByText("Nota anterior")).toBeInTheDocument();
  await user.type(screen.getByLabelText(/Fecha/), "2025-01-03");
  await user.selectOptions(screen.getByLabelText("Tipo de jornada"), "PARTIAL_DAY");
  await user.type(screen.getByLabelText(/Valor/), "10.25");
  await user.type(screen.getByLabelText("Observación (opcional)"), "Turno corto");
  await user.click(screen.getByRole("button", { name: "Registrar jornada" }));
  await waitFor(() => expect(state.shiftCreate).toHaveBeenCalledWith({ employeeId: "1", date: "2025-01-03", kind: "PARTIAL_DAY", amount: 10.25, observation: "Turno corto" }));
});
it("prevents changes to shift fields while a save is pending", async () => {
  const user = userEvent.setup(); state.list.data = [employee];
  state.shiftCreate.mockReturnValue(new Promise(() => {}));
  render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Jornadas Ana" }));
  await user.type(screen.getByLabelText(/Fecha/), "2025-01-03");
  await user.type(screen.getByLabelText(/Valor/), "10");
  await user.click(screen.getByRole("button", { name: "Registrar jornada" }));
  for (const label of [/Fecha/, "Tipo de jornada", /Valor/, "Observación (opcional)"]) {
    expect(screen.getByLabelText(label)).toBeDisabled();
  }
  screen.getByRole("button", { name: "Nuevo empleado" }).focus();
  const shiftDialog = screen.getByRole("dialog", { name: "Jornadas de Ana" });
  const focused = document.activeElement as HTMLElement;
  expect(shiftDialog === focused || shiftDialog.contains(focused)).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Jornadas de Ana" })).toBeInTheDocument();
});
it("retains shift values and permits retry after a failed save", async () => {
  const user = userEvent.setup(); state.list.data = [employee];
  state.shiftCreate.mockRejectedValueOnce(new Error("Network error")).mockResolvedValueOnce({});
  render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Jornadas Ana" }));
  await user.type(screen.getByLabelText(/Fecha/), "2025-01-03");
  await user.type(screen.getByLabelText(/Valor/), "10");
  await user.type(screen.getByLabelText("Observación (opcional)"), "Turno");
  await user.click(screen.getByRole("button", { name: "Registrar jornada" }));
  await waitFor(() => expect(screen.getByLabelText(/Valor/)).toBeEnabled());
  expect(screen.getByLabelText(/Fecha/)).toHaveValue("2025-01-03");
  expect(screen.getByLabelText(/Valor/)).toHaveValue(10);
  expect(screen.getByLabelText("Observación (opcional)")).toHaveValue("Turno");
  await user.click(screen.getByRole("button", { name: "Registrar jornada" }));
  await waitFor(() => expect(state.shiftCreate).toHaveBeenCalledTimes(2));
  expect(state.shiftCreate).toHaveBeenLastCalledWith({ employeeId: "1", date: "2025-01-03", kind: "FULL_DAY", amount: 10, observation: "Turno" });
});
it("rejects zero amount through the form constraints", async () => {
  const user = userEvent.setup(); state.list.data = [employee]; render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Jornadas Ana" }));
  await user.type(screen.getByLabelText(/Fecha/), "2025-01-03"); await user.type(screen.getByLabelText(/Valor/), "0");
  await user.click(screen.getByRole("button", { name: "Registrar jornada" }));
  expect(state.shiftCreate).not.toHaveBeenCalled();
});
it("offers retry when shift history fails", async () => {
  const user = userEvent.setup(); state.list.data = [employee]; state.shifts.isError = true; render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Jornadas Ana" }));
  expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar las jornadas");
  await user.click(screen.getByRole("button", { name: "Reintentar" })); expect(state.shifts.refetch).toHaveBeenCalled();
});
it("submits a full day without an optional observation", async () => {
  const user = userEvent.setup(); state.list.data = [employee]; render(<EmployeesPage />);
  await user.click(screen.getByRole("button", { name: "Jornadas Ana" }));
  await user.type(screen.getByLabelText(/Fecha/), "2025-01-03"); await user.type(screen.getByLabelText(/Valor/), "1");
  await user.click(screen.getByRole("button", { name: "Registrar jornada" }));
  await waitFor(() => expect(state.shiftCreate).toHaveBeenCalledWith({ employeeId: "1", date: "2025-01-03", kind: "FULL_DAY", amount: 1 }));
});
it("does not expose employee controls to SUPER_ADMIN", () => { state.role = "SUPER_ADMIN"; state.list.data = [employee]; render(<EmployeesPage />); expect(screen.queryByRole("button", { name: "Nuevo empleado" })).not.toBeInTheDocument(); expect(screen.queryByText("Ana")).not.toBeInTheDocument(); });
