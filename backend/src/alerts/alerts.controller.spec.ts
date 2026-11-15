import { PATH_METADATA } from '@nestjs/common/constants';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { AlertsController } from './alerts.controller';
import type { AlertsService } from './alerts.service';

const user: RequestUser = {
  userId: 'u1',
  email: 'admin@org.demo',
  organizationId: 'org-1',
  role: OrgRole.ADMIN,
  tokenVersion: 0,
  isSuperAdmin: false,
};

describe('AlertsController', () => {
  it('is mounted at /alerts and serves GET /', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AlertsController)).toBe('alerts');
    expect(
      Reflect.getMetadata(PATH_METADATA, AlertsController.prototype.list),
    ).toBe('/');
  });

  it('admits every organization role, including inventory staff', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AlertsController.prototype.list,
    ) as OrgRole[];

    expect(roles).toEqual(
      expect.arrayContaining([
        OrgRole.ADMIN,
        OrgRole.MEMBER,
        OrgRole.CASHIER,
        OrgRole.INVENTORY_USER,
      ]),
    );
  });

  it('delegates to the service with the authenticated user', async () => {
    const alerts = {
      list: jest.fn().mockResolvedValue([{ id: 'stock:low' }]),
    } as unknown as AlertsService;
    const controller = new AlertsController(alerts);

    await expect(controller.list(user)).resolves.toEqual([{ id: 'stock:low' }]);
    expect(alerts.list).toHaveBeenCalledWith(user);
  });
});
