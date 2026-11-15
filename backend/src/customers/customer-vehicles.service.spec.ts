import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CustomerVehiclesService } from './customer-vehicles.service';

describe('CustomerVehiclesService', () => {
  const prisma = {
    $transaction: jest.fn(),
    customer: { findFirst: jest.fn(), updateMany: jest.fn() },
    customerVehicle: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const modules = { isEnabled: jest.fn() };
  let service: CustomerVehiclesService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    service = new CustomerVehiclesService(prisma as never, modules as never);
    modules.isEnabled.mockResolvedValue(true);
    prisma.customer.findFirst.mockResolvedValue({ id: 'customer-1' });
  });

  it('rejects access if the module is disabled without touching vehicles', async () => {
    modules.isEnabled.mockResolvedValue(false);
    await expect(service.list('org-1', 'customer-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.customerVehicle.findMany).not.toHaveBeenCalled();
    await expect(
      service.create('org-1', 'customer-1', { plate: 'ABC123' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.customerVehicle.create).not.toHaveBeenCalled();
  });

  it('requires an organization scope', async () => {
    await expect(service.list('', 'customer-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('does not return or add vehicles for another organization’s customer', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    await expect(service.list('org-1', 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.create('org-1', 'other', { plate: 'ABC123' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'other', organizationId: 'org-1', active: true },
      select: { id: true },
    });
    expect(prisma.customerVehicle.findMany).not.toHaveBeenCalled();
    expect(prisma.customerVehicle.create).not.toHaveBeenCalled();
  });

  it('lists vehicles scoped to both customer and organization', async () => {
    prisma.customerVehicle.findMany.mockResolvedValue([
      { plate: 'ABC123', model: 'X' },
    ]);
    await expect(service.list('org-1', 'customer-1')).resolves.toEqual([
      { plate: 'ABC123', model: 'X' },
    ]);
    expect(prisma.customerVehicle.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', customerId: 'customer-1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('updates a vehicle only inside its customer and organization', async () => {
    prisma.customerVehicle.updateMany.mockResolvedValue({ count: 1 });
    prisma.customerVehicle.findFirst.mockResolvedValue({
      id: 'v-1',
      plate: 'ABC123',
      model: 'Y',
    });
    await expect(
      service.update('org-1', 'customer-1', 'v-1', { model: 'Y' }),
    ).resolves.toEqual({ id: 'v-1', plate: 'ABC123', model: 'Y' });
    expect(prisma.customerVehicle.updateMany).toHaveBeenCalledWith({
      where: { id: 'v-1', customerId: 'customer-1', organizationId: 'org-1' },
      data: { model: 'Y' },
    });
    prisma.customerVehicle.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.update('org-1', 'customer-1', 'other', { model: 'Y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a vehicle under the scoped customer', async () => {
    prisma.customerVehicle.create.mockResolvedValue({
      plate: 'ABC123',
      model: 'X',
    });
    await expect(
      service.create('org-1', 'customer-1', { plate: 'ABC123', model: 'X' }),
    ).resolves.toEqual({ plate: 'ABC123', model: 'X' });
    expect(prisma.customerVehicle.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        customerId: 'customer-1',
        plate: 'ABC123',
        model: 'X',
      },
    });
  });
});
