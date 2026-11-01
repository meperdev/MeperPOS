import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class OrganizationStatusGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // SuperAdmin bypass
    if (user?.isSuperAdmin || user?.role === 'SUPER_ADMIN') {
      return true;
    }

    const orgStatus = user?.orgStatus;

    if (!orgStatus) {
      return true;
    }

    if (orgStatus === 'SUSPENDED' || orgStatus === 'PAST_DUE') {
      const method = request.method;

      // Reading stays available so the tenant can see its own billing state.
      if (method === 'GET' || method === 'HEAD') {
        return true;
      }

      throw new ForbiddenException({
        message:
          orgStatus === 'PAST_DUE'
            ? 'Organization is past due. Write operations are disabled until the payment is settled.'
            : 'Organization is suspended. Write operations are disabled.',
        status: orgStatus,
      });
    }

    return true;
  }
}
