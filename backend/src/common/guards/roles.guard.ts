import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY, RoleType } from '../decorators/roles.decorator';
import { effectiveRoles } from './role-hierarchy';

interface RequestWithUser {
  user?: { role?: OrgRole | 'SUPER_ADMIN'; isSuperAdmin?: boolean };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleType[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('User role not found');
    }

    // SuperAdmin bypass
    if (user.isSuperAdmin || user.role === 'SUPER_ADMIN') {
      return true;
    }

    // Role hierarchy: OWNER inherits ADMIN, ADMIN inherits MEMBER, MEMBER inherits CASHIER
    const inheritedRoles = effectiveRoles(user.role);

    const hasRole = requiredRoles.some((requiredRole) =>
      inheritedRoles.includes(requiredRole),
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
