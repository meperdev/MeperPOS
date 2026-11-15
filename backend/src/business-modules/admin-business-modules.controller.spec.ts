import {
  ForbiddenException,
  ValidationPipe,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  AdminBusinessModulesController,
  UpdateModuleDto,
} from './admin-business-modules.controller';

describe('AdminBusinessModulesController', () => {
  const modules = { listForOrganization: jest.fn(), setEnabled: jest.fn() };
  const controller = new AdminBusinessModulesController(modules as never);
  const context = (role: string) =>
    ({
      getHandler: () => controller.update,
      getClass: () => AdminBusinessModulesController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role, isSuperAdmin: role === 'SUPER_ADMIN' },
        }),
      }),
    }) as unknown as ExecutionContext;

  it('permits only superadmins to change modules', () => {
    const guard = new RolesGuard(new Reflector());
    expect(() => guard.canActivate(context('ADMIN'))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(context('SUPER_ADMIN'))).toBe(true);
  });

  it('validates input before allowing an update', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        { enabled: 'false' },
        { type: 'body', metatype: UpdateModuleDto },
      ),
    ).rejects.toThrow();
    await expect(
      pipe.transform(
        { enabled: true, other: true },
        { type: 'body', metatype: UpdateModuleDto },
      ),
    ).rejects.toThrow();
  });

  it('lists every module of the requested organization', async () => {
    const catalog = [
      { id: 'vehicles', name: 'Vehículos', description: '...', enabled: true },
    ];
    modules.listForOrganization.mockResolvedValue(catalog);

    await expect(controller.findAll('org-1')).resolves.toEqual(catalog);
    expect(modules.listForOrganization).toHaveBeenCalledWith('org-1');
  });

  it('updates the requested organization and module only', async () => {
    modules.setEnabled.mockResolvedValue({ enabled: false });
    await expect(
      controller.update('org-1', 'vehicles', { enabled: false }),
    ).resolves.toEqual({ enabled: false });
    expect(modules.setEnabled).toHaveBeenCalledWith('org-1', 'vehicles', false);
  });
});
