import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CustomerVehiclesService } from './customer-vehicles.service';

export class CreateCustomerVehicleDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(40)
  plate: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;
}

export class UpdateCustomerVehicleDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(40)
  plate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;
}

@Controller('customers/:customerId/vehicles')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
export class CustomerVehiclesController {
  constructor(private readonly vehicles: CustomerVehiclesService) {}

  @Get()
  @Roles(OrgRole.ADMIN, OrgRole.CASHIER)
  list(
    @Param('customerId') customerId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.vehicles.list(user.organizationId ?? '', customerId);
  }

  @Patch(':vehicleId')
  @Roles(OrgRole.ADMIN)
  update(
    @Param('customerId') customerId: string,
    @Param('vehicleId') vehicleId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateCustomerVehicleDto,
  ) {
    return this.vehicles.update(
      user.organizationId ?? '',
      customerId,
      vehicleId,
      dto,
    );
  }

  @Post()
  @Roles(OrgRole.ADMIN, OrgRole.CASHIER)
  create(
    @Param('customerId') customerId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCustomerVehicleDto,
  ) {
    return this.vehicles.create(user.organizationId ?? '', customerId, dto);
  }
}
