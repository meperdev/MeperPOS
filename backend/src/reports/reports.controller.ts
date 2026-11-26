import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { LocationsService } from '../locations/locations.service';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';

/** Shared description of the optional site filter every sales figure accepts. */
const SITE_QUERY_DESCRIPTION =
  'Only sales whose stored origin is this accessible site; sales recorded without an origin never count in a site view. 404 for a site the caller cannot read.';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
@Roles(OrgRole.ADMIN)
@ApiBearerAuth()
export class ReportsController {
  constructor(
    private reportsService: ReportsService,
    private locationsService: LocationsService,
  ) {}

  private parseUserIds(userIds?: string): string[] | undefined {
    if (!userIds) {
      return undefined;
    }

    const parsedUserIds = Array.from(
      new Set(
        userIds
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );

    return parsedUserIds.length > 0 ? parsedUserIds : undefined;
  }

  private parseCompare(compare?: string): boolean {
    if (!compare) {
      return true;
    }

    const normalized = compare.trim().toLowerCase();

    if (normalized === 'false' || normalized === '0') {
      return false;
    }

    return true;
  }

  /**
   * Resolves the requested site through the one site-access rule the sales list
   * already uses: `findAccessible` answers 404 for a site of another
   * organization, an unassigned site or an unknown id, so no report re-derives
   * the membership rule.
   */
  private async resolveSiteId(
    user: RequestUser,
    locationId?: string,
  ): Promise<string | undefined> {
    if (locationId === undefined) {
      return undefined;
    }

    return (await this.locationsService.findAccessible(user, locationId)).id;
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard KPIs' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: SITE_QUERY_DESCRIPTION,
  })
  async getDashboard(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getDashboardKPIs(
      user.organizationId,
      startDate,
      endDate,
      await this.resolveSiteId(user, locationId),
    );
  }

  @Get('economic')
  @ApiOperation({
    summary:
      'Get organization financial economics (always organization-wide: expenses carry no site)',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  getEconomic(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getFinancialOverview(
      user.organizationId,
      startDate,
      endDate,
    );
  }

  @Get('economic/cash')
  @ApiOperation({
    summary:
      'Get cash collections and expense payments (always organization-wide: expense payments carry no site)',
  })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  getCash(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getCashFlow(
      user.organizationId,
      startDate,
      endDate,
    );
  }

  @Get('economic/inventory')
  @ApiOperation({ summary: 'Get current inventory economics and movements' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description:
      'Value the stock this accessible site holds and its own movements; 404 for a site the caller cannot read.',
  })
  async getInventory(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getInventorySnapshot(
      user.organizationId,
      startDate,
      endDate,
      await this.resolveSiteId(user, locationId),
    );
  }

  @Get('sales/payment-method')
  @ApiOperation({ summary: 'Get sales by payment method' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: SITE_QUERY_DESCRIPTION,
  })
  async getSalesByPaymentMethod(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getSalesByPaymentMethod(
      user.organizationId,
      startDate,
      endDate,
      await this.resolveSiteId(user, locationId),
    );
  }

  @Get('sales/category')
  @ApiOperation({ summary: 'Get sales by category' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: SITE_QUERY_DESCRIPTION,
  })
  async getSalesByCategory(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getSalesByCategory(
      user.organizationId,
      startDate,
      endDate,
      await this.resolveSiteId(user, locationId),
    );
  }

  @Get('sales/category-daily')
  @ApiOperation({ summary: 'Get daily sales grouped by category' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: SITE_QUERY_DESCRIPTION,
  })
  async getSalesByCategoryDaily(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getSalesByCategoryDaily(
      user.organizationId,
      startDate,
      endDate,
      await this.resolveSiteId(user, locationId),
    );
  }

  @Get('products/top-selling')
  @ApiOperation({ summary: 'Get top selling products' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: SITE_QUERY_DESCRIPTION,
  })
  async getTopSellingProducts(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getTopSellingProducts(
      user.organizationId,
      startDate,
      endDate,
      limit ? parseInt(limit) : 10,
      await this.resolveSiteId(user, locationId),
    );
  }

  @Get('customers/statistics')
  @ApiOperation({ summary: 'Get customer statistics' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: SITE_QUERY_DESCRIPTION,
  })
  async getCustomerStatistics(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getCustomerStatistics(
      user.organizationId,
      startDate,
      endDate,
      await this.resolveSiteId(user, locationId),
    );
  }

  @Get('users/performance')
  @ApiOperation({ summary: 'Get user performance metrics' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'compare', required: false, example: true })
  @ApiQuery({
    name: 'userIds',
    required: false,
    description: 'Comma-separated user ids to compare with the same filters',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: SITE_QUERY_DESCRIPTION,
  })
  async getUserPerformance(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('compare') compare?: string,
    @Query('userIds') userIds?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getUserPerformance(
      user.organizationId,
      startDate,
      endDate,
      this.parseCompare(compare),
      this.parseUserIds(userIds),
      await this.resolveSiteId(user, locationId),
    );
  }

  @Get('sales/daily')
  @ApiOperation({ summary: 'Get daily sales' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: SITE_QUERY_DESCRIPTION,
  })
  async getDailySales(
    @CurrentUser() user: RequestUser,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.reportsService.getDailySales(
      user.organizationId,
      startDate,
      endDate,
      await this.resolveSiteId(user, locationId),
    );
  }
}
