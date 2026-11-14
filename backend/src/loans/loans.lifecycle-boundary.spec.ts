import 'reflect-metadata';
import {
  ExecutionContext,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole, PaymentMethod } from '@prisma/client';
import { RolesGuard } from '../common/guards/roles.guard';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import {
  CollectLoanDto,
  LoanOperationDto,
  ReasonLoanDto,
  ReverseLoanDto,
} from './dto/loan-operation.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});
const valid = { requestKey: 'retry-1', amount: 0.01, method: 'CASH' };
const validate = (value: unknown, metatype = CollectLoanDto) =>
  pipe.transform(value, { type: 'body', metatype });

describe('Money lifecycle request boundary', () => {
  it.each(Object.values(PaymentMethod))(
    'accepts method %s without coercing money',
    async (method) => {
      await expect(validate({ ...valid, method })).resolves.toEqual({
        ...valid,
        method,
      });
    },
  );
  it.each([
    0,
    -1,
    0.001,
    12.345,
    100000000,
    NaN,
    Infinity,
    '10.00',
    null,
    {},
    true,
  ])('rejects malformed amount %s', async (amount) => {
    await expect(validate({ ...valid, amount })).rejects.toThrow();
  });
  it.each([
    { requestKey: '' },
    { requestKey: '  ' },
    { requestKey: 123 },
    { requestKey: null },
    { requestKey: 'x'.repeat(101) },
    { method: 'OTHER' },
    { balance: 0 },
    { status: 'CLOSED' },
    { organizationId: 'foreign' },
    { createdById: 'forged' },
  ])('rejects malformed or forged collection %j', async (extra) => {
    await expect(validate({ ...valid, ...extra })).rejects.toThrow();
  });
  it('accepts closure only with a request key', async () => {
    await expect(
      validate({ requestKey: 'close-1' }, LoanOperationDto),
    ).resolves.toEqual({ requestKey: 'close-1' });
    await expect(
      validate({ requestKey: 'close-1', amount: 0 }, LoanOperationDto),
    ).rejects.toThrow();
  });
  it.each([ReasonLoanDto, ReverseLoanDto])(
    'requires a raw meaningful reason in %p',
    async (metatype) => {
      await expect(
        validate(
          { requestKey: 'reason-1', reason: '  Corrección  ' },
          metatype,
        ),
      ).resolves.toEqual({ requestKey: 'reason-1', reason: 'Corrección' });
      for (const reason of ['', '  ', 123, null, 'x'.repeat(501)]) {
        await expect(
          validate({ requestKey: 'reason-1', reason }, metatype),
        ).rejects.toThrow();
      }
      await expect(
        validate(
          {
            requestKey: 'reason-1',
            reason: 'Corrección',
            paymentId: 'forged',
          },
          metatype,
        ),
      ).rejects.toThrow();
    },
  );
});

describe('Money lifecycle actual controller guards', () => {
  const guard = new RolesGuard(new Reflector());
  const context = (
    method: keyof LoansController,
    role: OrgRole | 'SUPER_ADMIN',
    isSuperAdmin = false,
  ) =>
    ({
      getHandler: () => LoansController.prototype[method],
      getClass: () => LoansController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role, isSuperAdmin } }),
      }),
    }) as unknown as ExecutionContext;
  it.each(Object.values(OrgRole))(
    'enforces mutation permissions for %s',
    (role) => {
      for (const method of ['collect', 'close', 'reverse', 'cancel'] as const) {
        const allowed =
          method === 'collect'
            ? role !== OrgRole.INVENTORY_USER
            : role === OrgRole.OWNER || role === OrgRole.ADMIN;
        if (allowed)
          expect(guard.canActivate(context(method, role))).toBe(true);
        else
          expect(() => guard.canActivate(context(method, role))).toThrow(
            ForbiddenException,
          );
      }
    },
  );
  it('preserves the existing pseudo-super-admin bypass for all mutations', () => {
    for (const method of ['collect', 'close', 'reverse', 'cancel'] as const)
      expect(guard.canActivate(context(method, 'SUPER_ADMIN', true))).toBe(
        true,
      );
  });
  it('forwards authenticated actor/tenant and path reversal target, never body identity', async () => {
    const mutate = jest.fn().mockResolvedValue({ balance: '0.00' });
    const controller = new LoansController({
      mutate,
    } as unknown as LoansService);
    const user = { userId: 'actor', organizationId: 'org' } as RequestUser;
    await controller.collect(
      'loan',
      { ...valid, method: PaymentMethod.CASH },
      user,
    );
    await controller.close('loan', { requestKey: 'c' }, user);
    await controller.cancel(
      'loan',
      { requestKey: 'x', reason: 'Cancelación' },
      user,
    );
    await controller.reverse(
      'loan',
      'payment',
      { requestKey: 'r', reason: 'Corrección' },
      user,
    );
    expect(mutate.mock.calls).toEqual([
      ['loan', 'COLLECTED', valid, 'actor', 'org'],
      ['loan', 'CLOSED', { requestKey: 'c' }, 'actor', 'org'],
      [
        'loan',
        'CANCELLED',
        { requestKey: 'x', reason: 'Cancelación' },
        'actor',
        'org',
      ],
      [
        'loan',
        'REVERSED',
        { requestKey: 'r', reason: 'Corrección', paymentId: 'payment' },
        'actor',
        'org',
      ],
    ]);
    // Every exposed identifier uses the same UUID pipe as L1.
    for (const method of ['collect', 'close', 'reverse', 'cancel'] as const) {
      expect(
        Reflect.getMetadata('path', LoansController.prototype[method]),
      ).toContain(':id');
      const metadata = Reflect.getMetadata(
        '__routeArguments__',
        LoansController,
        method,
      ) as Record<string, { pipes?: unknown[] }>;
      expect(
        Object.values(metadata).filter((entry) => entry.pipes?.length).length,
      ).toBe(method === 'reverse' ? 2 : 1);
    }
  });
});
