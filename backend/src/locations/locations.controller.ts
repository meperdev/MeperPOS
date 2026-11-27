import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { LocationType, OrgRole } from '@prisma/client';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
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

/** Trimmed before validation so a padded name cannot be stored twice. */
const trimName = ({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Trims optional contact text and turns a blank value into `null`, which is
 * how a cleared address or phone is stored. `@IsOptional()` then skips the
 * validators for that null instead of rejecting it as a short string.
 */
const normalizeOptionalText = ({ value }: TransformFnParams) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

class CreateLocationDto {
  @ApiProperty({ maxLength: 80, description: 'Unique site name in the org' })
  @Transform(trimName)
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ enum: LocationType, description: 'Store or warehouse' })
  @IsEnum(LocationType)
  type!: LocationType;

  @ApiPropertyOptional({
    maxLength: 200,
    nullable: true,
    description: 'Street address printed on the receipt',
  })
  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({
    maxLength: 40,
    nullable: true,
    description: 'Phone printed on the receipt',
  })
  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;
}

class UpdateLocationDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(trimName)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ enum: LocationType })
  @IsOptional()
  @IsEnum(LocationType)
  type?: LocationType;

  @ApiPropertyOptional({
    maxLength: 200,
    nullable: true,
    description: 'Street address printed on the receipt; blank clears it',
  })
  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({
    maxLength: 40,
    nullable: true,
    description: 'Phone printed on the receipt; blank clears it',
  })
  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;
}

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
@Roles(OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.CASHIER, OrgRole.INVENTORY_USER)
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

  @Get('locations/pos-context')
  @ApiOperation({
    summary:
      'List POS locations and the sole site eligible for global-stock checkout',
  })
  posContext(@CurrentUser() user: RequestUser) {
    return this.locations.posContext(user);
  }

  @Get('locations/:id')
  @ApiOperation({
    summary: 'Get a location only if accessible in the selected organization',
  })
  find(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.locations.findAccessible(user, id);
  }

  @Post('locations')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({
    summary: 'Create a store or warehouse in the selected organization',
  })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateLocationDto) {
    return this.locations.create(user, dto);
  }

  @Patch('locations/:id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({
    summary:
      'Rename a location, change its store/warehouse type or set its contact details',
  })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
  ) {
    return this.locations.update(user, id, dto);
  }

  @Get('users/:id/locations')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({
    summary: 'Read the explicit location assignments of one membership',
  })
  assignments(@CurrentUser() user: RequestUser, @Param('id') userId: string) {
    return this.locations.findAssignments(user, userId);
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
