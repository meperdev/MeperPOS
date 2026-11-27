import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { CashRegistersService } from './cash-registers.service';
import { CreateCashRegisterDto } from './dto/create-cash-register.dto';
import { UpdateCashRegisterDto } from './dto/update-cash-register.dto';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PlanLimitGuard } from '../plan-limits/plan-limits.guard';
import { PlanLimit } from '../plan-limits/plan-limits.decorator';

@ApiTags('Cash Registers')
@Controller('cash-registers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard, PlanLimitGuard)
@UseInterceptors(AdminOrganizationInterceptor)
export class CashRegistersController {
  constructor(private cashRegistersService: CashRegistersService) {}

  @Post()
  @Roles(OrgRole.ADMIN)
  @PlanLimit('cashRegisters')
  @ApiOperation({ summary: 'Create a new cash register' })
  create(@Body() dto: CreateCashRegisterDto, @CurrentUser() user: RequestUser) {
    return this.cashRegistersService.create(dto, user.organizationId);
  }

  @Get()
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Get all cash registers' })
  findAll(@CurrentUser() user: RequestUser) {
    return this.cashRegistersService.findAll(user.organizationId);
  }

  @Get(':id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Get a cash register by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.cashRegistersService.findOne(id, user.organizationId);
  }

  @Put(':id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Update a cash register' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCashRegisterDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.cashRegistersService.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Delete a cash register' })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.cashRegistersService.remove(id, user.organizationId);
  }
}
