import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  const usersServiceMock = {
    update: jest.fn(),
    resetPassword: jest.fn(),
    findAll: jest.fn(),
    toggleActive: jest.fn(),
    remove: jest.fn(),
  };

  const createContext = (
    handler: (...args: unknown[]) => unknown,
    role: string,
    isSuperAdmin = false,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => UsersController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role, isSuperAdmin } }),
      }),
    }) as unknown as ExecutionContext;

  it('marks the controller as ADMIN-only', () => {
    const requiredRoles = Reflect.getMetadata(ROLES_KEY, UsersController);

    expect(requiredRoles).toEqual(['ADMIN']);
  });

  it('denies non-admin access at the users boundary', () => {
    const controller = new UsersController(usersServiceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(createContext(controller.findAll, 'CASHIER')),
    ).toThrow(ForbiddenException);
  });

  it('allows SuperAdmin access at the users boundary', () => {
    const controller = new UsersController(usersServiceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(
      guard.canActivate(createContext(controller.findAll, 'SUPER_ADMIN', true)),
    ).toBe(true);
  });

  it('delegates update with the acting admin id and organizationId', async () => {
    const controller = new UsersController(usersServiceMock as never);
    const dto = { name: 'Ana Admin' };
    const user = {
      userId: 'admin-1',
      organizationId: 'org-1',
      role: 'ADMIN' as const,
      email: 'a@a.com',
      tokenVersion: 1,
      isSuperAdmin: false,
    };
    const expected = {
      id: 'user-2',
      ...dto,
      email: 'ana@example.com',
      active: true,
    };

    usersServiceMock.update.mockResolvedValue(expected);

    await expect(controller.update('user-2', dto, user)).resolves.toEqual(
      expected,
    );
    expect(usersServiceMock.update).toHaveBeenCalledWith(
      'admin-1',
      'user-2',
      dto,
      'org-1',
    );
  });

  it('delegates password resets to the users service with organizationId', async () => {
    const controller = new UsersController(usersServiceMock as never);
    const dto = { newPassword: 'NuevaClaveSegura123' };
    const user = {
      userId: 'admin-1',
      organizationId: 'org-1',
      role: 'ADMIN' as const,
      email: 'a@a.com',
      tokenVersion: 1,
      isSuperAdmin: false,
    };
    const expected = { message: 'Contraseña restablecida exitosamente' };

    usersServiceMock.resetPassword.mockResolvedValue(expected);

    await expect(
      controller.resetPassword('user-2', dto, user),
    ).resolves.toEqual(expected);
    expect(usersServiceMock.resetPassword).toHaveBeenCalledWith(
      'admin-1',
      'user-2',
      dto,
      'org-1',
      // SEC-001: the controller forwards the acting user so the service can
      // enforce the ADMIN-cannot-reset-OWNER guardrail.
      user,
    );
  });

  it('delegates findAll with organizationId from current user', async () => {
    const controller = new UsersController(usersServiceMock as never);
    const user = {
      userId: 'admin-1',
      organizationId: 'org-1',
      role: 'ADMIN' as const,
      email: 'a@a.com',
      tokenVersion: 1,
      isSuperAdmin: false,
    };

    usersServiceMock.findAll.mockResolvedValue([]);

    await controller.findAll(user);
    expect(usersServiceMock.findAll).toHaveBeenCalledWith('org-1');
  });

  describe('create-user body (S8 b)', () => {
    const body = (role: string) => ({
      email: 'new@example.com',
      password: 'S3cure-Passphrase-42',
      name: 'New User',
      role,
    });
    const roleConstraints = async (role: string) => {
      const errors = await validate(plainToInstance(CreateUserDto, body(role)));
      return Object.keys(
        errors.find((error) => error.property === 'role')?.constraints ?? {},
      );
    };

    it('rejects the retired OWNER role before the service runs', async () => {
      expect(await roleConstraints('OWNER')).toContain('isNotIn');
    });

    it('keeps accepting the roles the team screen offers', async () => {
      for (const role of ['ADMIN', 'CASHIER', 'INVENTORY_USER']) {
        expect(await roleConstraints(role)).toEqual([]);
      }
    });
  });
});
