import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { DeleteOrganizationDto } from '../admin/dto/delete-organization.dto';
import { UpdateOrganizationDto } from '../admin/dto/update-organization.dto';
import {
  ChangePasswordDto,
  CreateUserDto as AuthCreateUserDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  UpdateProfileDto,
} from '../auth/dto/auth.dto';
import { SelectOrganizationDto } from '../auth/dto/select-organization.dto';
import { CreatePaymentRecordDto } from '../billing/dto/create-payment-record.dto';
import { CreateCashRegisterDto } from '../cash-registers/dto/create-cash-register.dto';
import { UpdateCashRegisterDto } from '../cash-registers/dto/update-cash-register.dto';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../categories/dto/category.dto';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from '../customers/dto/customer.dto';
import { QueryExpensesDto } from '../expenses/dto/query-expenses.dto';
import { InventoryMovementsQueryDto } from '../exports/dto/export.dto';
import {
  ImportJobStatusResponseDto,
  ImportRowErrorDto,
  ImportSheetStatusDto,
} from '../imports/dto/import.dto';
import { CorrectPayrollGroupInstallmentDto } from '../payroll/dto/correct-payroll-group-installment.dto';
import { CorrectPayrollPeriodInstallmentDto } from '../payroll/dto/correct-payroll-period-installment.dto';
import { CreatePayrollGroupInstallmentDto } from '../payroll/dto/create-payroll-group-installment.dto';
import { CreatePayrollGroupDto } from '../payroll/dto/create-payroll-group.dto';
import { CreatePayrollPeriodInstallmentDto } from '../payroll/dto/create-payroll-period-installment.dto';
import { CreatePayrollPeriodDto } from '../payroll/dto/create-payroll-period.dto';
import { CreateEmployeeShiftDto } from '../payroll/dto/employee-shift.dto';
import {
  CreateProductDto,
  UpdateProductDto,
} from '../products/dto/product.dto';
import { CancelPurchaseOrderDto } from '../purchase-orders/dto/cancel-purchase-order.dto';
import { CreatePurchaseOrderDto } from '../purchase-orders/dto/create-purchase-order.dto';
import { QueryPurchaseOrdersDto } from '../purchase-orders/dto/query-purchase-orders.dto';
import { UpdatePurchaseOrderDto } from '../purchase-orders/dto/update-purchase-order.dto';
import {
  CreateSaleDto,
  FindSalesQueryDto,
  SaleItemDto,
  UpdateSaleDto,
} from '../sales/dto/sales.dto';
import {
  UpdateOrganizationNameDto,
  UpdateReceiptPrefixDto,
  UpdateSettingsDto,
} from '../settings/dto/settings.dto';
import { CreateSupplierDto } from '../suppliers/dto/create-supplier.dto';
import { QuerySuppliersDto } from '../suppliers/dto/query-suppliers.dto';
import { UpdateSupplierDto } from '../suppliers/dto/update-supplier.dto';
import { QueryTasksDto } from '../tasks/dto/query-tasks.dto';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { UpdateUserDto } from '../users/dto/update-user.dto';

/**
 * Every `@IsString()` DTO field bounded when meperpos/require-string-length-bound
 * landed (explorer finding F39). For each one, a value of exactly the limit
 * passes the field's own validators and one character more fails `maxLength`.
 * The global ValidationPipe answers 400 for that failure.
 */
type Row = {
  dto: ClassConstructor<object>;
  field: string;
  max: number;
  /** Builds a value of `length` characters that satisfies the field's other validators. */
  make?: (length: number) => string;
  each?: true;
};

const letters = (length: number) => 'a'.repeat(length);
// Payroll amounts: digits with two decimals, so `@Matches(/^\d+(\.\d{1,2})?$/)` holds.
const amount = (length: number) => `${'9'.repeat(length - 3)}.99`;

