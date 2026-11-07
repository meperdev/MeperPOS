import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminController } from './admin.controller';

describe('AdminController', () => {
  const adminServiceMock = {
    createOrganization: jest.fn(),
    findAllOrganizations: jest.fn(),
    findOrganizationById: jest.fn(),
    updateStatus: jest.fn(),
    updatePlan: jest.fn(),
    getMetrics: jest.fn(),
    updateOrganization: jest.fn(),
    addOrganizationMember: jest.fn(),
    updateMemberRole: jest.fn(),
    removeOrganizationMember: jest.fn(),
    deleteOrganization: jest.fn(),
    updateElectronicInvoicing: jest.fn(),
  };

  const createContext = (
    handler: (...args: unknown[]) => unknown,
    role: string,
    isSuperAdmin = false,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => AdminController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role, isSuperAdmin } }),
      }),
    }) as unknown as ExecutionContext;

  it('marks the controller as SUPER_ADMIN-only', () => {
    const requiredRoles = Reflect.getMetadata(ROLES_KEY, AdminController);

    expect(requiredRoles).toEqual(['SUPER_ADMIN']);
  });

  it('denies non-super-admin access', () => {
    const controller = new AdminController(adminServiceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(() =>
      guard.canActivate(createContext(controller.getMetrics, 'ADMIN')),
    ).toThrow(ForbiddenException);
  });

  it('allows SuperAdmin access', () => {
    const controller = new AdminController(adminServiceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(
      guard.canActivate(
        createContext(controller.getMetrics, 'SUPER_ADMIN', true),
      ),
    ).toBe(true);
  });

  it('denies non-super-admin access to the electronic invoicing switch', () => {
    const controller = new AdminController(adminServiceMock as never);
    const guard = new RolesGuard(new Reflector());

    // Every persisted role, including OWNER, is refused: activation is not an
    // organization privilege (spec S9).
    for (const role of [
      'OWNER',
      'ADMIN',
      'MEMBER',
      'CASHIER',
      'INVENTORY_USER',
    ]) {
      expect(() =>
        guard.canActivate(
          createContext(controller.updateElectronicInvoicing, role),
        ),
      ).toThrow(ForbiddenException);
    }
  });

  it('allows SuperAdmin access to the electronic invoicing switch', () => {
    const controller = new AdminController(adminServiceMock as never);
    const guard = new RolesGuard(new Reflector());

    expect(
      guard.canActivate(
        createContext(
          controller.updateElectronicInvoicing,
          'SUPER_ADMIN',
          true,
        ),
      ),
    ).toBe(true);
  });

  it('delegates createOrganization to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const dto = {
      name: 'New Org',
      slug: 'new-org',
      plan: 'BASIC' as const,
    };
    const expected = { organization: { id: 'org-1' } };

    adminServiceMock.createOrganization.mockResolvedValue(expected);

    await expect(controller.createOrganization(dto)).resolves.toEqual(expected);
    expect(adminServiceMock.createOrganization).toHaveBeenCalledWith(dto);
  });

  it('delegates findAllOrganizations to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const expected = [{ id: 'org-1', name: 'Org One' }];

    adminServiceMock.findAllOrganizations.mockResolvedValue(expected);

    await expect(controller.findAllOrganizations()).resolves.toEqual(expected);
    expect(adminServiceMock.findAllOrganizations).toHaveBeenCalled();
  });

  it('delegates findOrganizationById to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const expected = { id: 'org-1', name: 'Org One' };

    adminServiceMock.findOrganizationById.mockResolvedValue(expected);

    await expect(controller.findOrganizationById('org-1')).resolves.toEqual(
      expected,
    );
    expect(adminServiceMock.findOrganizationById).toHaveBeenCalledWith('org-1');
  });

  it('delegates updateStatus to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const dto = { status: 'SUSPENDED' as const };
    const expected = { id: 'org-1', status: 'SUSPENDED' };

    adminServiceMock.updateStatus.mockResolvedValue(expected);

    await expect(controller.updateStatus('org-1', dto)).resolves.toEqual(
      expected,
    );
    expect(adminServiceMock.updateStatus).toHaveBeenCalledWith('org-1', dto);
  });

  it('delegates updatePlan to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const dto = { plan: 'PRO' as const };
    const expected = { id: 'org-1', plan: 'PRO' };

    adminServiceMock.updatePlan.mockResolvedValue(expected);

    await expect(controller.updatePlan('org-1', dto)).resolves.toEqual(
      expected,
    );
    expect(adminServiceMock.updatePlan).toHaveBeenCalledWith('org-1', dto);
  });

  it('delegates getMetrics to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const expected = { totalOrganizations: 5 };

    adminServiceMock.getMetrics.mockResolvedValue(expected);

    await expect(controller.getMetrics()).resolves.toEqual(expected);
    expect(adminServiceMock.getMetrics).toHaveBeenCalled();
  });

  it('delegates updateOrganization to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const dto = { name: 'Updated', slug: 'updated-slug' };
    const expected = { id: 'org-1', name: 'Updated' };

    adminServiceMock.updateOrganization.mockResolvedValue(expected);

    await expect(
      controller.updateOrganization('org-1', dto),
    ).resolves.toEqual(expected);
    expect(adminServiceMock.updateOrganization).toHaveBeenCalledWith(
      'org-1',
      dto,
    );
  });

  it('delegates addOrganizationMember to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const dto = {
      email: 'new@example.com',
      name: 'New',
      role: 'CASHIER' as const,
    };
    const expected = { user: { id: 'u-1' }, organizationUser: { id: 'ou-1' } };

    adminServiceMock.addOrganizationMember.mockResolvedValue(expected);

    await expect(
      controller.addOrganizationMember('org-1', dto),
    ).resolves.toEqual(expected);
    expect(adminServiceMock.addOrganizationMember).toHaveBeenCalledWith(
      'org-1',
      dto,
    );
  });

  it('delegates updateMemberRole to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const dto = { role: 'ADMIN' as const };
    const expected = {
      id: 'ou-1',
      userId: 'user-1',
      organizationId: 'org-1',
      role: 'ADMIN',
    };

    adminServiceMock.updateMemberRole.mockResolvedValue(expected);

    await expect(
      controller.updateMemberRole('org-1', 'user-1', dto),
    ).resolves.toEqual(expected);
    expect(adminServiceMock.updateMemberRole).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      'ADMIN',
    );
  });

  it('delegates removeOrganizationMember to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const expected = { success: true };

    adminServiceMock.removeOrganizationMember.mockResolvedValue(expected);

    await expect(
      controller.removeOrganizationMember('org-1', 'user-1'),
    ).resolves.toEqual(expected);
    expect(adminServiceMock.removeOrganizationMember).toHaveBeenCalledWith(
      'org-1',
      'user-1',
    );
  });

  it('delegates deleteOrganization to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const dto = { confirmOrganizationName: 'Tienda Principal' };
    const expected = { success: true };

    adminServiceMock.deleteOrganization.mockResolvedValue(expected);

    await expect(
      controller.deleteOrganization('org-1', dto),
    ).resolves.toEqual(expected);
    expect(adminServiceMock.deleteOrganization).toHaveBeenCalledWith(
      'org-1',
      dto,
    );
  });

  it('delegates updateElectronicInvoicing to the service', async () => {
    const controller = new AdminController(adminServiceMock as never);
    const dto = { enabled: true };
    const expected = {
      organizationId: 'org-1',
      electronicInvoicing: { enabled: true },
    };

    adminServiceMock.updateElectronicInvoicing.mockResolvedValue(expected);

    await expect(
      controller.updateElectronicInvoicing('org-1', dto),
    ).resolves.toEqual(expected);
    expect(adminServiceMock.updateElectronicInvoicing).toHaveBeenCalledWith(
      'org-1',
      dto,
    );
  });
});
