import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ProductsController } from './products.controller';

const guard = new RolesGuard(new Reflector());

const context = (
  handler: () => unknown,
  role: OrgRole | 'SUPER_ADMIN',
): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => ProductsController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { role, isSuperAdmin: false } }),
    }),
  }) as unknown as ExecutionContext;

/**
 * T22 — who may read the per-site breakdown and who may move a site balance.
 *
 * The breakdown follows the product detail route: every role that can open a
 * product reads it, and the site list narrows itself to what the caller may
 * see. The adjustment is a stock edit, so it admits exactly the roles the
 * absolute product edit already admits.
 */
describe('Product site stock routes role contract', () => {
  const breakdown = ProductsController.prototype.stockBySite;
  const adjust = ProductsController.prototype.adjustStock;

  it('leaves the breakdown open to every authenticated role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, breakdown)).toBeUndefined();
    expect(guard.canActivate(context(breakdown, OrgRole.CASHIER))).toBe(true);
    expect(guard.canActivate(context(breakdown, OrgRole.INVENTORY_USER))).toBe(
      true,
    );
  });

  it('admits only the roles that edit product stock to the adjustment', () => {
    expect(Reflect.getMetadata(ROLES_KEY, adjust)).toEqual(
      expect.arrayContaining([OrgRole.ADMIN, OrgRole.MEMBER]),
    );
    for (const role of [
      OrgRole.ADMIN,
      OrgRole.MEMBER,
      OrgRole.OWNER,
    ] as const) {
      expect(guard.canActivate(context(adjust, role))).toBe(true);
    }
    for (const role of [OrgRole.CASHIER, OrgRole.INVENTORY_USER] as const) {
      expect(() => guard.canActivate(context(adjust, role))).toThrow(
        /Access denied/,
      );
    }
  });
});
