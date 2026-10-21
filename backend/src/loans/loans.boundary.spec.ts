import 'reflect-metadata';
import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { of } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { LoansController } from './loans.controller';
import { CounterpartyType, CreateLoanDto } from './dto/create-loan.dto';
import { LoanOperationDto } from './dto/loan-operation.dto';
import { QueryLoansDto } from './dto/query-loans.dto';

const valid = {
  amount: 0.01,
  issuedAt: '2026-10-09',
  reason: 'Préstamo independiente',
  counterpartyType: CounterpartyType.CUSTOMER,
  counterpartyId: '00000000-0000-4000-8000-000000000001',
};
// Match the production pipe, including implicit conversion of reflected types.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});
const validateCreate = (value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: CreateLoanDto });

describe('Loan request validation', () => {
  it.each(['MONEY', 'SERVICE'])('accepts explicit %s type', async (type) => {
    await expect(validateCreate({ ...valid, type })).resolves.toMatchObject({
      type,
    });
    await expect(
      pipe.transform(
        { type, page: '2', limit: '100' },
        {
          type: 'query',
          metatype: QueryLoansDto,
        },
      ),
    ).resolves.toMatchObject({ type, page: 2, limit: 100 });
  });

  it.each([null, true, false, 'PRODUCTS', 'EQUIPMENT', '', 'service', 1])(
    'rejects unsupported raw type %j on create and list',
    async (type) => {
      await expect(validateCreate({ ...valid, type })).rejects.toThrow();
      await expect(
        pipe.transform(
          { type },
          {
            type: 'query',
            metatype: QueryLoansDto,
          },
        ),
      ).rejects.toThrow();
    },
  );

  it.each([0.01, 120.25, 99999999.99])(
    'accepts representable amount %s',
    async (amount) => {
      await expect(
        validateCreate({ ...valid, amount }),
      ).resolves.toBeInstanceOf(CreateLoanDto);
    },
  );

  it.each([0, -1, 0.001, 12.345, 100000000, NaN, Infinity, '10.00', null])(
    'rejects invalid amount %s',
    async (amount) => {
      await expect(validateCreate({ ...valid, amount })).rejects.toThrow();
    },
  );

  it.each([
    { issuedAt: 'not-a-date' },
    { issuedAt: '2026-02-30' },
    { issuedAt: '2026-02-29' },
    { dueAt: '2026-13-01' },
    { issuedAt: '2026-10-09T00:00:00Z' },
    { reason: '' },
    { reason: '   ' },
    { reason: 123 },
    { reason: 'x'.repeat(501) },
    { counterpartyType: 'OTHER' },
    { counterpartyId: undefined },
    { counterpartyId: 'not-a-uuid' },
    { employeeId: valid.counterpartyId },
    { organizationId: 'foreign' },
    { createdById: 'forged-actor' },
  ])('rejects invalid or actor/tenant-spoofing input %j', async (input) => {
    await expect(validateCreate({ ...valid, ...input })).rejects.toThrow();
  });

  it('transforms and bounds pagination', async () => {
    const meta = { type: 'query' as const, metatype: QueryLoansDto };
    await expect(
      pipe.transform({ page: '2', limit: '100' }, meta),
    ).resolves.toEqual({ page: 2, limit: 100 });
    for (const input of [
      { page: 0 },
      { limit: 101 },
      { page: 1.5 },
      { limit: -1 },
      { page: 1000001 },
    ]) {
      await expect(pipe.transform(input, meta)).rejects.toThrow();
    }
  });
});

describe('Loan backend role boundary', () => {
  const guard = new RolesGuard(new Reflector());
  function context(
    method: keyof LoansController,
    role: OrgRole | 'SUPER_ADMIN',
    isSuperAdmin = false,
  ) {
    return {
      getHandler: () => LoansController.prototype[method],
      getClass: () => LoansController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role, isSuperAdmin } }),
      }),
    } as unknown as ExecutionContext;
  }

  it('installs the existing authentication, role and organization boundaries', () => {
    expect(Reflect.getMetadata('__guards__', LoansController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
      OrganizationRequiredGuard,
    ]);
    expect(Reflect.getMetadata('__interceptors__', LoansController)).toEqual([
      AdminOrganizationInterceptor,
    ]);
  });

  it.each(Object.values(OrgRole))(
    'enforces creation and reads for %s using real guard metadata',
    (role) => {
      if (role === OrgRole.OWNER || role === OrgRole.ADMIN) {
        expect(guard.canActivate(context('create', role))).toBe(true);
      } else {
        expect(() => guard.canActivate(context('create', role))).toThrow(
          ForbiddenException,
        );
      }
      for (const method of ['findAll', 'findOne', 'getHistory'] as const) {
        if (role === OrgRole.INVENTORY_USER) {
          expect(() => guard.canActivate(context(method, role))).toThrow(
            ForbiddenException,
          );
        } else {
          expect(guard.canActivate(context(method, role))).toBe(true);
        }
      }
    },
  );

  it('retains the existing SUPER_ADMIN guard bypass', () => {
    expect(guard.canActivate(context('create', 'SUPER_ADMIN', true))).toBe(
      true,
    );
    expect(guard.canActivate(context('findAll', 'SUPER_ADMIN', true))).toBe(
      true,
    );
  });

  it.each([false, true])(
    'uses the existing tenant-selector interceptor with isSuperAdmin=%s',
    (isSuperAdmin) => {
      const request = {
        user: { userId: 'actor', organizationId: 'org-a', isSuperAdmin },
        headers: { 'x-organization-id': 'org-b' },
        query: { organizationId: 'org-c' },
      };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      const next: CallHandler = { handle: () => of(null) };
      new AdminOrganizationInterceptor().intercept(ctx, next);
      expect(request.user.organizationId).toBe(
        isSuperAdmin ? 'org-b' : 'org-a',
      );
      expect(request.user.userId).toBe('actor');
    },
  );
});

describe('POS completion route boundary', () => {
  const user = {
    userId: 'actor',
    organizationId: 'org',
    role: OrgRole.CASHIER,
    isSuperAdmin: false,
  } as never;

  it('declares the CASHIER POST pos-completion route', () => {
    const handler = LoansController.prototype.completePosSale;
    expect(Reflect.getMetadata('path', handler)).toBe(':id/pos-completion');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([OrgRole.CASHIER]);
  });

  it('forwards the id, validated body, organization and actor', async () => {
    const service = {
      completePosSale: jest.fn().mockResolvedValue({ saleId: 'sale' }),
    };
    const controller = new LoansController(service as never);
    const dto = await pipe.transform(
      { requestKey: 'complete-1' },
      { type: 'body', metatype: LoanOperationDto },
    );
    await expect(
      controller.completePosSale('sale-id', dto, user),
    ).resolves.toEqual({ saleId: 'sale' });
    expect(service.completePosSale).toHaveBeenCalledWith(
      'sale-id',
      dto,
      'org',
      user,
    );
  });
});
