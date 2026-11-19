import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RequestUser } from '../interfaces/request-user.interface';

/**
 * Tenant boundary guard (security audit SEC-002, docs/security/FINDINGS.md).
 *
 * Every authenticated controller that touches organization-scoped data MUST
 * register this guard alongside JwtAuthGuard and @Roles. When
 * `user.organizationId` is undefined the service-layer fallback
 * `...(organizationId ? { organizationId } : {})` silently queries ALL
 * organizations, so an endpoint missing this guard becomes an immediate
 * cross-tenant leak. Only SUPER_ADMIN platform routes and pre-auth routes
 * (auth/*, WAHA webhook, health) may omit it — with an explicit comment saying
 * why. See AGENTS.md "Key Conventions" for the repo-wide rule.
 */
@Injectable()
export class OrganizationRequiredGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;

    if (!user) {
      return true;
    }

    if (user.isSuperAdmin) {
      return true;
    }

    if (!user.organizationId) {
      throw new ForbiddenException(
        'Organization scope required. Please select an organization or use an admin endpoint.',
      );
    }

    return true;
  }
}
