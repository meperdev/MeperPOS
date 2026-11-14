import { OrgRole } from '@prisma/client';
import { BillingController } from './billing.controller';
import type { PaymentRecordsService } from './payment-records.service';
import type { BillingService } from './billing.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';

describe('BillingController', () => {
  const paymentRecords = { findAllByOrg: jest.fn(), create: jest.fn() };
  const billing = { getStatus: jest.fn() };
  let controller: BillingController;

  const user = (organizationId?: string): RequestUser => ({
    userId: 'user-1',
    email: 'admin@example.com',
    organizationId,
    role: OrgRole.ADMIN,
    tokenVersion: 1,
    isSuperAdmin: false,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new BillingController(
      paymentRecords as unknown as PaymentRecordsService,
      billing as unknown as BillingService,
    );
  });

  it('lists the payments of the current organization', async () => {
    paymentRecords.findAllByOrg.mockResolvedValue([{ id: 'payment-1' }]);

    await expect(controller.getPayments(user('org-1'))).resolves.toEqual([
      { id: 'payment-1' },
    ]);
    expect(paymentRecords.findAllByOrg).toHaveBeenCalledWith('org-1');
  });

  it('lists every payment when a SuperAdmin has no organization scope', async () => {
    paymentRecords.findAllByOrg.mockResolvedValue([]);

    await controller.getPayments(user(undefined));

    expect(paymentRecords.findAllByOrg).toHaveBeenCalledWith(undefined);
  });

  it('registers a payment through the payments service', async () => {
    const dto = {
      organizationId: 'org-1',
      amount: 150000,
      method: 'CASH',
    } as never;
    paymentRecords.create.mockResolvedValue({ id: 'payment-1' });

    await expect(controller.createPayment(dto)).resolves.toEqual({
      id: 'payment-1',
    });
    expect(paymentRecords.create).toHaveBeenCalledWith(dto);
  });

  it('returns the billing status of the current organization', async () => {
    billing.getStatus.mockResolvedValue({ plan: 'BASIC', status: 'TRIAL' });

    await expect(controller.getStatus(user('org-1'))).resolves.toEqual({
      plan: 'BASIC',
      status: 'TRIAL',
    });
    expect(billing.getStatus).toHaveBeenCalledWith('org-1');
  });
});
