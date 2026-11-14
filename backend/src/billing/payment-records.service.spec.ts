import {
  BillingStatus,
  OrgStatus,
  PaymentRecordStatus,
} from '@prisma/client';
import { PaymentRecordsService } from './payment-records.service';

describe('PaymentRecordsService', () => {
  const prisma = {
    paymentRecord: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    organization: {
      update: jest.fn(),
    },
  };

  let service: PaymentRecordsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentRecordsService(prisma as never);
  });

  it('scopes the payment history to the organization', async () => {
    prisma.paymentRecord.findMany.mockResolvedValue([]);

    await service.findAllByOrg('org-1');

    expect(prisma.paymentRecord.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: { date: 'desc' },
    });
  });

  it('lists every payment for a SuperAdmin without an organization scope', async () => {
    prisma.paymentRecord.findMany.mockResolvedValue([]);

    await service.findAllByOrg(undefined);

    expect(prisma.paymentRecord.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { date: 'desc' },
    });
  });

  it('reactivates the organization when the payment is PAID', async () => {
    prisma.paymentRecord.create.mockResolvedValue({
      id: 'payment-1',
      status: PaymentRecordStatus.PAID,
    });
    prisma.organization.update.mockResolvedValue({ id: 'org-1' });

    await service.create({
      organizationId: 'org-1',
      amount: 150000,
      method: 'CASH',
    } as never);

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: {
        status: OrgStatus.ACTIVE,
        billingStatus: BillingStatus.PAID,
      },
    });
  });

  it('leaves the organization untouched for a pending payment', async () => {
    prisma.paymentRecord.create.mockResolvedValue({
      id: 'payment-1',
      status: PaymentRecordStatus.PENDING,
    });

    await service.create({
      organizationId: 'org-1',
      amount: 150000,
      method: 'CASH',
      status: PaymentRecordStatus.PENDING,
    } as never);

    expect(prisma.organization.update).not.toHaveBeenCalled();
  });
});