const rows: Row[] = [
  { dto: UpdateOrganizationNameDto, field: 'name', max: 100 },
  { dto: UpdateReceiptPrefixDto, field: 'prefix', max: 20 },
  { dto: UpdateSettingsDto, field: 'printHeader', max: 500 },
  { dto: UpdateSettingsDto, field: 'printFooter', max: 500 },
  { dto: DeleteOrganizationDto, field: 'confirmOrganizationName', max: 100 },
  { dto: UpdateOrganizationDto, field: 'logoUrl', max: 2048 },
  { dto: LoginDto, field: 'password', max: 128 },
  { dto: RegisterDto, field: 'name', max: 100 },
  { dto: AuthCreateUserDto, field: 'name', max: 100 },
  { dto: UpdateProfileDto, field: 'name', max: 100 },
  { dto: ChangePasswordDto, field: 'currentPassword', max: 128 },
  { dto: RefreshTokenDto, field: 'refreshToken', max: 256 },
  { dto: SelectOrganizationDto, field: 'preAuthToken', max: 2048 },
  { dto: SelectOrganizationDto, field: 'organizationId', max: 64 },
  { dto: CreatePaymentRecordDto, field: 'organizationId', max: 64 },
  { dto: CreateCashRegisterDto, field: 'name', max: 100 },
  { dto: UpdateCashRegisterDto, field: 'name', max: 100 },
  { dto: CreateCategoryDto, field: 'name', max: 100 },
  { dto: CreateCategoryDto, field: 'description', max: 500 },
  { dto: UpdateCategoryDto, field: 'name', max: 100 },
  { dto: UpdateCategoryDto, field: 'description', max: 500 },
  ...[CreateCustomerDto, UpdateCustomerDto].flatMap((dto) => [
    { dto, field: 'name', max: 100 },
    { dto, field: 'documentType', max: 20 },
    { dto, field: 'documentNumber', max: 30 },
    { dto, field: 'phone', max: 30 },
    { dto, field: 'referencia', max: 200 },
    { dto, field: 'placaMoto', max: 40 },
    { dto, field: 'address', max: 200 },
  ]),
  { dto: QueryExpensesDto, field: 'search', max: 200 },
  { dto: InventoryMovementsQueryDto, field: 'productId', max: 64 },
  { dto: ImportRowErrorDto, field: 'code', max: 64 },
  { dto: ImportRowErrorDto, field: 'message', max: 1000 },
  { dto: ImportRowErrorDto, field: 'field', max: 64 },
  { dto: ImportRowErrorDto, field: 'editableFields', max: 64, each: true },
  { dto: ImportRowErrorDto, field: 'correlationId', max: 128 },
  {
    dto: ImportSheetStatusDto,
    field: 'missingRequiredFields',
    max: 64,
    each: true,
  },
  { dto: ImportSheetStatusDto, field: 'planLimitMessage', max: 500 },
  { dto: ImportSheetStatusDto, field: 'roleRejectedMessage', max: 500 },
  { dto: ImportJobStatusResponseDto, field: 'jobId', max: 64 },
  ...[
    CorrectPayrollGroupInstallmentDto,
    CorrectPayrollPeriodInstallmentDto,
    CreatePayrollGroupInstallmentDto,
    CreatePayrollPeriodInstallmentDto,
  ].map((dto) => ({ dto, field: 'amount', max: 13, make: amount })),
  { dto: CreatePayrollPeriodDto, field: 'periodAmount', max: 13, make: amount },
  { dto: CreatePayrollGroupDto, field: 'employeeId', max: 64 },
  { dto: CreatePayrollGroupDto, field: 'shiftIds', max: 64, each: true },
  { dto: CreateEmployeeShiftDto, field: 'observation', max: 200 },
  ...[CreateProductDto, UpdateProductDto].flatMap((dto) => [
    { dto, field: 'name', max: 200 },
    { dto, field: 'sku', max: 50 },
    { dto, field: 'barcode', max: 50 },
    { dto, field: 'description', max: 2000 },
    { dto, field: 'imageUrl', max: 2048 },
  ]),
  { dto: CancelPurchaseOrderDto, field: 'reason', max: 500 },
  { dto: CreatePurchaseOrderDto, field: 'notes', max: 500 },
  { dto: UpdatePurchaseOrderDto, field: 'notes', max: 500 },
  { dto: QueryPurchaseOrdersDto, field: 'q', max: 200 },
  { dto: SaleItemDto, field: 'productId', max: 64 },
  { dto: CreateSaleDto, field: 'customerId', max: 64 },
  { dto: UpdateSaleDto, field: 'cancelReason', max: 500 },
  { dto: FindSalesQueryDto, field: 'startDate', max: 40 },
  { dto: FindSalesQueryDto, field: 'endDate', max: 40 },
  { dto: FindSalesQueryDto, field: 'status', max: 64 },
  { dto: FindSalesQueryDto, field: 'search', max: 200 },
  { dto: FindSalesQueryDto, field: 'customerId', max: 64 },
  ...[CreateSupplierDto, UpdateSupplierDto].flatMap((dto) => [
    { dto, field: 'name', max: 100 },
    { dto, field: 'documentNumber', max: 30 },
    { dto, field: 'phone', max: 30 },
    { dto, field: 'address', max: 200 },
    { dto, field: 'contactName', max: 100 },
    { dto, field: 'bank', max: 100 },
    { dto, field: 'accountNumber', max: 50 },
  ]),
  { dto: QuerySuppliersDto, field: 'search', max: 200 },
  { dto: QueryTasksDto, field: 'search', max: 200 },
  { dto: QueryTasksDto, field: 'assignedToId', max: 64 },
  { dto: QueryTasksDto, field: 'createdById', max: 64 },
  { dto: CreateUserDto, field: 'name', max: 100 },
  { dto: UpdateUserDto, field: 'name', max: 100 },
];

async function fieldConstraints(row: Row, length: number) {
  const text = (row.make ?? letters)(length);
  const value = row.each ? [text] : text;
  const dto = plainToInstance(row.dto, { [row.field]: value });
  const errors = await validate(dto);
  return errors.find((error) => error.property === row.field)?.constraints;
}

describe('DTO string length bounds (F39)', () => {
  it.each(rows.map((row) => [row.dto.name, row.field, row.max, row] as const))(
    '%s.%s accepts %i characters and rejects one more',
    async (_dto, _field, max, row) => {
      expect(await fieldConstraints(row, max)).toBeUndefined();

      const tooLong = await fieldConstraints(row, max + 1);
      expect(tooLong).toHaveProperty('maxLength');
    },
  );
});
