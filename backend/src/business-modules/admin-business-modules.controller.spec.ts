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
  const modules = { isEnabled: jest.fn(), setEnabled: jest.fn() };
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

  it('updates the requested organization only', async () => {
    modules.setEnabled.mockResolvedValue({ enabled: false });
    await expect(
      controller.update('org-1', { enabled: false }),
    ).resolves.toEqual({ enabled: false });
    expect(modules.setEnabled).toHaveBeenCalledWith('org-1', 'vehicles', false);
  });
});
