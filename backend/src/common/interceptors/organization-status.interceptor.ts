import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { OrganizationStatusGuard } from '../guards/organization-status.guard';

/**
 * Runs the organization status check AFTER route authentication.
 *
 * This app has no global JwtAuthGuard: authentication resolves at route level,
 * so a global guard would always see `request.user` undefined and let every
 * request through. An interceptor runs once the route guards have populated the
 * user, which is the first moment the status can be read.
 */
@Injectable()
export class OrganizationStatusInterceptor implements NestInterceptor {
  constructor(private readonly guard: OrganizationStatusGuard) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    await this.guard.canActivate(context);

    return next.handle();
  }
}
