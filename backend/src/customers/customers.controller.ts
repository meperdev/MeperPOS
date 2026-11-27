import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
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
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { PlanLimitGuard } from '../plan-limits/plan-limits.guard';
import { PlanLimit } from '../plan-limits/plan-limits.decorator';
import { CustomerPlateInterceptor } from './customer-plate.interceptor';

@ApiTags('Customers')
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard, PlanLimitGuard)
@UseInterceptors(AdminOrganizationInterceptor, CustomerPlateInterceptor)
@ApiBearerAuth()
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Post()
  @Roles(OrgRole.ADMIN, OrgRole.CASHIER)
  @PlanLimit('customers')
  @ApiOperation({ summary: 'Create a new customer' })
  create(
    @Body() createCustomerDto: CreateCustomerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.customersService.create(
      createCustomerDto,
      user.organizationId,
    );
  }

  @Get()
  @Roles(OrgRole.ADMIN, OrgRole.CASHIER)
  @ApiOperation({ summary: 'Get all customers with pagination' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'segment', required: false })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search?: string,
    @Query('segment') segment?: string,
  ) {
    return this.customersService.findAll(
      user.organizationId,
      page,
      limit,
      search,
      segment,
    );
  }

  @Get('document/:documentNumber')
  @Roles(OrgRole.ADMIN, OrgRole.CASHIER)
  @ApiOperation({ summary: 'Find customer by document number' })
  findByDocumentNumber(
    @Param('documentNumber') documentNumber: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.customersService.findByDocumentNumber(
      documentNumber,
      user.organizationId,
    );
  }

  @Get(':id')
  @Roles(OrgRole.ADMIN, OrgRole.CASHIER)
  @ApiOperation({ summary: 'Get a customer by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.customersService.findOne(id, user.organizationId);
  }

  @Put(':id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Update a customer' })
  update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.customersService.update(
      id,
      updateCustomerDto,
      user.organizationId,
    );
  }

  @Delete(':id')
  @Roles(OrgRole.ADMIN)
  @ApiOperation({ summary: 'Delete a customer' })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.customersService.remove(id, user.organizationId);
  }
}
