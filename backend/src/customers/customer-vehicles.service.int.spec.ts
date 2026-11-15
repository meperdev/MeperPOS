import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BusinessModulesService } from '../business-modules/business-modules.service';
import { CustomerVehiclesService } from './customer-vehicles.service';
import { CustomersService } from './customers.service';

describe('Customer vehicles tenant isolation (integration)', () => {
  const prisma = new PrismaClient();
  const modules = new BusinessModulesService(prisma as never);
  const vehicles = new CustomerVehiclesService(prisma as never, modules);
  const customers = new CustomersService(
    prisma as never,
    { invalidateCache: () => undefined } as never,
  );
  let orgA: string;
  let orgB: string;
  let customerId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const a = await prisma.organization.create({
      data: { name: 'A', slug: `vehicles-a-${suffix}` },
    });
    const b = await prisma.organization.create({
      data: { name: 'B', slug: `vehicles-b-${suffix}` },
    });
    orgA = a.id;
    orgB = b.id;
    const customer = await prisma.customer.create({
      data: {
        organizationId: orgA,
        name: 'A customer',
        documentType: 'CC',
        documentNumber: suffix,
        placaMoto: 'LEGACY',
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    if (orgA || orgB)
      await prisma.organization.deleteMany({
        where: { id: { in: [orgA, orgB].filter(Boolean) } },
      });
    await prisma.$disconnect();
  });

  it('keeps legacy and vehicle plates synchronized in both directions without deleting vehicle details', async () => {
    const customer = await customers.create(
      {
        name: 'Legacy sync',
        documentType: 'CC',
        documentNumber: `sync-${Date.now()}`,
        placaMoto: 'AAA123',
      },
      orgA,
    );
    const legacy = await prisma.customerVehicle.findUniqueOrThrow({
      where: { legacyCustomerId: customer.id },
    });
    expect(legacy.plate).toBe('AAA123');
    await customers.update(customer.id, { placaMoto: 'BBB123' }, orgA);
    expect(
      (
        await prisma.customerVehicle.findUniqueOrThrow({
          where: { id: legacy.id },
        })
      ).plate,
    ).toBe('BBB123');
    await vehicles.update(orgA, customer.id, legacy.id, {
      plate: 'CCC123',
      model: 'Model X',
    });
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } }))
        .placaMoto,
    ).toBe('CCC123');
    await customers.update(customer.id, { placaMoto: null }, orgA);
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } }))
        .placaMoto,
    ).toBeNull();
    expect(
      await prisma.customerVehicle.findUniqueOrThrow({
        where: { id: legacy.id },
      }),
    ).toEqual(
      expect.objectContaining({
        plate: 'CCC123',
        model: 'Model X',
        legacyCustomerId: null,
      }),
    );
    await customers.update(customer.id, { placaMoto: 'DDD123' }, orgA);
    expect(
      await prisma.customerVehicle.findUniqueOrThrow({
        where: { legacyCustomerId: customer.id },
      }),
    ).toEqual(expect.objectContaining({ plate: 'DDD123', model: null }));
    expect(
      await prisma.customerVehicle.findUniqueOrThrow({
        where: { id: legacy.id },
      }),
    ).toEqual(
      expect.objectContaining({
        plate: 'CCC123',
        model: 'Model X',
        legacyCustomerId: null,
      }),
    );
  });

  it('keeps both representations consistent under concurrent updates', async () => {
    const customer = await customers.create(
      {
        name: 'Concurrent sync',
        documentType: 'CC',
        documentNumber: `concurrent-${Date.now()}`,
        placaMoto: 'AAA123',
      },
      orgA,
    );
    const vehicle = await prisma.customerVehicle.findUniqueOrThrow({
      where: { legacyCustomerId: customer.id },
    });
    const outcomes = await Promise.allSettled([
      customers.update(customer.id, { placaMoto: 'BBB123' }, orgA),
      vehicles.update(orgA, customer.id, vehicle.id, { plate: 'CCC123' }),
    ]);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(
      true,
    );
    const currentCustomer = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    const currentVehicle = await prisma.customerVehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
    });
    expect(currentCustomer.placaMoto).toBe(currentVehicle.plate);
  });

  it('isolates customer vehicles, preserves existing plates and retains vehicles when disabled', async () => {
    await vehicles.create(orgA, customerId, {
      plate: 'ABC123',
      model: 'Model X',
    });
    expect(await vehicles.list(orgA, customerId)).toEqual([
      expect.objectContaining({ plate: 'ABC123', model: 'Model X' }),
    ]);
    await expect(vehicles.list(orgB, customerId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      vehicles.create(orgB, customerId, { plate: 'XYZ123' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await modules.setEnabled(orgA, 'vehicles', false);
    await expect(vehicles.list(orgA, customerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      vehicles.create(orgA, customerId, { plate: 'DEF123' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await modules.setEnabled(orgA, 'vehicles', true);
    expect(await vehicles.list(orgA, customerId)).toEqual([
      expect.objectContaining({ plate: 'ABC123' }),
    ]);
    expect(
      (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } }))
        .placaMoto,
    ).toBe('LEGACY');
  });
});
