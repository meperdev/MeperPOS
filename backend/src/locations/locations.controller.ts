import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { AuditAction } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { AuditInterceptor } from '../common/interceptors/audit.interceptor';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { LocationsService } from './locations.service';

class ReplaceMembershipLocationsDto {
  @ApiProperty({
    type: [String],
    description: 'Exact location UUID set; empty removes all assignments',
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  locationIds!: string[];
}

@ApiTags('Locations')
@ApiBearerAuth()
@Controller()
@Roles(
  OrgRole.OWNER,
  OrgRole.ADMIN,
  OrgRole.MEMBER,
  OrgRole.CASHIER,
  OrgRole.INVENTORY_USER,
)
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('locations')
  @ApiOperation({
    summary: 'List accessible locations in the selected organization',
  })
  list(@CurrentUser() user: RequestUser) {
    return this.locations.list(user);
  }

  @Get('locations/:id')
  @ApiOperation({
    summary: 'Get a location only if accessible in the selected organization',
  })
  find(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.locations.findAccessible(user, id);
  }

  @Put('users/:id/locations')
  @Roles(OrgRole.ADMIN)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('USER_LOCATIONS_UPDATE')
  @ApiOperation({
    summary: 'Replace the location assignments on a restricted membership',
  })
  replace(
    @CurrentUser() user: RequestUser,
    @Param('id') userId: string,
    @Body() dto: ReplaceMembershipLocationsDto,
  ) {
    return this.locations.replaceAssignments(user, userId, dto.locationIds);
  }
}
