import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { defer, from, map, mergeMap, Observable } from 'rxjs';
import { BusinessModulesService } from '../business-modules/business-modules.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';

function hidePlate(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.data))
    return { ...record, data: record.data.map(hidePlate) };
  return Object.prototype.hasOwnProperty.call(record, 'placaMoto')
    ? { ...record, placaMoto: null }
    : value;
}

@Injectable()
export class CustomerPlateInterceptor implements NestInterceptor {
  constructor(private readonly modules: BusinessModulesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: RequestUser; body?: unknown }>();
    const organizationId = request.user?.organizationId;
    if (!organizationId) return next.handle();
    return defer(() =>
      from(this.modules.isEnabled(organizationId, 'vehicles')),
    ).pipe(
      mergeMap((enabled) => {
        if (
          !enabled &&
          request.body &&
          typeof request.body === 'object' &&
          Object.prototype.hasOwnProperty.call(request.body, 'placaMoto')
        ) {
          throw new ForbiddenException('Vehicles module is disabled');
        }
        return next
          .handle()
          .pipe(
            map((result: unknown) => (enabled ? result : hidePlate(result))),
          );
      }),
    );
  }
}
