import { PATH_METADATA } from '@nestjs/common/constants';
import { OrgRole, ProductStockAlertEventKind } from '@prisma/client';
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

  it('serves the notification history under /alerts/notifications', () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        AlertsController.prototype.history,
      ),
    ).toBe('notifications');
    expect(
      Reflect.getMetadata(ROLES_KEY, AlertsController.prototype.history),
    ).toEqual(expect.arrayContaining([OrgRole.ADMIN, OrgRole.INVENTORY_USER]));
  });

  it('parses the history pagination and delegates it', async () => {
    const page = { data: [], meta: { total: 0, page: 3, limit: 10, totalPages: 0 } };
    const alerts = {
      history: jest.fn().mockResolvedValue(page),
    } as unknown as AlertsService;
    const controller = new AlertsController(alerts);

    await expect(controller.history(user, '3', '10')).resolves.toBe(page);
    expect(alerts.history).toHaveBeenCalledWith(user, 3, 10, undefined);

    await controller.history(
      user,
      '1',
      '20',
      ProductStockAlertEventKind.FAILED,
    );
    expect(alerts.history).toHaveBeenLastCalledWith(
      user,
      1,
      20,
      ProductStockAlertEventKind.FAILED,
    );
  });
});
