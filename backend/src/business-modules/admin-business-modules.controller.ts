import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { BusinessModulesService } from './business-modules.service';

export class UpdateModuleDto {
  /**
   * Production validation runs with `enableImplicitConversion`, which applies
   * `Boolean(value)` before class-validator sees the field and would turn the
   * raw JSON string "false" into `true`. Restore the value exactly as it was
   * sent so `@IsBoolean()` accepts only a real JSON boolean.
   */
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
    { toClassOnly: true },
  )
  @IsBoolean()
  enabled: boolean;
}

@Controller('admin/organizations/:organizationId/modules')
// eslint-disable-next-line meperpos/require-organization-guard -- SUPER_ADMIN platform route: the target organization comes from the :organizationId path param
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminBusinessModulesController {
  constructor(private readonly modules: BusinessModulesService) {}

  @Get()
  findAll(@Param('organizationId') organizationId: string) {
    return this.modules.listForOrganization(organizationId);
  }

  @Patch(':moduleId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('moduleId') moduleId: string,
    @Body() dto: UpdateModuleDto,
  ) {
    return this.modules.setEnabled(organizationId, moduleId, dto.enabled);
  }
}
