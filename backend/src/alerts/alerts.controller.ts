import {
  Controller,
  Get,
  ParseEnumPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrgRole, ProductStockAlertEventKind } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { AlertsService } from './alerts.service';
import type { OrgAlert, StockAlertHistoryPage } from './alerts.types';

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

  /**
   * The stock-alert notification history for the caller's organization.
   *
   * Read-only and tenant-scoped; the roles are the two that already see stock
   * alerts, so the history never exposes a category the caller cannot see.
   */
  @Get('notifications')
  @Roles(OrgRole.ADMIN, OrgRole.INVENTORY_USER)
  @ApiOperation({ summary: 'Get the stock-alert notification history' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'kind', required: false, enum: ProductStockAlertEventKind })
  history(
    @CurrentUser() user: RequestUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('kind', new ParseEnumPipe(ProductStockAlertEventKind, { optional: true }))
    kind?: ProductStockAlertEventKind,
  ): Promise<StockAlertHistoryPage> {
    return this.alerts.history(
      user,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      kind,
    );
  }
}
