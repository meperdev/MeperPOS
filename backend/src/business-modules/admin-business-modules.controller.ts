import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { BusinessModulesService } from './business-modules.service';

export class UpdateModuleDto {
  @IsBoolean()
  enabled: boolean;
}

@Controller('admin/organizations/:organizationId/modules/vehicles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminBusinessModulesController {
  constructor(private readonly modules: BusinessModulesService) {}

  @Get()
  find(@Param('organizationId') organizationId: string) {
    return this.modules.getForOrganization(organizationId, 'vehicles');
  }

  @Patch()
  update(
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateModuleDto,
  ) {
    return this.modules.setEnabled(organizationId, 'vehicles', dto.enabled);
  }
}
