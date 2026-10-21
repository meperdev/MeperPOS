import {
  Body,
  Controller,
  Get,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateInventoryLoanDto } from './dto/create-inventory-loan.dto';
import {
  InventoryLoanOperationDto,
  InventoryLoanTerminalDto,
} from './dto/inventory-loan-operation.dto';
import {
  InventoryLoanHistoryQueryDto,
  QueryInventoryLoansDto,
} from './dto/query-inventory-loans.dto';
import { InventoryLoansService } from './inventory-loans.service';

// Prepared artifact only: rollout OFF, deliberately unregistered in every module.
@ApiTags('Inventory loans')
@ApiBearerAuth()
@Controller('inventory-loans')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
export class InventoryLoansController {
  constructor(private readonly inventoryLoansService: InventoryLoansService) {}

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  async create(
    @Body() dto: CreateInventoryLoanDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<InventoryLoansService['create']> {
    return this.inventoryLoansService.create(dto, user);
  }

  @Post(':id/deliver')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  async deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InventoryLoanOperationDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<InventoryLoansService['deliver']> {
    return this.inventoryLoansService.deliver(id, dto, user);
  }

  @Post(':id/return')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  async returnItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InventoryLoanOperationDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<InventoryLoansService['returnItems']> {
    return this.inventoryLoansService.returnItems(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InventoryLoanTerminalDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<InventoryLoansService['cancel']> {
    return this.inventoryLoansService.cancel(id, dto, user);
  }

  @Post(':id/close')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InventoryLoanTerminalDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<InventoryLoansService['close']> {
    return this.inventoryLoansService.close(id, dto, user);
  }

  @Get()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  async findAll(
    @Query() query: QueryInventoryLoansDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<InventoryLoansService['findAll']> {
    const organizationId = this.requiredOrganizationId(user);
    return this.inventoryLoansService.findAll(query, organizationId);
  }

  @Get(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
  ): ReturnType<InventoryLoansService['findOne']> {
    const organizationId = this.requiredOrganizationId(user);
    return this.inventoryLoansService.findOne(id, organizationId);
  }

  @Get(':id/history')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  async getHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: InventoryLoanHistoryQueryDto,
    @CurrentUser() user: RequestUser,
  ): ReturnType<InventoryLoansService['history']> {
    const organizationId = this.requiredOrganizationId(user);
    return this.inventoryLoansService.history(id, query, organizationId);
  }

  private requiredOrganizationId(user: RequestUser): string {
    if (!user.organizationId) {
      throw new ForbiddenException(
        'Organization scope required. Please select an organization or use an admin endpoint.',
      );
    }
    return user.organizationId;
  }
}
