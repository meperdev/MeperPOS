import {
  ForbiddenException,
  ValidationPipe,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  CustomerVehiclesController,
  CreateCustomerVehicleDto,
  UpdateCustomerVehicleDto,
} from './customer-vehicles.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

describe('CustomerVehiclesController', () => {
  const service = { list: jest.fn(), create: jest.fn() };
  const controller = new CustomerVehiclesController(service as never);

  it('uses the authenticated organization for customer vehicle reads and writes', async () => {
    service.list.mockResolvedValue([]);
    service.create.mockResolvedValue({ plate: 'ABC123' });
    const user = { organizationId: 'org-1' } as never;
    await controller.list('customer-1', user);
    await controller.create('customer-1', user, {
      plate: 'ABC123',
      model: 'X',
    });
    expect(service.list).toHaveBeenCalledWith('org-1', 'customer-1');
    expect(service.create).toHaveBeenCalledWith('org-1', 'customer-1', {
      plate: 'ABC123',
      model: 'X',
    });
  });

  it('requires customer access roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, controller.list)).toEqual([
      'ADMIN',
      'MEMBER',
      'CASHIER',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, controller.create)).toEqual([
      'ADMIN',
      'MEMBER',
      'CASHIER',
    ]);
  });

  it('only permits an administrator to update a vehicle', () => {
    const guard = new RolesGuard(new Reflector());
    const context = (role: string) =>
      ({
        getHandler: () => controller.update,
        getClass: () => CustomerVehiclesController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context('CASHIER'))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(context('ADMIN'))).toBe(true);
  });

  it('rejects an empty plate and undeclared fields', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { plate: '' },
        { type: 'body', metatype: CreateCustomerVehicleDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { plate: '  ' },
        { type: 'body', metatype: CreateCustomerVehicleDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { plate: null },
        { type: 'body', metatype: UpdateCustomerVehicleDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { plate: 'ABC123', organizationId: 'other' },
        { type: 'body', metatype: CreateCustomerVehicleDto },
      ),
    ).rejects.toThrow();
  });
});
