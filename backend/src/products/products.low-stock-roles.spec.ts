import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ProductsController } from './products.controller';

const guard = new RolesGuard(new Reflector());

const context = (
  role: OrgRole | 'SUPER_ADMIN',
): ExecutionContext =>
  ({
    getHandler: () => ProductsController.prototype.getLowStock,
    getClass: () => ProductsController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { role, isSuperAdmin: false } }),
    }),
  }) as unknown as ExecutionContext;

/**
 * The bell enabled stock alerts for INVENTORY_USER while this route refused the
 * role with a 403, which surfaced as a permanently empty alert. The route is the
 * contract the client depends on, so it is asserted through the real guard.
 */
describe('GET /api/products/low-stock role contract', () => {
  it('admits INVENTORY_USER', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        ProductsController.prototype.getLowStock,
      ),
    ).toEqual(expect.arrayContaining([OrgRole.INVENTORY_USER]));
    expect(guard.canActivate(context(OrgRole.INVENTORY_USER))).toBe(true);
  });

  it('keeps CASHIER out', () => {
    expect(() => guard.canActivate(context(OrgRole.CASHIER))).toThrow(
      /Access denied/,
    );
  });

  it('keeps the roles it already admitted', () => {
    expect(guard.canActivate(context(OrgRole.ADMIN))).toBe(true);
    expect(guard.canActivate(context(OrgRole.MEMBER))).toBe(true);
    expect(guard.canActivate(context(OrgRole.OWNER))).toBe(true);
  });
});
