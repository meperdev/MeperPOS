import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { BusinessModulesService } from './business-modules.service';

/**
 * Global catalog of administrable modules. The route is deliberately global:
 * it lists what could be enabled and reads no organization state, so it does
 * not use OrganizationRequiredGuard. Per-organization state stays on
 * `admin/organizations/:organizationId/modules`.
 */
@Controller('admin/modules')
// eslint-disable-next-line meperpos/require-organization-guard -- SUPER_ADMIN platform route: global module catalog, reads no organization state
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminModuleCatalogController {
  constructor(private readonly modules: BusinessModulesService) {}

  @Get()
  listCatalog() {
    return this.modules.listCatalog();
  }
}
