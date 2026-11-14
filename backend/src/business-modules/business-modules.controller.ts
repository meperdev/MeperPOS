import {
  BadRequestException,
  Controller,
  Get,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { BusinessModulesService } from './business-modules.service';

@Controller('business-modules')
@UseGuards(JwtAuthGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
export class BusinessModulesController {
  constructor(private readonly modules: BusinessModulesService) {}

  @Get('vehicles')
  async find(@CurrentUser() user: RequestUser) {
    if (!user.organizationId)
      throw new BadRequestException('Organization ID is required');
    return this.modules.getForOrganization(user.organizationId, 'vehicles');
  }
}
