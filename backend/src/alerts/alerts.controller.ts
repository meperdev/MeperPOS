import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { AlertsService } from './alerts.service';
import type { OrgAlert } from './alerts.types';

/**
 * The alert feed for the caller's organization.
 *
 * Every organization role is admitted because each one sees a subset: the service
 * filters by the same hierarchy the route guard applies, and a caller cannot ask
 * for another category by changing a parameter. The tenant comes from the token.
 */
@ApiTags('Alerts')
@ApiBearerAuth()
@Controller('alerts')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @Roles(OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.CASHIER, OrgRole.INVENTORY_USER)
  @ApiOperation({ summary: 'Get the organization alert feed' })
  list(@CurrentUser() user: RequestUser): Promise<OrgAlert[]> {
    return this.alerts.list(user);
  }
}
